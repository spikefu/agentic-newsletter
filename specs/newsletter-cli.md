# Newsletter CLI (`bin/newsletter`)

**Language / environment:** Node.js 18+ ESM. Registered as a `"bin"`
entry in `package.json` so `npm install` puts `newsletter` on the
shell PATH. Talks to the project's running Express server over
HTTP for coordination; reads and writes the project's `cache/`
directory directly for state.

The newsletter CLI is the bridge between a Claude Code session and
the newsletter pipeline. When a Claude Code session is driving the
pipeline (instead of the server's own LLM loop), the skill running
inside that session calls `newsletter` subcommands to wait for work,
emit the next phase's prompt, push status events back to the UI,
proxy CDP-backed tool calls through to the server, and surface
per-step cost.

The CLI is also the entry point for the inside-CC `/newsletter`
slash command — a single-shot run that doesn't need the web UI
running at all.

## Liveness check on every invocation

Every subcommand starts with a `GET /api/cc/connection` call to:

1. Confirm the server is reachable (fast-fail).
2. Fetch the currently-registered Claude Code session id.
3. Verify the calling CLI's expected session matches the
   registered one.

Failures map to three exit codes with clear messages:

| Code | Shape                    | Message                                                                  |
|------|--------------------------|--------------------------------------------------------------------------|
| 64   | Server unreachable       | "newsletter server not reachable at PORT — start it with `npm start`."   |
| 65   | No connection registered | "no session connected — run `newsletter connect` first."                 |
| 66   | Session mismatch         | "another Claude Code session is connected; this one is not authorized."  |

These three exits also signal the skill's catastrophic-loop-stop
contract — the skill stops trying to run subcommands after a
session-mismatch or unreachable-server response.

## Connection lifecycle

- `newsletter connect --session <id>` registers `<id>` (the Claude
  Code session id) as the currently-active one. Last-wins: a second
  `connect` from a different session takes over. Pile-on parameters
  like `--target-window <id>` and `--verbose` get attached at
  connect time so per-cycle subcommands stay terse.
- `newsletter disconnect` clears the registration. Optional — the
  server treats `wait` exit and inactivity over 30s as implicit
  disconnect.

## Lotto tube and crank handle

- `newsletter wait` long-polls `/api/cc/wait`. Blocks until a work
  item is available, returns one item as JSON, exits 0.
  Infrastructure noise — server-side long-poll timeouts, mid-call
  disconnects during a server restart — is absorbed silently. The
  caller only ever sees real events or catastrophic exits.
- `newsletter next` reads `cache/state.json`, decides which phase is
  next, prints a self-contained prompt to stdout, exits. The model
  doesn't need to remember the pipeline structure — the CLI carries
  it. Output is deterministic for a given state. Schema validation
  on the previous phase's artifact runs here; a validation failure
  exits non-zero with the validation error, and the phase is
  retried.

## CDP-backed tool wrappers

These proxy through to the server's existing CDP wrappers so a CC
session running locally has the same Chrome-driving primitives the
server-side agents use:

- `newsletter fetch <url>` — text + extracted publication date.
- `newsletter search <query>` — DuckDuckGo HTML scrape.
- `newsletter render` — generates HTML from `cache/newsletter.json`,
  prints to PDF, writes paths back. No model work needed.

## Status events and elicitor bridging

- `newsletter event <type> [args...]` POSTs to `/api/cc/event`,
  which fans out over the same SSE channel API mode uses. The event
  vocabulary mirrors the server-side one (status, phase, tool_call,
  tool_result, clusters, newsletter, output_ready, done,
  pipeline_cost). Run-lifecycle markers (`run-started`,
  `run-finished`) pass through here too — the skill brackets each
  work item with these so the server can track the `running` state
  precisely.
- `newsletter ask-elicitor <questions.json>` pushes elicitor
  questions to the UI and returns immediately.
- `newsletter await-answers <run-id>` blocks until the UI POSTs
  answers (or sends an empty body = "skip"). Writes
  `cache/elicitor-qa.json`.
- `newsletter answer` is a test/CLI fallback that injects answers
  without the UI; the UI normally POSTs directly to
  `/api/cc/answer`.

## Cost telemetry

CC mode does not lose the live cost meter — the CLI reads CC's own
session and subagent JSONL files to compute live per-turn cost. No
cooperation needed from CC itself.

JSONL location:
`~/.claude/projects/<project-hash>/<session-id>.jsonl`. Each
assistant line carries `.message.usage` (input_tokens,
output_tokens, cache_read_input_tokens,
cache_creation_input_tokens) and `.message.model`. The set of
fields is exactly what the existing `agents/pricing.js` rate table
already prices.

Subagent sessions land in the same project-hash directory as their
own `<sub-session-id>.jsonl` files. The CLI sweeps the directory.

- `newsletter cost-tail` is stateless and event-paced. It reads
  byte offsets from `cache/cost-offsets.json`, scans each tracked
  JSONL from offset to EOF, prices new assistant lines via
  `agents/pricing.js`, writes new offsets back, and emits
  `step_cost` events. The skill calls it after each `newsletter
  event` push so cost tracks every interesting state change without
  idle polling.
- `newsletter cost-summary` produces a one-shot total for the
  current run.

Subagent JSONLs are tracked unconditionally (100% newsletter work
by construction). The top-level CC session's JSONL is filtered: a
turn is included only if its `.message.content` has a `tool_use`
block where (`name === "Bash"` AND `input.command` starts with
`newsletter `) OR (`name === "Agent"` AND the spawned agent name
starts with `newsletter-`). This is structural, tamper-proof
watermarking — the tool calls the skill is *already making* are the
watermark.

Per-agent labeling: subagent session ids correlate via mtime
ordering and a small registry the skill writes mapping
subagent-session → agent name. Cost events are labeled "Discovery
· step N" / "Research · step N" exactly as in API mode.

A model not in `pricing.js` prices at 0 (graceful degradation,
matches API-mode behavior). When CC is routed to Ollama,
`cost-tail` detects missing or malformed usage fields and reports
"n/a" without crashing.

## Server-down behavior

When the server is unreachable, CLI subcommands that read or write
only local state (`next` prompt emission, schema validation,
`render`) operate locally. CLI subcommands that need the server
(`wait`, `event`, `ask-elicitor`, `await-answers`, `connect`)
exit 64.

`cost-tail` falls back to printing a one-line summary to stdout
instead of POSTing `step_cost` events when the server is down — the
CC conversation sees the cost in-line.
