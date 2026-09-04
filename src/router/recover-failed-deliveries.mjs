#!/usr/bin/env node

import { createSign, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const routerConfigPath = process.argv[2];
if (!routerConfigPath) throw new Error("router config path is required");
const routerConfig = JSON.parse(await readFile(resolve(routerConfigPath), "utf8"));
const statePath = resolve(routerConfig.recoveryStatePath);
const credentialsConfigPath = resolve(routerConfig.recoveryCredentialsConfigPath);
const maximumAttempts = 10;
const maximumRedeliveriesPerRun = 10;
const recoverableActions = new Map([
  ["issues", new Set(["opened", "edited", "closed", "reopened"])],
  ["issue_comment", new Set(["created", "edited", "deleted"])],
  ["pull_request", new Set([
    "opened",
    "edited",
    "closed",
    "reopened",
    "synchronize",
    "ready_for_review",
    "converted_to_draft",
  ])],
  ["pull_request_review", new Set(["submitted", "edited", "dismissed"])],
  ["pull_request_review_comment", new Set(["created", "edited", "deleted"])],
]);

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function createAppJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: config.githubAppId }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const privateKey = await readFile(config.githubPrivateKeyPath, "utf8");
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, notBefore: new Date().toISOString(), recoveries: {} };
    }
    throw error;
  }
}

async function saveState(state) {
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

function parseDeliveryList(text) {
  return JSON.parse(text.replaceAll(/"id":(\d+)/g, '"id":"$1"'));
}

function priority(delivery) {
  if (delivery.event === "issue_comment") return 0;
  if (delivery.event === "pull_request_review_comment") return 1;
  if (delivery.event === "pull_request_review") return 2;
  return 3;
}

const config = JSON.parse(await readFile(credentialsConfigPath, "utf8"));
const state = await loadState();
if (state.version !== 1 || typeof state.recoveries !== "object") {
  throw new Error("unsupported recovery state");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${await createAppJwt(config)}`,
  "User-Agent": "whose-agent-delivery-recovery",
  "X-GitHub-Api-Version": "2022-11-28",
};
const listResponse = await fetch(
  "https://api.github.com/app/hook/deliveries?per_page=100",
  { headers },
);
if (!listResponse.ok) {
  throw new Error(`delivery list failed: ${listResponse.status}`);
}
const deliveries = parseDeliveryList(await listResponse.text()).filter(
  (delivery) =>
    Date.parse(delivery.delivered_at) >= Date.parse(state.notBefore) &&
    recoverableActions.get(delivery.event)?.has(delivery.action),
);
const byGuid = Map.groupBy(deliveries, (delivery) => delivery.guid);
const candidates = [];

for (const [guid, attempts] of byGuid) {
  const successful = attempts.some(
    (delivery) => delivery.status_code >= 200 && delivery.status_code < 300,
  );
  if (successful) {
    if (state.recoveries[guid]) state.recoveries[guid].recovered = true;
    continue;
  }
  const latest = attempts.toSorted(
    (left, right) => Date.parse(right.delivered_at) - Date.parse(left.delivered_at),
  )[0];
  if (!latest || (latest.status_code >= 200 && latest.status_code < 300)) continue;
  const recovery = state.recoveries[guid] ?? {
    attempts: 0,
    attemptedDeliveryIds: [],
    recovered: false,
  };
  state.recoveries[guid] = recovery;
  if (recovery.recovered || recovery.attempts >= maximumAttempts) continue;
  if (recovery.attemptedDeliveryIds.includes(latest.id)) continue;
  if (recovery.nextAttemptAt && Date.parse(recovery.nextAttemptAt) > Date.now()) {
    continue;
  }
  candidates.push(latest);
}

candidates.sort(
  (left, right) =>
    priority(left) - priority(right) ||
    Date.parse(left.delivered_at) - Date.parse(right.delivered_at),
);

for (const delivery of candidates.slice(0, maximumRedeliveriesPerRun)) {
  const response = await fetch(
    `https://api.github.com/app/hook/deliveries/${delivery.id}/attempts`,
    { method: "POST", headers },
  );
  const recovery = state.recoveries[delivery.guid];
  recovery.attempts += 1;
  recovery.attemptedDeliveryIds.push(delivery.id);
  recovery.lastAttemptAt = new Date().toISOString();
  const delayMinutes = Math.min(2 ** (recovery.attempts - 1), 30);
  recovery.nextAttemptAt = new Date(
    Date.now() + delayMinutes * 60 * 1000,
  ).toISOString();
  recovery.lastStatus = response.status;
  process.stdout.write(
    `${new Date().toISOString()} redelivery ${delivery.guid} ${delivery.event}.${delivery.action} -> ${response.status}\n`,
  );
}

const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
state.recoveries = Object.fromEntries(
  Object.entries(state.recoveries).filter(([, recovery]) => {
    const timestamp = Date.parse(recovery.lastAttemptAt ?? state.notBefore);
    return !recovery.recovered || timestamp >= cutoff;
  }),
);
await saveState(state);
