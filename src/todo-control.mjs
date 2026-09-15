#!/usr/bin/env node

import { join } from "node:path";
import { addManualTodo, completeTodo, unfinishedTodos } from "./todo.mjs";
import { resolveInstance } from "./instance.mjs";

const { instanceDirectory } = resolveInstance(process.argv[2]);
const todoPath = join(instanceDirectory, "todo.md");
const command = process.argv[3] ?? "list";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

if (command === "list") {
  const items = await unfinishedTodos(todoPath);
  process.stdout.write(items.length > 0 ? `${items.join("\n")}\n` : "没有未完成 TODO\n");
} else if (command === "add") {
  const summary = option("--summary");
  if (!summary) throw new Error("add requires --summary");
  const id = await addManualTodo(todoPath, summary, option("--source") ?? "TUI");
  process.stdout.write(`${id}\n`);
} else if (command === "complete") {
  const id = process.argv[4];
  const evidence = option("--evidence");
  if (!id || !evidence) throw new Error("complete requires an ID and --evidence");
  const changed = await completeTodo(todoPath, id, evidence);
  process.stdout.write(changed ? `completed ${id}\n` : `already completed ${id}\n`);
} else {
  throw new Error("usage: todo-control.mjs CONFIG [list|add|complete]");
}

