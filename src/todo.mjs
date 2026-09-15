import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

const header = `# Loop Agent TODO

这是 Agent 线程持久、可读的任务账本。Webhook delivery 会在进入 Codex
队列之前登记。Agent 必须保持条目未勾选，直到对应工作真正完成，再使用
\`todo-control.mjs complete\` 勾选并记录完成证据。

不得删除未完成条目。消息投递不等于任务完成。
`;

function oneLine(value, maximum = 1_000) {
  if (value === null || value === undefined) return "";
  const text = String(value).replaceAll("\r", " ").replaceAll("\n", " ").trim();
  const shortened = text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
  return shortened.replaceAll("`", "\\`");
}

function markerId(id) {
  return Buffer.from(String(id)).toString("base64url");
}

function marker(id, closing = false) {
  return `<!-- ${closing ? "/" : ""}loop-agent-todo:${markerId(id)} -->`;
}

function eventSummary(event) {
  const resource =
    event.number === null || event.number === undefined
      ? event.resourceKind ?? "event"
      : `${event.resourceKind ?? "resource"} #${event.number}`;
  return oneLine(
    event.title ??
      event.comment?.body ??
      event.review?.body ??
      event.check?.name ??
      `${event.event ?? "message"}/${event.action ?? "received"}`,
  );
}

function renderEntry(event) {
  const id = String(event.delivery);
  const source = `${event.event ?? "message"}/${event.action ?? "received"}`;
  const target = event.url ? ` [${oneLine(event.resourceKind ?? "resource")}](${event.url})` : "";
  const details = event.comment?.body ?? event.review?.body ?? null;
  return [
    marker(id),
    `- [ ] \`${oneLine(id)}\` — ${eventSummary(event)}${target}`,
    `  - 接收：${oneLine(event.receivedAt ?? new Date().toISOString())}`,
    `  - 来源：${oneLine(source)}；sender=${oneLine(event.senderLogin ?? "unknown")}`,
    ...(details ? [`  - 消息：${oneLine(details)}`] : []),
    marker(id, true),
  ].join("\n");
}

async function readOrInitialize(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return `${header}\n`;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function withLedgerLock(path, action) {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 5_000;
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lockPath)).mtimeMs;
      if (age > 30_000) {
        await rm(lockPath, { recursive: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out locking ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true });
  }
}

export async function recordTodoEvents(path, events) {
  return withLedgerLock(path, async () => {
    let content = await readOrInitialize(path);
    const added = [];
    for (const event of events) {
      if (!event?.delivery || content.includes(marker(event.delivery))) continue;
      content = `${content.trimEnd()}\n\n${renderEntry(event)}\n`;
      added.push(String(event.delivery));
    }
    if (added.length > 0 || !(await fileExists(path))) {
      await atomicWrite(path, content);
    }
    return added;
  });
}

export async function addManualTodo(path, summary, source = "TUI") {
  const delivery = `manual-${randomUUID()}`;
  await recordTodoEvents(path, [
    {
      delivery,
      event: "human_message",
      action: "received",
      receivedAt: new Date().toISOString(),
      senderLogin: source,
      resourceKind: "thread",
      number: null,
      title: summary,
      url: null,
    },
  ]);
  return delivery;
}

export async function completeTodo(path, id, evidence) {
  return withLedgerLock(path, async () => {
    const content = await readOrInitialize(path);
    const opening = marker(id);
    const closing = marker(id, true);
    const start = content.indexOf(opening);
    const end = content.indexOf(closing, start + opening.length);
    if (start < 0 || end < 0) throw new Error(`TODO entry not found: ${id}`);
    const blockEnd = end + closing.length;
    const block = content.slice(start, blockEnd);
    if (/^- \[x\]/m.test(block)) return false;
    const completed = block
      .replace("- [ ]", "- [x]")
      .replace(
        `\n${closing}`,
        `\n  - 完成：${new Date().toISOString()} — ${oneLine(evidence)}\n${closing}`,
      );
    await atomicWrite(path, `${content.slice(0, start)}${completed}${content.slice(blockEnd)}`);
    return true;
  });
}

export async function unfinishedTodos(path) {
  const content = await readOrInitialize(path);
  return content
    .split("\n")
    .filter((line) => line.startsWith("- [ ] "));
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
