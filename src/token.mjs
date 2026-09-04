#!/usr/bin/env node

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readInstanceConfig, resolveInstance } from "./instance.mjs";

const { configPath } = resolveInstance(process.argv[2]);
const config = await readInstanceConfig(configPath);
const now = Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = encode({ alg: "RS256", typ: "JWT" });
const payload = encode({ iat: now - 30, exp: now + 540, iss: config.githubAppId });
const unsigned = `${header}.${payload}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
signer.end();
const privateKey = await readFile(config.githubPrivateKeyPath, "utf8");
const jwt = `${unsigned}.${signer.sign(privateKey, "base64url")}`;
const response = await fetch(
  `https://api.github.com/app/installations/${config.githubInstallationId}/access_tokens`,
  {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "whose-agent-token",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);
if (!response.ok) {
  throw new Error(`GitHub installation token failed: ${response.status}`);
}
const value = await response.json();
process.stdout.write(value.token);
