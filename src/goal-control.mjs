#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setThreadGoal } from "./goal.mjs";
import { readInstanceConfig, resolveInstance } from "./instance.mjs";

if (process.env.WHOSE_AGENT_WORKER === "1") {
  throw new Error("重构 Agent 不得改变自身 Goal 状态");
}

const { configPath, instanceDirectory } = resolveInstance(process.argv[2]);
const config = await readInstanceConfig(configPath);
const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const todoPath = join(instanceDirectory, "todo.md");
const todoControlPath = join(runtimeDirectory, "todo-control.mjs");
const goalObjective = `${config.goalObjective}\n\n持久 TODO 协议：${todoPath} 是本线程跨消息、上下文压缩和重启后的权威待办账本。每次收到新消息，先读取它；若消息没有 webhook delivery 条目但产生任务或决策，先运行 node ${todoControlPath} ${configPath} add --summary <摘要> 登记。新任务不得打断未到安全边界的当前任务。只有条目要求全部完成后，运行同一工具的 complete <id> --evidence <证据> 核销；消息已投递、已阅读或已开始都不算完成。不得仅依赖对话记忆保存待办。`;
const command = process.argv[3] ?? "get";
if (!new Set(["get", "active", "paused"]).has(command)) {
  throw new Error("用法: goal-control.mjs [get|active|paused]");
}

const result = await setThreadGoal(config, command, goalObjective);
process.stdout.write(`${JSON.stringify(result)}\n`);
