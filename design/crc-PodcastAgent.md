# PodcastAgent
**Requirements:** R63, R64, R65, R66, R67, R68, R69, R70, R71

On-demand spoken-word script generator. Reads the cached
newsletter, strips HTML, and produces a 3–6 minute first-person-
plural script.

## Knows
- Podcast SYSTEM prompt (style rules: no markdown/links/bullets,
  small numbers spelled out, transitions, intro and sign-off,
  acronym expansion, no "quote")
- Main-model identity from LlmProvider
- HTML-stripping helper

## Does
- `generatePodcastScript(newsletter, send, settings)` — strips HTML
  from title/intro/sections/closing, calls the main model once
  (no tools, no loop), and returns `{ script, cost }`
- Emits `phase`, `status`, `step_cost`, `thinking` events on the
  podcast SSE stream

## Collaborators
- LlmProvider: `chat()`, `calcCost()`, MODEL
- Server: receives the script, caches it, sends `done` event

## Sequences
- seq-podcast.md
