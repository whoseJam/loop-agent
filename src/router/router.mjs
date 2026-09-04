#!/usr/bin/env node

import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const configPath = process.argv[2];
if (!configPath) throw new Error("router config path is required");
const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
const host = config.host;
const port = config.port;
const webhookPath = config.webhookPath;
const maxBodyBytes = config.maxBodyBytes;
const routes = new Map(
  config.routes.map(({ repository, targetPort }) => [repository, targetPort]),
);

function respond(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function proxy(request, response, body, targetPort) {
  const upstream = httpRequest(
    {
      host,
      port: targetPort,
      path: webhookPath,
      method: "POST",
      headers: {
        ...request.headers,
        host: `${host}:${targetPort}`,
        "content-length": body.length,
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      respond(response, 503, { ok: false, error: "repository bridge unavailable" });
    } else {
      response.destroy();
    }
  });
  upstream.end(body);
}

async function health(response) {
  const repositories = {};
  await Promise.all(
    [...routes.entries()].map(async ([repository, targetPort]) => {
      try {
        const result = await fetch(`http://${host}:${targetPort}/healthz`);
        repositories[repository] = { ok: result.ok, ...(await result.json()) };
      } catch {
        repositories[repository] = { ok: false };
      }
    }),
  );
  const ok = Object.values(repositories).every((value) => value.ok);
  respond(response, ok ? 200 : 503, { ok, repositories });
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      await health(response);
      return;
    }
    if (request.method !== "POST" || request.url !== webhookPath) {
      respond(response, 404, { ok: false, error: "not found" });
      return;
    }
    const body = await readBody(request);
    const payload = JSON.parse(body.toString("utf8"));
    const repository = payload.repository?.full_name;
    const targetPort = routes.get(repository);
    if (!targetPort) {
      respond(response, 202, { ok: true, routed: false });
      return;
    }
    proxy(request, response, body, targetPort);
  } catch {
    respond(response, 400, { ok: false, error: "invalid webhook request" });
  }
}).listen(port, host, () => {
  process.stdout.write(
    `${new Date().toISOString()} [whose-agent-router] listening ${host}:${port}\n`,
  );
});
