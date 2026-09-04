# loop-agent

`loop-agent` runs long-lived, event-driven Codex agents for multiple GitHub
repositories. Runtime code lives here; each agent's configuration, durable
webhook queue, logs, stop marker, thread ID, and credentials remain in a local
instance directory and are never committed to this repository.

## Lifecycle

There are two lifecycle operations:

```text
loop-agent /path/to/instance/config.json start
loop-agent /path/to/instance/config.json stop
```

`start` starts the TUI if needed, activates the existing Goal, and resumes
delivery of saved webhook events. `stop` disables delivery, pauses the Goal,
and closes the TUI. `status` is a read-only diagnostic command. Omitting the
operation starts the agent and attaches to its TUI.

Configuration is passed explicitly by file path through every process boundary;
instance selection does not depend on environment variables. See
`config/instance.example.json` and `config/router.example.json`.

## Components

- `src/control.mjs`: TUI and Goal lifecycle.
- `src/bridge.mjs`: signed GitHub webhook ingestion and durable dispatch.
- `src/router/`: repository routing and failed-delivery recovery.
- `src/token.mjs`: GitHub App authentication. Each instance owns tiny `gh` and
  askpass adapters so their fixed configuration path remains explicit.
- `src/create-worker.mjs`: dedicated Codex thread creation.

`WHOSE_AGENT_WORKER=1` is retained only as a security identity marker that
prevents an agent from controlling its own lifecycle; it does not select or
configure an instance.
