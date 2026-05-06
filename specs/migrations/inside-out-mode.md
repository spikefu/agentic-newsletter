# Migration: Inside-out (Claude Code) mode

**Language / environment:** New `newsletter` CLI is Node.js 18+
ESM (same runtime as `server.js`). New skill is a `.claude/`
directory with YAML-frontmatter Markdown. New subagent definitions
are `.claude/agents/<name>.md` files. Existing endpoints stay; the
server gains four new `/api/cc/*` endpoints.

This is a **migration spec** describing an additive mode. The
existing Claude API and Ollama paths keep all of their behavior.
When this migration completes, the project supports a third mode
where a Claude Code session — running locally to the user — drives
the newsletter pipeline instead of the server.

## Problem (current state)

Today the server drives the LLM loop. `LLM_PROVIDER=claude` or
`ollama` selects the provider; `server.js` calls Anthropic /
Ollama via `lib/llm.js` and the agent modules in
`agents/*.js`. Constraints this places on the user:

- Requires an API key (or a running Ollama instance) configured in
  `.env`.
- Per-call `max_tokens` and context-window limits are baked into
  per-agent settings.
- Pipeline state lives inside an in-flight Node process; a crashed
  SSE stream loses everything.
- Agents only see the project's CDP wrappers — no MCP servers, no
  Claude Code tools (Read, WebFetch, Bash, etc.).

## Target (post-migration state)

A new `LLM_PROVIDER` value (or run-mode flag) — **Claude Code** —
moves the LLM loop into a CC session running locally on the user's
machine. The user pays no API cost (CC subscription instead). The
user picks the mode in the same toggle that today selects Claude
vs. Ollama.

Both the existing modes and the new mode share the same UI, the
same `cache/` layout, the same CDP tool wrappers, the same prompts.
They differ only in **who drives the loop**.

```
LLM_PROVIDER = claude or ollama:
  server.js  ──calls──▶  Anthropic / Ollama (drives loop server-side)

LLM_PROVIDER = claude-code:
  Claude Code session  ──is──▶  the LLM
      │
      │ runs the loop itself; uses native Read/Write/Bash/WebFetch
      │ + CDP-backed fetch/search via the server's tool endpoints
      ▼
  newsletter CLI  ──┬── connect --session <id>
                    ├── wait
                    ├── next
                    ├── fetch <url>
                    ├── search <q>
                    ├── render
                    ├── event <type> [args]
                    ├── answer  (push elicitor answers)
                    ├── ask-elicitor / await-answers
                    ├── cost-tail / cost-summary
                    └── disconnect (optional)
      │
      └── server.js (existing file, gains four endpoints)
```

## The new mode at a glance

1. The user starts Claude Code in this project. The skill
   (`/newsletter`) registers the session via `newsletter connect
   --session ${CLAUDE_SESSION_ID}` and enters a `wait` loop.
2. The user clicks **Generate** in the web UI with the **Claude
   Code** mode selected. The UI POSTs to `/api/cc/run`. The
   blocked `wait` returns the work item; the CC session cranks
   through phases, pushing status back via `newsletter event`.
3. Each phase's prompt is emitted by `newsletter next` (the
   crank-handle pattern). The model reads `cache/state.json`
   indirectly via `next`, fills the JSON artifact for that phase
   (clusters, newsletter), and runs `next` again.
4. CDP-backed tools (`fetch`, `search`, PDF render) are reached by
   `newsletter fetch <url>` etc., which call the existing server
   wrappers. CC's own Read/Write/Bash tools handle the local file
   side.

A second entry point — `/newsletter` slash command from inside
CC — boots a one-shot run when the user already has CC open in
the project; the web UI is optional in that flow.

## Responsibility split: server stays thin

Design rule: put as much CC-mode functionality as possible into
the `newsletter` CLI. The server gains only the minimum
coordination surface needed for the lotto tube, event fan-out,
and UI status. Everything that is "what does the agent know
locally" — JSONL parsing, cost accounting, phase choreography,
schema validation, state machine — lives in the CLI.

| Concern                              | Server | CLI |
|--------------------------------------|--------|-----|
| Single-slot pending work item        | yes    | reads via `wait` |
| Connection registry (one slot)       | yes    | reads on each invocation |
| SSE fan-out of status events to UI   | yes (existing) | pushes via `event` |
| `POST /api/cc/run` from UI           | yes    | – |
| `GET /api/cc/status` for the UI      | yes    | – |
| Long-poll / heartbeat tracking       | yes    | – |
| CDP wrappers (fetch, search, PDF)    | yes (existing) | – |
| Bookmarklet window resolution        | yes (existing) | – |
| Cost accounting (JSONL parsing)      | –      | yes |
| Subagent session correlation         | –      | yes (mtime + registry) |
| Phase choreography                   | –      | yes (reads `cache/state.json`) |
| Schema validation                    | –      | yes |
| Crank-handle state machine           | –      | yes |

## Server-side coordination

### Single-CC-session assumption

The design assumes one CC session is doing newsletter work at a
time. `newsletter connect` registers it (last-wins on a second
connect). All other subcommands read the registration implicitly
so per-cycle invocations stay terse. `disconnect` is optional —
the server treats `wait` exit and long absence as implicit
disconnect.

### Liveness check on every CLI invocation

Every `newsletter <subcmd>` starts with a small
`GET /api/cc/connection` call to:

1. Confirm the server is reachable (fast-fail, ~30ms).
2. Fetch the currently-registered session id.
3. Verify the calling CLI's expected session matches the
   registered one.

Three failure shapes, each with a clear exit code:

| Code | Shape                  | Message                                                                          |
|------|------------------------|----------------------------------------------------------------------------------|
| 64   | Server unreachable     | "newsletter server not reachable at PORT — start it with `npm start`."           |
| 65   | No connection registered | "no session connected — run `newsletter connect` first."                       |
| 66   | Session mismatch       | "another Claude Code session is connected; this one is not authorized."          |

These three exits also signal `wait`'s catastrophic-loop-stop
contract — the skill stops trying to run subcommands after a
session-mismatch or unreachable-server response.

### Lotto tube

`newsletter wait` blocks; the UI POSTs work to `/api/cc/run`. The
bridge is a single-slot pending request, not a queue:

- One slot for incoming work. POST sets it; the blocked `wait`
  endpoint returns it and clears it.
- Second POST while the slot is full → server returns 409 with
  "run in progress" toast. (Current second-click policy: reject.)
- The Elicitor Q&A bridge has the same shape — a separate
  single-slot pair, run-scoped and short-lived.

### CC presence states

| State            | What's true                                  | Server knows because                                 |
|------------------|----------------------------------------------|------------------------------------------------------|
| **listening**    | CC blocked on `wait`, ready                  | active long-poll connection                          |
| **running**      | CC took a work item and is processing         | slot consumed; run-started not yet run-finished      |
| **reconnecting** | Brief gap between events                     | last activity < 30s, no wait connection currently    |
| **not_connected**| Cold or gone for good                        | no wait, no activity for > 30s                       |

`GET /api/cc/status` returns the current state. The UI polls it
every 2–3s and paints a small header indicator.

### Click handling per state

| State            | Behavior on Generate click                                                                                    |
|------------------|---------------------------------------------------------------------------------------------------------------|
| **listening**    | Enqueue immediately; happy path.                                                                              |
| **running**      | 409 "run in progress" toast.                                                                                  |
| **reconnecting** | Enqueue and hold. Next `wait` within 30s receives it. After 30s, demote to `not_connected` and return 503.    |
| **not_connected**| Reject with onboarding modal: *"Claude Code isn't connected. From a CC session in this project, run `/newsletter` (or `newsletter wait` if you've set up the skill). Then click Generate again."* — do NOT enqueue. |

### Lifecycle markers the skill emits

For `running` to be tracked precisely, the skill brackets each
work item:

```
wait → returns event
newsletter event run-started <run-id>
... (phases, tool calls) ...
newsletter event run-finished <run-id>
wait → ...
```

Heartbeat fallback: while running, the CC session's `event` posts
themselves serve as heartbeats. No event for ~60s → server
demotes `running → not_connected`.

### Mid-run SSE silence

- Server emits SSE `keepalive` every 5s on `/api/stream`.
- If `cc-status` flips to `not_connected` while a run is in
  progress, server emits `error` on the stream: *"Claude Code
  disconnected mid-run. The cache is in a partial state; click
  ↺ Clear & Redo to start fresh."*

### Outgoing event buffering

The existing `_elicitorBuffer` pattern (R19) — buffer events
before the SSE opens, replay on connect — applies unchanged to
CC-mode events. No new mechanism.

## The newsletter CLI surface

`bin/newsletter` is a Node script (registered via `package.json`
`"bin"` so `npm install` puts it on PATH). All subcommands run a
liveness check first (with the three exit codes above).

### Connection lifecycle

- `newsletter connect --session <id>` — registers `<id>` (the
  Claude Code session id) as the currently-active one. Last-wins.
  Optional `--target-window <id>` and `--verbose` get piled here
  so per-cycle commands stay terse.
- `newsletter disconnect` — clears the registration. Optional;
  the server demotes implicitly on long absence.

### The lotto tube and crank handle

- `newsletter wait` — long-poll against `/api/cc/wait`. Blocks
  until a work item is available. Returns one item as JSON, exits
  0. Internal infrastructure noise (server-side long-poll
  timeout, mid-call disconnects during a server restart) is
  absorbed silently. CC only ever sees real events or
  catastrophic exits.
- `newsletter next` — reads `cache/state.json`, decides which
  phase is next, prints a self-contained prompt to stdout, exits.
  The model doesn't need to remember the pipeline structure — the
  CLI carries it. Output is deterministic for a given state.

### Tools (CDP-backed wrappers — server delegations)

- `newsletter fetch <url>` — proxies to the server's existing
  CDP fetch wrapper. Returns text + extracted publication date.
- `newsletter search <query>` — proxies to the server's CDP
  search wrapper. Returns top results.
- `newsletter render` — generates HTML from `cache/newsletter.json`,
  prints to PDF, writes paths back. No model work needed.

### Status push (event channel)

- `newsletter event <type> [args...]` — POSTs to `/api/cc/event`,
  which fans out over the existing SSE channel(s). Mirrors the
  server-side event vocabulary (status, phase, tool_call,
  tool_result, clusters, newsletter, output_ready, done,
  pipeline_cost). Run-lifecycle markers (`run-started`,
  `run-finished`) pass through here too.

### Elicitor Q&A bridging

- `newsletter ask-elicitor <questions.json>` — pushes elicitor
  questions to the UI. Returns immediately.
- `newsletter await-answers <run-id>` — blocks until the UI POSTs
  answers (or sends an empty body = "skip"). Writes
  `cache/elicitor-qa.json`.
- `newsletter answer` — used by tests / CLI fallback to inject
  answers without the UI; the UI normally POSTs directly to
  `/api/cc/answer`.

### Cost telemetry

- `newsletter cost-tail` — stateless, on-demand command. Reads
  persisted byte offsets from `cache/cost-offsets.json`, scans
  the connected session's JSONL plus any subagent JSONLs from the
  recorded offset to current EOF, parses each newly-appended
  assistant line, computes cost via `agents/pricing.js` (imported,
  not duplicated), writes the new offsets back, then emits the
  computed `step_cost` events. The skill calls `cost-tail` after
  each `newsletter event` push so cost is event-paced, not
  interval-paced. No long-running daemon, no 500ms idle polling.
- `newsletter cost-summary` — one-shot total for the current run.

Per-agent labeling: subagent session ids correlate by mtime in
the project-hash directory. The skill writes a small registry
mapping subagent-session → agent name as it dispatches each phase;
the CLI reads it. Result: cost events are labeled "Discovery
· step N", "Research · step N" etc. exactly as today.

## Skill, subagents, and slash command

### `.claude/skills/newsletter-pipeline/`

Skill is a directory with progressive disclosure. `SKILL.md`
≤500 lines is the entry point; reference files load on demand.

- `SKILL.md` — frontmatter + bootstrap. Frontmatter:
  ```yaml
  ---
  name: newsletter-pipeline
  description: Generate a newsletter from open Chrome tabs in this project. Use when the user types /newsletter or asks to run the newsletter pipeline.
  disable-model-invocation: true
  allowed-tools: Bash(newsletter *)
  ---
  ```
  Body says: first run `newsletter connect --session ${CLAUDE_SESSION_ID}`,
  then loop on `newsletter wait` and dispatch each event. No
  embedded phase prompts; those load on demand from
  `${CLAUDE_SKILL_DIR}/phases/`.
- `phases/elicit.md`, `phases/discover.md`, `phases/research.md`,
  `phases/podcast.md` — per-phase crank-handle prompts.
- `schemas/clusters.json`, `schemas/newsletter.json` — JSON
  schemas the model fills in (stencil pattern).
- `README.md` — implementation notes for humans, not loaded by CC.

`SKILL.md` renders once when invoked and stays in the conversation
for the rest of the session via auto-compaction. The bootstrap
is one-shot; no need to re-orient on every `wait` cycle.

### `.claude/agents/newsletter-{elicitor,discovery,research,podcast}.md`

Each phase becomes a Claude Code subagent with its own model and
tool whitelist. Default model assignments (advisory — CC may route
to Ollama, in which case these map to the local model):

- `newsletter-elicitor` → Haiku
- `newsletter-discovery` → Opus
- `newsletter-research` → Opus
- `newsletter-podcast` → Haiku

The crank-handle prompt for each phase becomes the prompt template
the top-level session passes to the subagent via the Agent tool.
Subagent runs to completion, returns the artifact path; top-level
cranks forward.

### `/newsletter` slash command

Entry point for interactive use from inside a CC session. Boots a
one-shot run: reads current Chrome tabs, asks for context inline,
cranks through. The web UI is optional — if running, it sees the
events too (same `newsletter event` calls).

## Phase choreography

Each `newsletter next` invocation picks a phase from
`cache/state.json` and emits a self-contained prompt. The model
never needs to remember pipeline structure.

Agent-facing inputs are markdown (the prompt embeds the tab
list, the discovery clusters, etc., as pre-chewed markdown).
Agent-authored outputs are markdown where the shape is rich
enough that JSON-with-correctly-balanced-braces was costing
recovery turns; the CLI parses the markdown into the on-disk
JSON the renderer wants.

- **elicit** — read the tab list (in the prompt); optionally
  ask 2–3 clarifying questions via the single foreground command
  `elicit-await`; synthesize a 3–5 sentence context block to
  `cache/elicitor-context.txt`. Run `newsletter next`.
- **discover** — for every URL listed in the prompt, run
  `newsletter fetch <url>`. Group fetched content into 3–8
  thematic clusters. Write `cache/clusters.md` in the markdown
  shape from the prompt (`## Title` per cluster, `**Theme:**`
  paragraph, `### Source: <url>` per source, labeled bullets
  for fields). The CLI parses this into `cache/clusters.json`
  via `lib/parseClusters.js`; on parse or schema error the CLI
  appends a record to `cache/.cc/parse-errors.log` (silent
  diagnostic) and returns the errors as a retry prompt. Run
  `newsletter next`.
- **research** — the prompt embeds the discovery clusters as
  markdown (no JSON to read). For 3–8 of the most interesting
  `notable_links`, run `newsletter fetch`. Use `newsletter
  search` for supplemental context. Write `cache/newsletter.md`
  in the markdown shape the prompt documents (`# Title`,
  `**Subtitle:**`, intro, `## Section` blocks with `**Cluster:**`
  + body + `**Key links:**`, reserved `## Closing` and
  `## References`). The CLI parses via `lib/parseNewsletter.js`
  — converting inline markdown links and emphasis to HTML — and
  writes `cache/newsletter.json` for the renderer. Parse and
  schema failures land in `cache/.cc/parse-errors.log` (Fumble
  Log). Run `newsletter next`.
- **render** — `newsletter render` (no model work). Run
  `newsletter event done`.
- **podcast** (on demand) — convert the newsletter to a 3–6
  minute spoken-word script; write `cache/podcast-script.txt`.
  Run `newsletter event podcast-ready`.

## UI changes

A **mode toggle** in the header — *Claude API · Ollama · Claude
Code*. The first two hit `/api/stream` (today's behavior). The
third hits `/api/cc/run` and listens on the same SSE channel for
events fanned out by the server.

A small header indicator paints CC presence (green: listening,
spin: running, gray: not_connected) by polling `/api/cc/status`
every 2–3s.

When the user clicks Generate in CC mode while CC is
`not_connected`, the UI shows an onboarding modal explaining how
to start a session. The click is rejected (no enqueue, since
nothing would pick it up).

## What stays, what changes, what gets added

### Stays exactly as-is
- `lib/llm.js` — Claude + Ollama providers, untouched.
- `agents/*.js` — full chat loops, untouched. The Claude/Ollama
  mode keeps using these.
- `agents/pricing.js` — token-cost rate table. Imported by the
  CLI's cost-tail (single source of truth).
- `tools/browser.js` — CDP wrappers shared by both modes.
- `htmlRenderer.js` — pure function, shared.
- `cache/` layout — both modes write the same artifacts.
- `/api/stream` — unchanged. Existing modes still drive it.

### Modified (small, additive)
- `server.js` — adds the `/api/cc/*` endpoints alongside the
  existing pipeline. No subtractions.
- `public/index.html` — adds the mode toggle, the CC presence
  indicator, and the onboarding modal.
- `package.json` — `"bin": { "newsletter": "./bin/newsletter" }`.

### Gets added (new files / endpoints)

#### CLI
- `bin/newsletter` — the CLI entry point.
- `lib/state.js` — read/write `cache/state.json`.
- `lib/schemas/` — JSON schemas validated by `newsletter next`.
- `lib/crank.js` — phase → prompt-text. Re-exports the existing
  `SYSTEM` consts from `agents/*.js` as crank-handle prompts;
  no duplication.

#### Skill + subagents
- `.claude/skills/newsletter-pipeline/SKILL.md` plus `phases/`, `schemas/`,
  `README.md`.
- `.claude/agents/newsletter-elicitor.md`,
  `.claude/agents/newsletter-discovery.md`,
  `.claude/agents/newsletter-research.md`,
  `.claude/agents/newsletter-podcast.md`.
- `/newsletter` slash command.

#### Server endpoints (additive)
- `POST /api/cc/run` — UI hits this for "Run with Claude Code."
  Sets the single-slot pending work item.
- `GET  /api/cc/wait` — long-poll, backs `newsletter wait`.
- `POST /api/cc/event` — CC pushes status; server fans out via SSE.
- `POST /api/cc/answer` — UI POSTs elicitor answers, unblocks
  `newsletter await-answers`.
- `GET  /api/cc/status` — current presence state for the UI badge.
- `GET  /api/cc/connection` — liveness + registered session id,
  used by the CLI's per-call check.

### The shared-prompt rule

Both modes use the same system prompts. The Claude/Ollama mode
reads them from the existing `SYSTEM` consts in `agents/*.js`; the
CC mode imports the same exported strings via `lib/crank.js`. If
the prompts ever fork, we drift two newsletters apart — keep them
as one source.

## Cost telemetry via JSONL inspection

CC mode does not lose the live cost meter — the CLI reads CC's own
session/subagent JSONL files to compute live per-turn cost. No
cooperation needed from CC itself.

JSONL location: `~/.claude/projects/<project-hash>/<session-id>.jsonl`.
Each assistant line carries `.message.usage` (input_tokens,
output_tokens, cache_read_input_tokens, cache_creation_input_tokens)
and `.message.model`. The set of fields is exactly what
`agents/pricing.js` already prices.

Subagent sessions land in the same project-hash directory as their
own `<sub-session-id>.jsonl` files. The CLI sweeps the directory
rather than tracking just one file.

### Append-only offsets, persisted

JSONLs are append-only, so `cost-tail` only ever reads new bytes.
A small file — `cache/cost-offsets.json` — maps each tracked
session id (the connected top-level id and every known
subagent-session id) to the byte offset already consumed.
`cost-tail` reads the offsets, scans from offset to EOF, prices
the new lines, writes new offsets back. State persists across
CC restarts; `purge` resets it.

### Stateless and on-demand

Because offsets are persisted, `cost-tail` doesn't need to be a
long-running daemon. The skill calls `newsletter cost-tail` after
each `newsletter event` push. Cost is then event-paced — it
naturally tracks every interesting state change (tool calls,
phase boundaries) without idle polling.

### Top-level JSONL is tool-call-signature filtered

The top-level CC session's JSONL contains every turn the user has
in that session — newsletter-related and otherwise. To avoid
charging unrelated turns to a newsletter run, `cost-tail` includes
an assistant turn from the top-level JSONL only if its
`.message.content` contains a `tool_use` block where:

- `name === "Bash"` AND `input.command` starts with `newsletter `, OR
- `name === "Agent"` AND the spawned subagent name starts with `newsletter-`

Subagent JSONLs are 100% newsletter work by construction, so they
are tracked unconditionally — no filtering needed.

This is structural, tamper-proof watermarking: the tool calls the
skill is *already making* are the watermark. No skill cooperation
beyond the tool calls themselves; no separate marker/state file
to maintain; nothing for a crash or clock skew to corrupt.

Edge case (acknowledged): if the model ever takes a *separate*
text-only turn between a tool_result and its next tool call, that
turn has no tool_use block and slips through the filter. In
skill-driven flows the model usually folds an acknowledgment and
the next tool call into one turn; we accept the rare under-
attribution rather than complicate the filter with look-back logic.

### Server-down case

When the server is down (the `/newsletter` slash-command flow with
no web UI), `cost-tail` falls back to printing a one-line summary
to stdout instead of POSTing `step_cost` events. The CC
conversation sees the cost in-line. No fan-out needed.

When the server is up but no UI consumer is connected, the events
still POST to `/api/cc/event`; the existing `_elicitorBuffer`
pattern (R19) buffers them server-side until an SSE consumer
connects, then replays.

### Patterns this leans on

- **Conversation Transcript**
  (`~/.claude/personal/patterns/conversation-transcript.md`) — the
  JSONL location, line types, content shapes.
- **ark JSONLChunkFunc** (`~/work/ark/db.go:2704`) — reference for
  fast line-by-line scanning. The newsletter CLI is Node, not Go,
  but the structural ideas (incremental scan, key extraction by
  byte offset, depth-aware top-level field finder) port directly.

### Caveats

- A new model not in `pricing.js` prices at 0 (current behavior —
  graceful degradation).
- CC routed to Ollama may have missing/oddly-shaped usage
  fields — CLI detects and reports "n/a" without crashing.
- Thinking blocks are skipped from cost output by default.

## Two entry points

### A. From the web UI (mode toggle)

User picks **Claude Code** in the toggle, clicks Generate.
- UI POSTs to `/api/cc/run`.
- A CC session somewhere is running `newsletter wait` — picks up.
- Cranks through phases; pushes status via `newsletter event`.
- UI receives events on the same SSE channel.

Requires: a CC session running with the newsletter skill loaded.
"Start your CC session, then click Generate" is the flow.

### B. From inside Claude Code (`/newsletter`)

User types `/newsletter` in CC.
- The slash command boots a one-shot run.
- Output renders to the conversation; HTML/PDF land in `cache/`
  and `dist/` like normal.
- Web UI is optional — if running, it sees the events too.

Requires: nothing beyond CC being open in the project.

### Server lifecycle

For B, the server can be stopped — the CLI talks to local files
for state and only uses the server for `wait` / `event` fan-out;
the CLI falls back to local-only when the server isn't reachable.
For A, the server must be up.

## Failure modes (summary)

| Failure                                  | Behavior                                                 |
|------------------------------------------|----------------------------------------------------------|
| Server not running (CLI side)            | Exit 64; clear message                                    |
| No connection registered                 | Exit 65; clear message                                    |
| Session mismatch                         | Exit 66; clear message                                    |
| CC dies mid-run                          | Heartbeat times out; UI gets `error` on SSE; cache marked partial |
| `/api/cc/run` while running              | 409 "run in progress" toast                               |
| `/api/cc/run` while not_connected        | Onboarding modal; no enqueue                              |
| `/api/cc/run` while reconnecting → 30s   | 503; user re-clicks once CC reappears                     |
| Schema validation fails on artifact      | CLI exits non-zero with the validation error; phase retried |

## Out of scope for v1

- **Cancel button.** Adding `🛑 Cancel` would deliver
  `{ kind: 'cancel', run-id }` to a third lotto channel that CC
  polls between phases. Future enhancement.
- **Multiple concurrent CC sessions.** Last-wins on `connect` is
  the v1 contract. A real registry would handle multiple users
  but invites design questions we don't have.
- **Surfacing prior events on UI reconnect.** Mid-run page reload
  sees only events from connect-time onward, matching today's
  behavior in API mode. Pre-existing limitation.
- **Custom server-down fallback page** (already out of scope per
  the bookmarklet feature's policy).

## Implementation order

The migration ships in three slices in this order:

1. **CLI skeleton** — `bin/newsletter` with `connect`, `wait`,
   `next`, `event`, `disconnect` working end-to-end against a
   stub state machine. Server gets `/api/cc/run`, `/api/cc/wait`,
   `/api/cc/event`, `/api/cc/connection`, `/api/cc/status`. Proves
   the lotto-tube + crank-handle shape.
2. **Slash command + Discovery only** — `.claude/skills/newsletter-pipeline/`
   with the SKILL.md bootstrap and a single phase
   (`phases/discover.md`); the `newsletter-discovery` subagent;
   `/newsletter` slash command. Proves the inside-out prompt
   actually drives Claude Code well.
3. **Mode toggle, full phases, telemetry** — UI changes for the
   toggle and presence indicator, the remaining phase prompts and
   subagents, `cost-tail` / `cost-summary`, schema validation.
   Both entry points fully working.
