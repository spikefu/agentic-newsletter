# Requirements

## Feature: pipeline
**Source:** specs/pipeline.md

- **R1:** The pipeline turns the user's currently-open Chrome tabs into a finished newsletter.
- **R2:** The pipeline runs four stages in this order: Elicit (optional), Discover, Research, Podcast (on demand).
- **R3:** A single user click in the web UI starts the pipeline; the server has no CLI runner.
- **R4:** The server streams progress to the browser over a Server-Sent Events (SSE) connection.
- **R5:** Stages 1–3 (Elicit, Discover, Research) run on a single SSE stream.
- **R6:** Stage 4 (Podcast) runs on its own SSE stream, started after the newsletter is ready.
- **R7:** Only one pipeline run is supported at a time per server instance.
- **R8:** The pipeline supports a "fresh run" mode that runs Discover then Research, clearing prior newsletter output but reusing cached clusters when present and not redoing.
- **R9:** The pipeline supports a "research-only" mode (`phase=2`) that skips Discover and reuses cached clusters.
- **R10:** The pipeline supports a "clear and redo" mode (`redo=true`) that clears all cached artifacts before running.
- **R11:** A separate "purge" action deletes every file in the cache directory unconditionally.
- **R12:** Each successful run writes these cache artifacts: clusters JSON, newsletter JSON, standalone HTML newsletter, PDF (best-effort), cost summary.
- **R13:** A podcast script is written only when the user explicitly requests one.
- **R14:** PDF render failure does not fail the run; the user still gets HTML and a status event explaining the skip.
- **R15:** Podcast generation failure only affects the podcast stream; the newsletter is unaffected.
- **R16:** A "Save" action copies the HTML, PDF, JSON, and podcast script (whichever exist) to a timestamped subdirectory of `dist/`.
- **R17:** The SSE stream emits typed events: `model_info`, `phase`, `status`, `prompt`, `thinking`, `agent_text`, `tool_call`, `tool_result`, `step_cost`, `tabs`, `clusters`, `newsletter`, `output_ready`, `pipeline_cost`, `done`, `error`.
- **R18:** Elicitor-only events are `elicit_questions`, `elicit_ready`, `elicit_synthesized`.
- **R19:** Elicitor events emitted before the SSE stream opens are buffered server-side and replayed as the first events when the stream connects.
- **R20:** Any stage may abort the run by emitting an `error` event and closing the SSE stream; the cache is left in whatever partial state existed at the failure point.

## Feature: elicitor
**Source:** specs/elicitor.md

- **R21:** The elicitor analyzes the user's open tabs plus any free-text context and decides whether to ask 2–3 clarifying questions.
- **R22:** When context is sufficient, the elicitor returns `ready: true`, an empty `questions` list, and a one-sentence `suggestion`.
- **R23:** When context is insufficient, the elicitor returns `ready: false`, 2–3 short questions, and a one-sentence `suggestion` explaining the gap.
- **R24:** Elicitor questions are one sentence each, reference specific tab titles or domains where possible, and focus on what the user was trying to accomplish, who will read the newsletter, and what to emphasize or group.
- **R25:** After the user answers, the elicitor synthesizes a 3–5 sentence context block written as second-person instructions to the Discovery and Research agents.
- **R26:** If the user answered no questions, the synthesized output is empty and the original free-text context is used unchanged.
- **R27:** The synthesized context is persisted to the cache and takes precedence over the raw discovery prompt file when the main pipeline runs.
- **R28:** The elicitor uses the configured "fast" model.
- **R29:** The elicitor reports `step_cost` events labeled "Elicitor · analysis" and "Elicitor · synthesis".
- **R30:** Elicitor model output is parsed loosely: leading/trailing prose and `<think>...</think>` blocks are stripped before JSON extraction.
- **R31:** If elicitor JSON parsing fails, the elicitor returns `ready: true` with an empty question list so the pipeline proceeds.

## Feature: discovery
**Source:** specs/discovery.md

- **R32:** Discovery takes the list of open Chrome tabs (titles + URLs) and a discovery context block as input.
- **R33:** The discovery context is the elicitor's synthesized context if present, otherwise the raw `discovery-prompt.md` file.
- **R34:** Discovery fetches every URL the user provided using the `fetch_page` tool.
- **R35:** Discovery does not re-fetch URLs already visited in the same run.
- **R36:** For each fetched page, Discovery extracts: title, main topic, publication date, 3–5 key insights, and notable downstream links.
- **R37:** Discovery groups all fetched content into 3–8 logical thematic clusters.
- **R38:** Discovery submits its clustering by calling the `submit_clusters` tool.
- **R39:** Each cluster has: `id` (slug), `title`, `theme_summary` (2–3 sentences), and `sources` (array).
- **R40:** Each source has: `url`, `page_title`, `published_date` (or null), `summary` (2–3 sentences), `key_points` (3–5), `notable_links`.
- **R41:** Discovery records the exact `[Published: <date>]` string from fetched content into `published_date`.
- **R42:** When no `[Published: ...]` line is present, Discovery infers the publish date from in-page cues (e.g. "1h ago", datelines).
- **R43:** Discovery runs in a tool-call loop with a step limit of 30.
- **R44:** When the agent stops emitting tool calls without submitting clusters, the server nudges it once with an explicit reminder to call `submit_clusters`.
- **R45:** A `submit_clusters` call with an empty or missing array returns a tool error so the agent can retry.
- **R46:** If the loop exits without clusters, the pipeline emits an `error` event and stops.

## Feature: research
**Source:** specs/research.md

- **R47:** Research takes the clusters from Discovery (or cache) and a research style block as input.
- **R48:** The research style block is the user's saved `research-prompt.md` if present, otherwise a built-in default style.
- **R49:** Research fetches notable downstream links across clusters using `fetch_page` to add depth, quotes, and specifics.
- **R50:** Research uses `web_search` when supplemental context is needed.
- **R51:** Research submits the finished newsletter via `write_newsletter`.
- **R52:** The newsletter has top-level fields: `title`, `subtitle`, `intro` (HTML), `sections` (array), `closing` (HTML), `references` (HTML).
- **R53:** The subtitle field is a hyperlink crediting the project (target hard-coded in the tool description).
- **R54:** Each section has: `cluster_id`, `headline`, `body` (HTML, 3–5 substantive paragraphs), `key_links` (2–5 entries with optional `published_date`).
- **R55:** A `generatedAt` ISO timestamp is added to the newsletter by the server.
- **R56:** Research cites sources inline as `<a href="URL" target="_blank">Title</a> (Month Year)`.
- **R57:** Sources without a known date must not lead a paragraph; they are placed at the end of a section, prefixed with `<em>Additional info:</em>`, and appended with "(date unavailable)".
- **R58:** Research must not use relative time references ("this week", "recently", "just announced", etc.).
- **R59:** Research HTML body uses `<p>`, `<strong>`, `<a>`, `<ul>` — no inline headers (the section headline is rendered separately).
- **R60:** Research applies visited-URL deduplication across `fetch_page` calls.
- **R61:** Research runs in a tool-call loop with a step limit of 25.
- **R62:** When the agent stops emitting tool calls without writing the newsletter, the server nudges it once with an explicit reminder to call `write_newsletter`.

## Feature: podcast
**Source:** specs/podcast.md

- **R63:** The Podcast agent converts a finished newsletter into a 3–6 minute spoken-word script (~550–900 words).
- **R64:** Podcast generation is triggered by the user clicking the Podcast button in the newsletter output toolbar.
- **R65:** The Podcast agent reads the cached newsletter and runs on its own SSE stream.
- **R66:** The Podcast agent strips HTML from title, intro, section headlines, section bodies, and closing before sending to the model.
- **R67:** The Podcast agent uses the configured main model.
- **R68:** Podcast script style: first-person plural; no markdown, links, or bullet symbols; small numbers spelled out; years as numerals; natural transitions; warm 2–3 sentence intro; brief sign-off; rephrase quoted material; expand acronyms on first use.
- **R69:** The Podcast agent writes the final script as plain text to the cache.
- **R70:** The Podcast agent emits `step_cost` events labeled "Podcast · script".
- **R71:** Podcast cost is not added to the main pipeline's grand total cost.

## Feature: browser-tools
**Source:** specs/browser-tools.md

- **R72:** Browser tools drive a Chrome instance over its DevTools Protocol debug port (default 9222).
- **R73:** `getChromeTabs()` returns the open tabs filtered to real pages on http/https that are not pointed at localhost.
- **R74:** Each tab record is `{ title, url }`.
- **R75:** When Chrome is unreachable, `getChromeTabs()` returns an empty list and a human-readable error string.
- **R76:** `fetchPage(url)` navigates the headless tab, waits for `load`, then extracts publication date and visible text.
- **R77:** Date extraction scans, in order: `meta[property=article:published_time]`, `meta[property=og:updated_time]`, `meta[name=date]`, `meta[name=publish-date]`, `meta[name=pubdate]`, `meta[name=DC.date.issued]`, `time[datetime]`, JSON-LD `datePublished`/`dateCreated`.
- **R78:** Before extracting visible text, `fetchPage` removes `script`, `style`, `nav`, `footer`, `header`, `aside` elements.
- **R79:** `fetchPage` returns trimmed text capped at 8000 characters.
- **R80:** When a date is found, `fetchPage` prefixes the returned text with `[Published: <human-formatted date>]` followed by a blank line.
- **R81:** When Chrome cannot be reached, `fetchPage` returns a string explaining how to start Chrome with `--remote-debugging-port=<port>`.
- **R82:** `webSearch(query, maxResults)` navigates to DuckDuckGo's HTML endpoint, scrapes results (title, URL, snippet), and returns up to `maxResults` (default 8).
- **R83:** `printToPDF(url, outputPath)` navigates to the URL, waits ~800ms, prints to PDF (Letter, 0.6" margins), and writes the bytes to disk.
- **R84:** If Chrome is not already listening on the debug port, the server launches a fresh Chrome process with the debug port enabled and a dedicated user data directory inside the project.
- **R85:** The server logs whether it found an existing debug Chrome or launched a new one.

## Feature: llm-providers
**Source:** specs/llm-providers.md

- **R86:** Agents call a single `chat()` interface; provider SDKs do not leak out.
- **R87:** The `LLM_PROVIDER` environment variable selects the provider (`claude` or `ollama`); default is `claude`.
- **R88:** All agents in a session use the same provider.
- **R89:** Two models per provider are configured: a "main" model for Discovery/Research/Podcast and a "fast" model for the Elicitor.
- **R90:** Default models: Claude main `claude-opus-4-7`, Claude fast `claude-haiku-4-5`, Ollama main `qwen3:14b`, Ollama fast `qwen3:4b` (falls back to Ollama main if unset).
- **R91:** `OLLAMA_HOST` env var configures the Ollama server URL (default `http://localhost:11434`).
- **R92:** The UI's Model Settings panel allows per-agent overrides of: model name, `num_ctx` (Ollama only), max output tokens, thinking on/off.
- **R93:** Per-agent overrides are persisted to the cache and survive server restarts.
- **R94:** `chat()` accepts: `system`, `messages`, `tools`, `maxTokens`, `model`, `thinking`, `numCtx`.
- **R95:** `chat()` returns: `thinking`, `text`, `toolCalls`, `assistantMessage`, `usage`, `stopReason`, `elapsed_ms`.
- **R96:** `toolCalls` is normalized to `[{ id, name, input }, ...]` regardless of provider.
- **R97:** `makeToolResultMessages(toolCalls, contents)` returns Claude-shape (one user message with `tool_result` blocks) or Ollama-shape (one `tool` message per result) per provider.
- **R98:** `calcCost(model, usage)` returns USD; always 0 for Ollama.
- **R99:** `extractJson(text)` returns the first JSON object in `text` (after stripping `<think>...</think>`), or `null` on failure.
- **R100:** Ollama tool definitions are converted from Claude shape to Ollama shape (`type: 'function', function: {...}`).
- **R101:** Ollama tool argument values are normalized — string-encoded args are JSON-parsed.
- **R102:** Ollama assistant messages pushed back to history do NOT include `thinking` text.
- **R103:** Ollama fetch timeout is 10 minutes to accommodate slow local inference.
- **R104:** Claude system prompts are sent with `cache_control: ephemeral` to enable prompt caching.
- **R105:** When Claude thinking is enabled, the request asks for `adaptive` thinking.
- **R106:** Claude cost is computed using a per-model rate table (input, output, cache-write, cache-read); unknown models cost 0.

## Feature: html-renderer
**Source:** specs/html-renderer.md

- **R107:** The HTML renderer is a pure function: takes a newsletter object, returns a complete standalone HTML document string.
- **R108:** The rendered document contains: site nav, header (eyebrow, title, subtitle, dateline), intro, per-section blocks, closing, references.
- **R109:** Each section block has: zero-padded section number, headline, body, optional Further Reading panel of `key_links`.
- **R110:** The HTML/date fields in the JSON are inserted verbatim; only title, link text, link URL, and link date are HTML-escaped.
- **R111:** The dateline shows `newsletter.generatedAt` or today's date if absent.
- **R112:** Embedded CSS uses the host blog's design system: Atkinson font, accent `#2337ff`, gray palette, 720px max-width, 18px base size.
- **R113:** A print stylesheet hides the site nav and zeroes wrapper padding.
- **R114:** Missing optional fields (subtitle, closing, references, sections, key_links, generatedAt) render as empty strings or omitted blocks.

## Feature: web-ui
**Source:** specs/web-ui.md

- **R115:** The UI is a single-page web app served by the project's Express server, using vanilla HTML/CSS/JS (no framework).
- **R116:** The UI is the only entry point for the pipeline.
- **R117:** Page anatomy (top to bottom): header, Chrome Tabs card, Run card, Settings card (Advanced only), Progress card, Activity card, Clusters card (Advanced only), Newsletter output, Podcast card.
- **R118:** The header shows project name, provider/model badge (Advanced), live cost ticker (Advanced), and Advanced toggle.
- **R119:** The Chrome Tabs card lists open tabs with a refresh control.
- **R120:** The Run card has two free-text prompt panes ("What were you reading about?" and "Newsletter Style") with example chips, plus Run/Research-only/Clear&Redo/Purge buttons and per-phase progress banners (Advanced).
- **R121:** The Settings card (Advanced only) shows a per-agent model settings table (Elicitor, Discovery, Research, Podcast) with model name, `num_ctx`, max tokens, thinking toggle; saved live.
- **R122:** The Progress card shows three steps (Discovery, Research, Done) with simple/advanced sub-text.
- **R123:** The Activity card shows a streaming log of agent activity; Simple shows status + tool calls, Advanced adds thinking text and full prompts.
- **R124:** The Clusters card (Advanced only) renders the thematic clusters visually.
- **R125:** The Newsletter output renders the newsletter inline with download buttons (HTML, PDF), Save-to-dist, and Podcast trigger.
- **R126:** The Podcast card shows the script preview with browser-speech playback when a script is generated.
- **R127:** The "⚙ Advanced" toggle in the header switches the UI between Simple (default) and Advanced; setting persists in localStorage.
- **R128:** Simple mode hides cost meter, per-agent settings, clusters preview, and thinking text.
- **R129:** Advanced mode exposes per-agent model settings, cluster preview, live cost ticker, model badge, thinking output, per-step prompts, phase banners, and "⚡ Research Only".
- **R130:** When the page loads with a newsletter already in cache, the UI shows it immediately and exposes download/save/podcast controls without running anything.
- **R131:** The "⚡ Research Only" button re-runs the Research stage against cached clusters.
- **R132:** The "↺ Clear & Redo" button clears all cached output and starts a fresh full run.
- **R133:** The "🗑 Purge" button deletes everything in the cache directory and resets the UI to the empty state.
- **R134:** When the elicitor returns questions, a modal-style block appears in the Run card with each question and an answer textbox, plus Skip and Continue buttons.
- **R135:** Continue sends the answers to the synthesize endpoint, then opens the SSE stream.
- **R136:** Skip opens the SSE stream directly with the original context.
- **R137:** The UI opens an SSE stream for Run/Research-only/Clear&Redo and dispatches each event type to the right panel.
- **R138:** The Podcast button opens a separate SSE stream against the podcast generate endpoint.
