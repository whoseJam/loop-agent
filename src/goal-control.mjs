#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { readInstanceConfig, resolveInstance } from "./instance.mjs";

if (process.env.WHOSE_AGENT_WORKER === "1") {
  throw new Error("重构 Agent 不得改变自身 Goal 状态");
}

const { configPath } = resolveInstance(process.argv[2]);
const config = await readInstanceConfig(configPath);
const command = process.argv[3] ?? "get";
if (!new Set(["get", "active", "paused"]).has(command)) {
  throw new Error("用法: goal-control.mjs [get|active|paused]");
}

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
      name: "whose_agent_control",
      title: "whose-agent control",
      version: "0.1.0",
    },
  });
  send({ method: "initialized", params: {} });
  const result =
    command === "get"
      ? await request("thread/goal/get", { threadId: config.threadId })
      : await request("thread/goal/set", {
          threadId: config.threadId,
          status: command,
          ...(command === "active" ? { objective: config.goalObjective } : {}),
        });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  child.stdin.end();
}
