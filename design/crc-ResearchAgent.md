# ResearchAgent
**Requirements:** R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62

Phase 2 of the pipeline. Reviews the clusters, follows interesting
notable links and runs supplemental web searches, then writes the
finished newsletter as a JSON object.

## Knows
- SYSTEM prompt template that bakes in date-handling, no relative
  time, HTML formatting, and inline citation rules
- Style block — user-provided (`research-prompt.md`) or built-in
  default
- `fetch_page`, `web_search`, `write_newsletter` tool schemas
- Step limit (25)
- Visited-URL set
- Nudge-once flag

## Does
- `runResearchAgent(clusters, researchPrompt, send, settings)` —
  drives the chat → tool-call → tool-result loop until
  `write_newsletter` returns or the step limit is reached
- Routes `fetch_page` to BrowserTools.fetchPage and `web_search` to
  BrowserTools.webSearch
- Validates the `write_newsletter` payload before accepting
- Nudges the model once when it stops emitting tool calls without
  writing
- Emits `phase`, `status`, `prompt`, `thinking`, `agent_text`,
  `tool_call`, `tool_result`, `step_cost`, `newsletter` events

## Collaborators
- LlmProvider: `chat()`, `makeToolResultMessages()`, `calcCost()`,
  MODEL
- BrowserTools: `fetchPage(url)`, `webSearch(query, max)`
- Server: receives the newsletter, adds `generatedAt`, caches it,
  and renders to HTML/PDF

## Sequences
- seq-fresh-run.md
- seq-research-only.md
