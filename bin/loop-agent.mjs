#!/usr/bin/env node

if (!process.argv[2]) {
  throw new Error("用法: loop-agent <instance-config.json> [start|status|stop]");
}

await import("../src/control.mjs");
