# Server
**Requirements:** R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R27, R55, R64, R71, R84, R85, R93, R1, R2, R139, R146, R147, R148, R149, R150, R151, R152, R184, R185, R186, R187, R188, R189, R190, R191, R192, R195, R196, R213, R216

The HTTP entry point. Hosts the web UI, exposes JSON endpoints,
drives the SSE pipeline by calling the agent modules in order, and
manages the cache and dist directories. Auto-launches a debug
Chrome on startup if one isn't already running.

## Knows
- HTTP port (default 3002) and Chrome debug port (default 9222)
- Cache directory layout (`clusters.json`, `newsletter.json`,
  `newsletter.html`, `newsletter.pdf`, `podcast-script.txt`,
  `cost.json`, `elicitor-context.txt`, `settings.json`)
- Prompt file paths (`discovery-prompt.md`, `research-prompt.md`)
- Default per-agent settings (model, numCtx, maxTokens, thinking)
- The buffered elicitor event queue (replayed when SSE opens)
- The CC-mode in-memory connection registry (one slot: registered
  session id, optional `target-window`, last-activity timestamp)
- The single-slot pending CC work item (set by `POST /api/cc/run`,
  consumed by the `wait` long-poll)
- The single-slot CC elicitor-answer pair (UI POSTs to
  `/api/cc/answer`, unblocking the awaiting CLI long-poll)
- The current CC presence state derived from those slots:
  listening / running / reconnecting / not_connected

## Does
- Serves the single-page UI from `public/`
- Lists open Chrome tabs (`/api/tabs`) via the in-process
  `getChromeTabs` / `tabsForRequest` helpers. The optional
  `?nonce=<n>` form fetches `/json` once, finds the target whose
  URL contains the nonce, then asks BrowserTools'
  `getWindowsForTargets` to resolve every candidate's `windowId`
  in one CDP session, and returns the tabs whose `windowId`
  matches the source target's. Falls back to the unscoped list
  on any failure (target missing, CDP unreachable)
- Reads/writes prompts (`/api/prompts`) and per-agent settings
  (`/api/settings`)
- Lists installed Ollama models (`/api/ollama-models`)
- Reports cache status and serves cached artifacts
  (`/api/status`, `/api/newsletter.{html,pdf}`,
  `/api/podcast-script`)
- Runs the elicitor analyze + synthesize phases
  (`/api/elicit`, `/api/elicit/synthesize`)
- Drives the main pipeline as an SSE stream (`/api/stream`),
  honoring `?redo=true` and `?phase=2` modes
- Drives the podcast pipeline as a separate SSE stream
  (`/api/podcast-script/generate`)
- Purges all cache files (`/api/purge`)
- Copies finished artifacts into a timestamped `dist/` folder
  (`/api/save-dist`)
- Auto-launches Chrome with the debug port enabled when no
  existing debug Chrome is found
- (CC mode — additive, alongside the existing pipeline) Hosts six
  `/api/cc/*` endpoints — `run`, `wait`, `event`, `answer`,
  `status`, `connection`. Tracks one CC session at a time
  (last-wins), reports presence to the UI, fans CC events out via
  SSE, holds the two single-slot exchanges (work item + elicitor
  answers). Click handling per presence state: listening →
  enqueue; running → 409; reconnecting → enqueue & hold up to
  30s, then 503; not_connected → reject with onboarding modal.
  Lotto tube payload uses a `kind` discriminator (`run` with mode
  `fresh`/`phase2`/`redo`, or `podcast`). When `/api/cc/run` is
  invoked with `?nonce=`, resolves windowId via the bookmarklet
  CDP path (R146/R147) and seeds `cache/run.json` with the
  scoped tab list. SSE `keepalive` every 5s; on mid-run
  not_connected, emits an `error` event explaining the partial
  cache state

## Collaborators
- ElicitorAgent: pre-pipeline Q&A and synthesis
- DiscoveryAgent: phase 1 cluster creation
- ResearchAgent: phase 2 newsletter writing
- PodcastAgent: on-demand script generation
- BrowserTools: tab listing, page fetch, web search, PDF print
- HtmlRenderer: convert newsletter JSON to standalone HTML
- LlmProvider: provider/model identity for `model_info` events

## Sequences
- seq-fresh-run.md
- seq-research-only.md
- seq-clear-redo.md
- seq-elicitor.md
- seq-podcast.md
- seq-cache-load.md
- seq-bookmarklet-run.md
- seq-cc-bootstrap.md
- seq-cc-run.md
- seq-cc-elicitor.md
