import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function resolveInstance(configArgument) {
  if (!configArgument) {
    throw new Error("a loop-agent instance config path is required");
  }
  const configPath = resolve(configArgument);
  return { configPath, instanceDirectory: dirname(configPath) };
}

export async function readInstanceConfig(configPath) {
  return JSON.parse(await readFile(configPath, "utf8"));
}
