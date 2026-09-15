import { spawn } from "node:child_process";
import readline from "node:readline";

export async function setThreadGoal(config, status, objective) {
  const child = spawn(config.codexPath, ["app-server"], {
    cwd: config.cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  let nextId = 1;
  const pending = new Map();

  function rejectPending(error) {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }

  child.on("error", rejectPending);
  child.on("exit", (code, signal) => {
    if (pending.size === 0) return;
    rejectPending(
      new Error(
        `Codex app-server exited before replying (${signal ?? `code ${code}`})`,
      ),
    );
  });

  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      rejectPending(error);
      return;
    }
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
    return status === "get"
      ? await request("thread/goal/get", { threadId: config.threadId })
      : await request("thread/goal/set", {
          threadId: config.threadId,
          status,
          ...(status === "active" ? { objective } : {}),
        });
  } finally {
    child.stdin.end();
  }
}
