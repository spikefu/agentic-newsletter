# NewsletterCli
**Requirements:** R155, R156, R157, R158, R159, R160, R161, R162, R165, R166, R167, R168, R169, R170, R171, R172, R173, R217

The `bin/newsletter` Node binary that the Claude Code session
drives. Every subcommand starts with a liveness check; subcommands
are thin shells that POST/GET against the server's `/api/cc/*`
endpoints (or read/write local cache files for state-only commands).

## Knows
- The server's HTTP base URL (`PORT` from `.env`, default 3002)
- Its own session id (passed via `connect --session`, then
  persisted to `cache/connection.json`)
- The CLI subcommand routing table

## Does
- `connect --session <id> [--target-window <id>] [--verbose]` —
  POSTs to `/api/cc/connection` to register this session as the
  active one. Last-wins; pile-on parameters are stored alongside
  the registration so per-cycle invocations stay terse
- `disconnect` — clears the registration; optional cleanup
- Liveness check on every other subcommand: `GET /api/cc/connection`
  validates server reachable + correct session registered. Exits
  64 (server unreachable), 65 (no connection registered), or 66
  (session mismatch) on failure
- `wait` — long-polls `GET /api/cc/wait`. Internally absorbs server-
  side timeouts and reconnects during a server restart; the caller
  only ever sees real events or catastrophic exits
- `next` — delegates to CrankHandle to read state, validate the
  prior phase's artifact, and print the next phase's prompt
- `fetch <url>` — POSTs to a server endpoint that wraps the
  existing CDP `fetchPage`; returns text + extracted publication
  date
- `search <query>` — POSTs to a server endpoint that wraps the
  existing CDP `webSearch`
- `render` — generates HTML from `cache/newsletter.json` via
  the existing HtmlRenderer, prints to PDF via the server's CDP
  `printToPDF`. No model work
- `event <type> [args...]` — POSTs to `/api/cc/event`; the server
  fans out via SSE. The skill brackets each work item with
  `event run-started <run-id>` / `event run-finished <run-id>`
- `ask-elicitor <questions.json>` — pushes elicitor questions to
  the UI; returns immediately
- `await-answers <run-id>` — blocks on `POST /api/cc/answer`;
  writes `cache/elicitor-qa.json` when answers arrive (or empty
  body = "skip")
- `answer` — test/CLI fallback that injects answers without the UI
- Server-down fallback for entry B: state-only subcommands (`next`
  prompt emission, schema validation, `render`) operate locally
  when the server is unreachable; subcommands that need the server
  exit 64

## Collaborators
- Server: every server-touching subcommand goes through `/api/cc/*`
- CrankHandle: `next` delegates here for state + phase prompts
- CostTracker: invoked by the skill after each `event` push (not
  directly by NewsletterCli, but cost-tail / cost-summary live in
  the same binary)
- HtmlRenderer: `render` calls it (shared with API-mode pipeline)
- BrowserTools: indirectly — the server wraps `fetchPage`,
  `webSearch`, `printToPDF` for the CLI's `fetch` / `search` /
  `render`

## Sequences
- seq-cc-bootstrap.md
- seq-cc-run.md
- seq-cc-elicitor.md
