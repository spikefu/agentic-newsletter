# Sequence: CC mode — skill bootstrap and wait loop
**Requirements:** R155, R158, R161, R162, R190

The user starts Claude Code in this project. The skill registers
the session via `connect`, then enters a `wait` loop that blocks
until the UI POSTs work or the server tells it to stop.

```
User       Claude Code      NewsletterSkill         NewsletterCli         Server
  |             |                |                       |                  |
  |- /newsletter|                |                       |                  |
  |             |- load skill --> SKILL.md renders into context              |
  |             |                |                       |                  |
  |             |- Bash --------------------------------> connect --session ${CLAUDE_SESSION_ID}
  |             |                                        |- POST /api/cc/connection ->|
  |             |                                        |<-------- 200 ok -----------|
  |             |<-- registered  |                       |                  |
  |             |                |                       |  (presence: listening when wait connects)
  |             |- Bash --------------------------------> wait
  |             |                                        |- GET /api/cc/wait (long-poll) ->|
  |             |                                        |  ... blocks ...                 |
  |             |                                        |  (no events; server-side        |
  |             |                                        |   timeout → re-poll silently)   |
  |             |                                        |                                 |
  |             |                                        |<-- 200 { kind: "run", ... } ----|
  |             |<-- event JSON  |                       |                                 |
  |             |   (skill dispatches to a subagent;     |                                 |
  |             |    see seq-cc-run.md)                  |                                 |
```

Notes:
- Connect is once-per-skill-load; `cache/connection.json` (written
  by `connect`) lets later subcommands stay terse — they read the
  registration implicitly.
- `wait` absorbs infrastructure noise (server-side long-poll
  timeout, mid-call disconnects during a server restart). The
  caller only ever sees real events or catastrophic exits (e.g.
  exit 52 = "server gone for good").
- Server presence flips listening → running when `wait` returns
  with an event; flips back when the skill emits `event
  run-finished` or after the heartbeat times out.
