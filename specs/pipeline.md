# Pipeline orchestration

**Language / environment:** Node.js 18+, ECMAScript modules, Express
HTTP server, Server-Sent Events (SSE) for streaming progress to a
single browser client.

The newsletter pipeline turns the user's currently-open Chrome tabs
into a polished, link-rich newsletter. It is started from the web
UI and runs as four stages:

1. **Elicit** (optional) — before the main run, ask 2–3 clarifying
   questions about what the user was reading and who will read the
   output. Skippable.
2. **Discover** — fetch every open tab, extract content and
   publication dates, and group everything into 3–8 thematic
   clusters.
3. **Research** — for each cluster, follow notable downstream links,
   optionally run a web search, then write the full newsletter.
4. **Podcast** (on demand) — convert the finished newsletter into a
   spoken-word script.

## How it runs

A single user click in the web UI starts the pipeline. The server
streams progress events back to the browser over an SSE connection
so the user sees activity, costs, thinking output, tool calls, and
phase changes live. Stages 1–3 run in order on a single SSE stream;
stage 4 (Podcast) runs on its own SSE stream when the user clicks
"Podcast" after the newsletter is ready.

Only one pipeline run is supported at a time per server instance.

## Run modes

The pipeline supports three start modes from the UI:

- **Fresh run** — Discover then Research. Any prior newsletter
  output is cleared but cached cluster data is preserved (for
  inspection). If clusters are already cached and the user did not
  ask to redo, the cached clusters are reused and Research runs
  alone.
- **Research-only** (`phase=2`) — skip Discover, reuse cached
  clusters, run Research only. The "⚡ Research Only" button.
- **Clear & redo** (`redo=true`) — clear all cached artifacts (
  clusters, newsletter, HTML, PDF, podcast script, cost,
  elicitor-synthesized context) before running. The "↺ Clear &
  Redo" button.

A separate **purge** action ("🗑") deletes every file in the cache
directory unconditionally — used to start completely fresh.

These same modes work in all three LLM-driver configurations —
Claude API, Ollama, and Claude Code (see "Claude Code mode
coordination" below).

## What the pipeline produces

Each successful run writes a set of artifacts to the project's
cache directory:

- A clusters JSON document — the Discovery stage's output.
- A newsletter JSON document — the Research stage's output.
- A standalone HTML newsletter rendered from the JSON.
- A printed PDF of the HTML newsletter (best-effort — the PDF step
  is allowed to fail without failing the whole run).
- A podcast script (only when the user explicitly requests one).
- A cost summary covering per-stage and grand-total costs.

The user can click "Save" to copy the HTML, PDF, JSON, and podcast
script (whichever exist) to a timestamped subdirectory of `dist/`,
preserving past runs across future regenerations.

## Live progress events

The browser sees a stream of typed events while the pipeline runs.
The set of event types is:

- `model_info` — provider and model identity (sent first)
- `phase` — phase boundary marker (Elicitor / Discovery /
  Research / Podcast)
- `status` — short status message (e.g. "Fetching: <url>")
- `prompt` — the full system + messages array submitted to the LLM
  for the current step (Advanced mode only)
- `thinking` — the model's chain of thought for the current step
  (Advanced mode only)
- `agent_text` — the model's plain-text output for the current step
- `tool_call` — the agent has called a named tool with arguments
- `tool_result` — the tool returned (no payload, just confirmation)
- `step_cost` — per-step token counts, cost, elapsed time, tokens
  per second
- `tabs` — the list of open Chrome tabs being processed
- `clusters` — Discovery's clustering result
- `newsletter` — Research's finished newsletter object
- `output_ready` — paths to the rendered HTML / PDF
- `pipeline_cost` — final per-stage and grand-total cost summary
- `done` — terminal success
- `error` — terminal failure
- Elicitor-only: `elicit_questions`, `elicit_ready`,
  `elicit_synthesized` (these may be buffered before the SSE
  stream opens and replayed on connect)

## Pre-run elicitor buffering

The elicitor runs in response to a different HTTP endpoint than the
SSE stream, so any `step_cost` and other events it emits before the
SSE stream opens are buffered server-side and replayed as the
first events when the SSE stream connects. This keeps the cost
meter and activity log complete from the user's perspective.

## Failure handling

- Any stage may abort the run by emitting an `error` event and
  closing the SSE stream. The cache is left in whatever partial
  state existed at the failure point.
- A failed PDF render does not fail the run — the user gets an
  HTML newsletter and a `status` event explaining the PDF skip.
- A failed podcast generation only affects the podcast stream; the
  newsletter is unaffected.

## Claude Code mode coordination

When the user picks Claude Code as the run mode (third option in
the header toggle), the LLM loop runs inside a Claude Code session
on the user's machine instead of in the server's process. The
server's role narrows: it coordinates between the UI and the CC
session and fans events out over the existing SSE channel. All
modes share the cache layout, prompt files, CDP tool wrappers, the
UI, and the SSE event vocabulary; they differ only in who drives
the loop.

### `/api/cc/*` endpoints

Six additive endpoints handle the CC bridge. They live alongside
the existing pipeline endpoints — no existing route is modified.

- **`POST /api/cc/run`** — UI hits this in Claude Code mode. Sets
  the single-slot pending work item. Returns 409 if the slot is
  already occupied (run in progress).
- **`GET /api/cc/wait`** — long-poll endpoint that the CLI's
  `newsletter wait` blocks on. Returns the pending work item when
  one becomes available; clears the slot.
- **`POST /api/cc/event`** — the CC session pushes status events;
  the server fans them out via SSE on the same channel API mode
  uses.
- **`POST /api/cc/answer`** — UI POSTs elicitor answers; unblocks
  the `newsletter await-answers` long-poll.
- **`GET /api/cc/status`** — returns the current CC presence
  state for the UI badge.
- **`GET /api/cc/connection`** — returns liveness + the registered
  session id; used by the CLI's per-call check.

### Single-CC-session assumption

One CC session is doing newsletter work at a time. `newsletter
connect` registers it (last-wins on a second connect from a
different session). All other subcommands read the registration
implicitly so per-cycle invocations stay terse. `disconnect` is
optional; the server treats `wait` exit and long absence as
implicit disconnect.

### Lotto tube

The CC bridge uses a single-slot pending request, not a queue:

- One slot for incoming work. POST sets it; the blocked `wait`
  endpoint returns it and clears it.
- A second POST while the slot is full returns 409 with a "run in
  progress" toast. (Cancellation is out of scope for v1; a Cancel
  button would deliver a third lotto channel.)
- The Elicitor Q&A bridge has the same shape — a separate
  single-slot pair, run-scoped and short-lived.

The lotto tube payload uses a `kind` discriminator: `run` (with
mode `fresh` / `phase2` / `redo`) or `podcast`. One tube, one
discriminator — symmetric with the existing two-SSE-endpoint design
but unified.

### Presence states

| State            | What's true                                  | Server knows because                            |
|------------------|----------------------------------------------|-------------------------------------------------|
| **listening**    | CC blocked on `wait`, ready                  | active long-poll connection                     |
| **running**      | CC took a work item and is processing        | slot consumed; run-started not yet run-finished |
| **reconnecting** | Brief gap between events                     | last activity < 30s, no wait connection         |
| **not_connected**| Cold or gone for good                        | no wait, no activity for > 30s                  |

The skill brackets each work item with `event run-started <run-id>`
and `event run-finished <run-id>` so the server can track
`running` precisely. While running, events posted by the CC
session double as heartbeats. No event for ~60s → server demotes
`running → not_connected`.

### Mid-run resilience

The server emits SSE `keepalive` every 5s on `/api/stream`. If
`cc-status` flips to `not_connected` while a run is in progress,
the server emits an `error` event on the stream:

> "Claude Code disconnected mid-run. The cache is in a partial
> state; click ↺ Clear & Redo to start fresh."

### CC-mode cache artifacts

CC mode writes a few extra files alongside the existing artifacts:

- **`cache/state.json`** — the CLI's state machine (current phase,
  run id, run config). Read and written by `newsletter next`.
- **`cache/run.json`** — the run's tab list and config, populated
  by the server when receiving `POST /api/cc/run`. Read by phase
  prompts.
- **`cache/cost-offsets.json`** — maps each tracked CC session id
  (top-level and subagent) to the byte offset already consumed by
  `cost-tail`.

When `POST /api/cc/run` is invoked with `?nonce=`, the server
resolves the source window via the existing bookmarklet CDP path
and seeds `cache/run.json` with the window-scoped tab list — CC
mode preserves bookmarklet scoping unchanged.

### Outgoing event buffering

The existing pre-stream buffering pattern (used for elicitor events
that fire before the SSE opens) extends unchanged to CC-mode
events: when the server is up but no SSE consumer is connected,
events posted to `/api/cc/event` are buffered server-side and
replayed when a consumer connects. No new mechanism.
