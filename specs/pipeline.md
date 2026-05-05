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
