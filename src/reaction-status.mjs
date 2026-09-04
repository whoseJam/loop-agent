#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readInstanceConfig, resolveInstance } from "./instance.mjs";

const execFileAsync = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const { configPath } = resolveInstance(process.argv[2]);
const config = await readInstanceConfig(configPath);
const commentKind = process.argv[3];
const commentId = process.argv[4];
const stage = process.argv[5];
const reactions = {
  received: "eyes",
  started: "rocket",
  completed: "hooray",
};

if (!new Set(["issue", "review"]).has(commentKind)) {
  throw new Error("comment kind must be issue or review");
}
if (!/^\d+$/.test(commentId ?? "")) {
  throw new Error("comment id must be numeric");
}
if (!reactions[stage]) {
  throw new Error("stage must be received, started, or completed");
}

const { stdout } = await execFileAsync(process.execPath, [
  join(directory, "token.mjs"),
  configPath,
]);
const token = stdout.trim();
const endpointKind = commentKind === "issue" ? "issues" : "pulls";
const response = await fetch(
  `https://api.github.com/repos/${config.repository}/${endpointKind}/comments/${commentId}/reactions`,
  {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "whose-agent-reaction-status",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ content: reactions[stage] }),
  },
);
if (!response.ok) {
  throw new Error(`reaction failed: ${response.status} ${await response.text()}`);
}
const reaction = await response.json();
process.stdout.write(
  `${JSON.stringify({ ok: true, stage, content: reaction.content, reactionId: reaction.id })}\n`,
);
