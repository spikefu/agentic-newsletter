# Design

## Intent

Reverse-engineered design for the existing agentic-newsletter
project. The system turns the user's currently-open Chrome tabs
into a finished newsletter through four LLM-driven stages —
Elicit (optional), Discover, Research, Podcast (on demand).

The Server is the orchestrator: it owns the SSE pipeline, the
cache directory, the per-agent settings, and the prompt files.
Each agent is a stateless module that drives a tool-call loop
through the LlmProvider facade. The browser UI is the only entry
point; it dispatches typed SSE events to live panels.

## Cross-cutting Concerns

### SSE event protocol
All server→browser communication during a run uses Server-Sent
Events. Events are typed JSON objects: `{ type, data }`. The set
of types is enumerated in R17 and R18. Every agent emits the same
event vocabulary, dispatched by the same panel handlers in WebUi.

### Cache as the source of truth
Pipeline artifacts live in the project's `cache/` directory:
`clusters.json`, `newsletter.json`, `newsletter.html`,
`newsletter.pdf`, `podcast-script.txt`, `cost.json`,
`elicitor-context.txt`, `settings.json`. The Server clears or
preserves subsets depending on run mode (R8, R9, R10).
`/api/status` reads this directory; the UI uses it on page load
(R130).

### Provider abstraction
Agents call `chat()` from `lib/llm.js`; they never see Anthropic
or Ollama SDK shapes. Tool definitions are in Claude shape and
converted internally. Tool-call results are normalized to
`[{ id, name, input }, ...]`. Per-agent settings (model name,
context window, max tokens, thinking) flow through the same
`chat()` call. Cost is computed inside the provider and reported
back via `step_cost` events.

### Prompts and style overrides
Two prompt files live at the project root: `discovery-prompt.md`
(user context) and `research-prompt.md` (newsletter style). The
elicitor's synthesized output overrides `discovery-prompt.md`
when present (R27). The UI reads/writes these files via
`/api/prompts`.

### Chrome instance lifecycle
The Server auto-launches Chrome with the debug port enabled if
no existing debug Chrome is found, using a project-local user
data directory so it doesn't collide with the user's everyday
profile (R84, R85). All BrowserTools operations target this
single instance — tab listing, page fetch, web search, PDF print.

### Visited-URL deduplication
Both DiscoveryAgent and ResearchAgent maintain a `visitedUrls`
set per run to suppress duplicate `fetch_page` calls. Repeats
return a "use the content you already have" string instead of
re-navigating.

### Bookmarklet rendezvous (window-scoped runs)
When the user clicks the installed bookmarklet, the new tab loads
the main UI with a `?nl-nonce=<n>` query parameter. The UI calls
`/api/tabs?nonce=<n>` instead of the unscoped form. The Server
finds the new tab in CDP `/json/list` by URL substring match,
calls `Browser.getWindowForTarget` to learn its `windowId`, and
returns the tab list filtered to that window. The rest of the
pipeline (Generate, SSE stream, elicitor) is unchanged. If the
nonce target is missing or CDP is unreachable, the handler falls
back to the unscoped any-window list.

### Loop control: step limit + nudge-once
DiscoveryAgent (R43, R44) and ResearchAgent (R61, R62) both run a
chat→tool-call→tool-result loop with a step limit and a single
"nudge" message when the model goes quiet without submitting its
terminal tool call. The pattern is identical between the two; the
limits and tool names differ.

### Buffered elicitor events
Because the elicitor runs against a different HTTP endpoint than
the SSE stream, any `step_cost` events it emits are buffered
server-side and replayed as the first events when the SSE stream
opens (R19).

### Inside-out (Claude Code) mode
A third run mode runs the LLM loop inside a Claude Code session
local to the user. The existing Claude API and Ollama paths stay;
CC mode is additive. All modes share `cache/`, prompt files, CDP
tool wrappers, the UI, and the SSE event vocabulary; they differ
only in who drives the loop.

In CC mode the `bin/newsletter` CLI brokers between the running
CC session and the server: `wait` long-polls for work, `next`
emits the next phase's prompt (crank handle), `event` POSTs
status, `fetch` / `search` / `render` proxy through to the
server's CDP wrappers. The server gains six `/api/cc/*` endpoints
that handle a single-slot work item, a single-slot elicitor-
answer slot, presence tracking, fan-out of events to the same
SSE channel API mode uses, and a per-call liveness/registration
check that maps failures to exit codes 64 / 65 / 66.

Cost telemetry is recovered by reading CC's own session and
subagent JSONL files. Byte offsets persist in
`cache/cost-offsets.json`; the top-level JSONL is filtered by
tool-call signature (only turns whose `tool_use` blocks call
`Bash(newsletter ...)` or `Agent(newsletter-*)` count as
newsletter work). Per-agent labeling via subagent session
correlation through a registry the skill writes.

Two entry points: A. UI mode toggle (requires a CC session
running with the skill loaded). B. `/newsletter` slash command
from inside CC (web UI optional).

## Artifacts

### CRC Cards
- [x] crc-Server.md → `server.js`
- [x] crc-ElicitorAgent.md → `agents/elicitorAgent.js`
- [x] crc-DiscoveryAgent.md → `agents/discoveryAgent.js`
- [x] crc-ResearchAgent.md → `agents/researchAgent.js`
- [x] crc-PodcastAgent.md → `agents/podcastAgent.js`
- [x] crc-Pricing.md → `agents/pricing.js`
- [x] crc-LlmProvider.md → `lib/llm.js`
- [x] crc-BrowserTools.md → `tools/browser.js`
- [x] crc-HtmlRenderer.md → `htmlRenderer.js`
- [x] crc-WebUi.md → `public/index.html`
- [ ] crc-NewsletterCli.md → `bin/newsletter`
- [ ] crc-CrankHandle.md → `lib/crank.js`, `lib/state.js`, `lib/schemas/`, `lib/parseClusters.js`, `lib/parseNewsletter.js`
- [ ] crc-CostTracker.md → `bin/newsletter`, `lib/cost.js`
- [ ] crc-NewsletterSkill.md → `.claude/skills/newsletter-pipeline/SKILL.md`, `.claude/skills/newsletter-pipeline/phases/`, `.claude/skills/newsletter-pipeline/schemas/`
- [ ] crc-NewsletterSubagents.md → `.claude/agents/newsletter-elicitor.md`, `.claude/agents/newsletter-discovery.md`, `.claude/agents/newsletter-research.md`, `.claude/agents/newsletter-podcast.md`

### Sequences
- [x] seq-fresh-run.md → `server.js`, `agents/discoveryAgent.js`, `agents/researchAgent.js`, `tools/browser.js`, `htmlRenderer.js`
- [x] seq-elicitor.md → `server.js`, `agents/elicitorAgent.js`, `lib/llm.js`
- [x] seq-research-only.md → `server.js`, `agents/researchAgent.js`
- [x] seq-clear-redo.md → `server.js`
- [x] seq-podcast.md → `server.js`, `agents/podcastAgent.js`, `lib/llm.js`
- [x] seq-cache-load.md → `server.js`, `public/index.html`
- [x] seq-bookmarklet-run.md → `server.js`, `public/index.html`, `tools/browser.js`
- [ ] seq-cc-bootstrap.md → `server.js`, `bin/newsletter`, `.claude/skills/newsletter-pipeline/SKILL.md`
- [ ] seq-cc-run.md → `server.js`, `bin/newsletter`, `lib/crank.js`, `.claude/skills/newsletter-pipeline/SKILL.md`, `.claude/agents/newsletter-discovery.md`, `.claude/agents/newsletter-research.md`
- [ ] seq-cc-elicitor.md → `server.js`, `bin/newsletter`, `.claude/agents/newsletter-elicitor.md`

### UI Layouts
- [x] ui-main.md → `public/index.html`
- [x] ui-elicitor.md → `public/index.html`

### Manifest
- [x] manifest-ui.md → `public/index.html`, `server.js`

## Gaps

(Tracked during Gaps Phase.)

- A1: getChromeTabs is described in crc-BrowserTools.md but implemented in server.js — pre-existing from reverse-engineering. Acceptable: server.js uses raw HTTP /json (not chrome-remote-interface) for tab listing, so the function does not require BrowserTools' CDP machinery. Future refactor could move it; not required.