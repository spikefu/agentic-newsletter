# DiscoveryAgent
**Requirements:** R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46

Phase 1 of the pipeline. Fetches every open Chrome tab, extracts
publication dates and key insights, and groups all sources into
3–8 thematic clusters.

## Knows
- SYSTEM prompt describing the curator role and date-handling rules
- `fetch_page` and `submit_clusters` tool schemas
- Step limit (30)
- Visited-URL set (per-run dedup)
- Nudge-once flag

## Does
- `runDiscoveryAgent(discoveryPrompt, send, settings)` — drives
  the chat → tool-call → tool-result loop until `submit_clusters`
  returns or the step limit is reached
- Routes `fetch_page` calls to BrowserTools.fetchPage and feeds
  results back as truncated `[WEBPAGE CONTENT]` blocks
- Validates `submit_clusters` payload: rejects empty arrays with a
  retry-friendly tool error
- Nudges the model once when it stops emitting tool calls without
  submitting
- Emits `phase`, `status`, `prompt`, `thinking`, `agent_text`,
  `tool_call`, `tool_result`, `step_cost`, `clusters` events

## Collaborators
- LlmProvider: `chat()`, `makeToolResultMessages()`, `calcCost()`,
  MODEL
- BrowserTools: `fetchPage(url)`
- Server: receives the cluster array and caches it

## Sequences
- seq-fresh-run.md
