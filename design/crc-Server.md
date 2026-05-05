# Server
**Requirements:** R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R27, R55, R64, R71, R84, R85, R93, R1, R2, R139, R146, R147, R148, R149, R150

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
