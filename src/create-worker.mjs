#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { resolveInstance } from "./instance.mjs";

const { configPath } = resolveInstance(process.argv[2]);
const config = JSON.parse(await readFile(configPath, "utf8"));
const child = spawn(config.codexPath, ["app-server"], {
  cwd: config.cwd,
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ method, id, params });
  });
}

try {
  await request("initialize", {
    clientInfo: {
      name: "whose_agent_setup",
      title: "whose-agent setup",
      version: "0.1.0",
    },
  });
  send({ method: "initialized", params: {} });
  const created = await request("thread/start", {
    cwd: config.cwd,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  const thread = created.thread;
  if (!thread?.id) throw new Error("thread/start returned no thread id");
  await request("thread/name/set", {
    threadId: thread.id,
    name: config.threadName ?? `${config.commandName} Agent`,
  });
  const nextConfig = {
    ...config,
    sourceThreadId: config.sourceThreadId ?? config.threadId,
    threadId: thread.id,
  };
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  process.stdout.write(
    `${JSON.stringify({ ok: true, threadId: thread.id, name: config.threadName ?? `${config.commandName} Agent` }, null, 2)}\n`,
  );
} finally {
  child.stdin.end();
}
