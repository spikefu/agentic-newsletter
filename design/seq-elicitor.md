# Sequence: Elicitor (analyze + synthesize)
**Requirements:** R19, R21, R22, R23, R25, R26, R27, R28, R29, R30, R31, R134, R135, R136

Runs before the SSE stream opens. The UI POSTs to `/api/elicit`,
then either to `/api/elicit/synthesize` (Continue) or skips and
opens the SSE stream with the original context.

```
WebUi              Server          ElicitorAgent     LlmProvider
  |                  |                  |                |
  |-- POST /elicit ->|                  |                |
  |                  |-- getChromeTabs->|                |
  |                  |<-- tabs ---------|                |
  |                  |-- elicitContext->|                |
  |                  |                  |-- chat(fast) ->|
  |                  |                  |<-- text -------|
  |                  |                  |-- extractJson--|
  |                  |<-- {ready,questions,suggestion}--|
  |<-- JSON response-|                  |                |
  |                  |                                   |
  |   (server buffers step_cost into _elicitorBuffer)    |
  |                                                      |
  | branch: ready=true OR user clicks Skip               |
  |   |-- GET /stream ----------------------->|          |
  |   |   (buffered events replayed; pipeline runs)      |
  |                                                      |
  | branch: ready=false AND user clicks Continue         |
  |   |-- POST /elicit/synthesize {answers}-->|          |
  |                                  |-- synthesizeContext->|
  |                                  |        |-- chat(fast) ->|
  |                                  |        |<-- text -------|
  |                                  |<-- synthesized text ----|
  |                                  |-- write elicitor-context.txt
  |   |<-- {synthesizedContext} -----|        |                |
  |   |-- GET /stream ----------------------->|                |
```

Notes:
- The synthesized context takes precedence over
  `discovery-prompt.md` when the main pipeline runs (R27).
- Empty answers → original context returned unchanged (R26).
- JSON parse failure → `ready: true` so the pipeline proceeds
  (R31).
