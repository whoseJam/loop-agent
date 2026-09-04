#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readInstanceConfig, resolveInstance } from "./instance.mjs";

const execFileAsync = promisify(execFile);
const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const { configPath, instanceDirectory } = resolveInstance(process.argv[2]);
const config = await readInstanceConfig(configPath);
const statePath = join(instanceDirectory, "state.json");
const stoppedPath = join(instanceDirectory, "stopped");
const legacyPausedPath = join(instanceDirectory, "paused");
const goalControlPath = join(runtimeDirectory, "goal-control.mjs");
const commandName = config.commandName;
const session = config.tmuxSession;
const operatorName = config.operatorName ?? config.humanLogin;

async function goalStatus() {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const database = join(codexHome, "goals_1.sqlite");
  if (!(await exists(database))) return "未设置";
  const threadId = config.threadId.replaceAll("'", "''");
  try {
    const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
      database,
      `SELECT status FROM thread_goals WHERE thread_id = '${threadId}' LIMIT 1;`,
    ]);
    return stdout.trim() || "未设置";
  } catch {
    return "未知";
  }
}

async function setGoalStatus(status) {
  await execFileAsync(process.execPath, [goalControlPath, configPath, status]);
}

function requireUserTerminal(command) {
  if (process.env.WHOSE_AGENT_WORKER === "1") {
    throw new Error(
      `${commandName} ${command} 只能由 ${operatorName} 在独立终端中执行；Agent 不得改变自身运行状态`,
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${commandName} ${command} 需要由 ${operatorName} 在交互式终端中执行`,
    );
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function running() {
  try {
    await execFileAsync("/opt/homebrew/bin/tmux", ["has-session", "-t", session]);
    return true;
  } catch {
    return false;
  }
}

async function configureKeys() {
  await execFileAsync("/opt/homebrew/bin/tmux", [
    "bind-key",
    "-n",
    "C-g",
    "if-shell",
    "-F",
    `#{==:#{session_name},${session}}`,
    "detach-client",
    "send-keys C-g",
  ]);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function ensureRunning() {
  const alreadyRunning = await running();
  if (!alreadyRunning) {
    await execFileAsync("/opt/homebrew/bin/tmux", [
      "new-session",
      "-d",
      "-s",
      session,
      "-c",
      config.cwd,
      `${shellQuote(join(runtimeDirectory, "run-tui.sh"))} ${shellQuote(configPath)}`,
    ]);
  }
  await configureKeys();
  return !alreadyRunning;
}

async function start() {
  const created = await ensureRunning();
  await setGoalStatus("active");
  if (await exists(stoppedPath)) await unlink(stoppedPath);
  if (await exists(legacyPausedPath)) await unlink(legacyPausedPath);
  return created;
}

async function working() {
  if (!(await running())) return false;
  const { stdout } = await execFileAsync("/opt/homebrew/bin/tmux", [
    "capture-pane",
    "-p",
    "-t",
    session,
  ]);
  return /(?:Working \([^\n]*esc to interrupt\)|Waiting for background terminal)/.test(stdout);
}

async function attach() {
  requireUserTerminal("start");
  await start();
  const child = spawn(
    "/opt/homebrew/bin/tmux",
    ["attach-session", "-t", session],
    { stdio: "inherit" },
  );
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tmux exited ${code}`))));
    child.on("error", reject);
  });
}

async function status() {
  let health = null;
  try {
    health = await (await fetch(`http://${config.listenHost}:${config.listenPort}/healthz`)).json();
  } catch {
    health = { ok: false };
  }
  let state = null;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    state = null;
  }
  process.stdout.write(
    [
      `TUI: ${(await running()) ? ((await working()) ? "运行中（工作中）" : "运行中（空闲）") : "未运行"}`,
      `Webhook: ${health?.ok ? "健康" : "不可用"}`,
      "唤醒方式: Webhook / TUI 输入（空闲时不调用模型）",
      `Goal: ${await goalStatus()}`,
      `接收新任务: ${(await exists(stoppedPath)) || (await exists(legacyPausedPath)) ? "已停止" : "正常"}`,
      `待投递事件: ${state?.pending?.length ?? "未知"}`,
      `Thread: ${config.threadId}`,
    ].join("\n") + "\n",
  );
}

const command = process.argv[3] ?? "watch";
if (command === "watch") await attach();
else if (command === "start") {
  requireUserTerminal(command);
  const created = await start();
  process.stdout.write(
    created
      ? `${commandName} 已启动并恢复任务投递\n`
      : `${commandName} 已经在运行，任务投递已恢复\n`,
  );
} else if (command === "status") await status();
else if (command === "stop") {
  requireUserTerminal(command);
  await writeFile(stoppedPath, `${new Date().toISOString()}\n`, { mode: 0o600 });
  await setGoalStatus("paused");
  const interrupted = await working();
  if (await running()) {
    await execFileAsync("/opt/homebrew/bin/tmux", ["kill-session", "-t", session]);
    process.stdout.write(
      interrupted
        ? `${commandName} 已停止；进行中的任务已中断，Webhook 事件会继续持久保存。\n`
        : `${commandName} 已停止；Webhook 事件会继续持久保存。\n`,
    );
  } else {
    process.stdout.write(`${commandName} 已经停止；Webhook 事件会继续持久保存。\n`);
  }
} else {
  throw new Error(`用法: ${commandName} [start|status|stop]`);
}
