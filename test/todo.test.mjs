import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addManualTodo,
  completeTodo,
  recordTodoEvents,
  unfinishedTodos,
} from "../src/todo.mjs";

test("records deliveries idempotently and retains completion evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-agent-todo-"));
  const path = join(directory, "todo.md");
  const event = {
    delivery: "delivery-1",
    event: "issue_comment",
    action: "created",
    receivedAt: "2026-09-15T00:00:00Z",
    senderLogin: "human-user",
    resourceKind: "issue",
    number: 42,
    title: "修复清理时序",
    url: "https://github.com/example/repository/issues/42",
    comment: { body: "批准处理" },
  };

  try {
    assert.deepEqual(await recordTodoEvents(path, [event]), ["delivery-1"]);
    assert.deepEqual(await recordTodoEvents(path, [event]), []);
    assert.equal((await unfinishedTodos(path)).length, 1);
    assert.equal(await completeTodo(path, "delivery-1", "PR #43 已创建"), true);
    assert.equal(await completeTodo(path, "delivery-1", "重复核销"), false);
    assert.deepEqual(await unfinishedTodos(path), []);
    const content = await readFile(path, "utf8");
    assert.equal(content.match(/delivery-1/g)?.length, 1);
    assert.match(content, /- \[x\]/);
    assert.match(content, /PR #43 已创建/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("adds direct TUI work to the same ledger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-agent-todo-"));
  const path = join(directory, "todo.md");
  try {
    const id = await addManualTodo(path, "更新持久任务机制", "whoseJam");
    assert.match(id, /^manual-/);
    assert.equal((await unfinishedTodos(path)).length, 1);
    assert.match(await readFile(path, "utf8"), /更新持久任务机制/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("serializes concurrent delivery recording without losing entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-agent-todo-"));
  const path = join(directory, "todo.md");
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        recordTodoEvents(path, [
          {
            delivery: `delivery-${index}`,
            event: "check_run",
            action: "completed",
            receivedAt: "2026-09-15T00:00:00Z",
            senderLogin: "human-user",
            resourceKind: "pull_request",
            number: 42,
            title: `检查 ${index}`,
          },
        ]),
      ),
    );
    assert.equal((await unfinishedTodos(path)).length, 20);
  } finally {
    await rm(directory, { recursive: true });
  }
});
