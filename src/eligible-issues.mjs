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
const { stdout } = await execFileAsync(process.execPath, [join(directory, "token.mjs"), configPath]);
const token = stdout.trim();
const appSlug = config.botLogin.replace(/\[bot\]$/, "");

async function search(author) {
  const query = `repo:${config.repository} is:issue is:open author:${author}`;
  const url = new URL("https://api.github.com/search/issues");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "100");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "whose-agent-eligible-issues",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`issue search failed for ${author}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).items;
}

const groups = await Promise.all([
  search(config.humanLogin),
  search(`app/${appSlug}`),
]);
const issues = [...new Map(groups.flat().map((issue) => [issue.number, issue])).values()]
  .sort((left, right) => right.number - left.number)
  .map((issue) => ({
    number: issue.number,
    author: issue.user.login,
    title: issue.title,
    url: issue.html_url,
  }));

process.stdout.write(`${JSON.stringify({ eligibleOpenCount: issues.length, issues }, null, 2)}\n`);
