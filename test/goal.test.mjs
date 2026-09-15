import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setThreadGoal } from "../src/goal.mjs";

test("activates a completed goal without starting another Node process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-agent-goal-"));
  const codexPath = join(directory, "fake-codex");
  const requestsPath = join(directory, "requests.jsonl");
  const script = `#!/bin/sh
exec "${process.execPath}" -e '
const fs = require("node:fs");
const readline = require("node:readline");
const output = ${JSON.stringify(requestsPath)};
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(output, line + "\\n");
  if (request.id !== undefined) {
    process.stdout.write(JSON.stringify({ id: request.id, result: { ok: true } }) + "\\n");
  }
});
' "$@"
`;

  try {
    await writeFile(codexPath, script);
    await chmod(codexPath, 0o700);
    const result = await setThreadGoal(
      {
        codexPath,
        cwd: directory,
        threadId: "thread-1",
      },
      "active",
      "continue durable work",
    );
    assert.deepEqual(result, { ok: true });
    const requests = (await readFile(requestsPath, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(requests[0].method, "initialize");
    assert.equal(requests[1].method, "initialized");
    assert.deepEqual(requests[2], {
      method: "thread/goal/set",
      id: 2,
      params: {
        threadId: "thread-1",
        status: "active",
        objective: "continue durable work",
      },
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});
