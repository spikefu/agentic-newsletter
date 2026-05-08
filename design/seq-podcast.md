# Sequence: Podcast generation
**Requirements:** R6, R13, R15, R63, R64, R65, R66, R69, R70, R71, R138

Triggered by the user clicking "🎙 Podcast" after the newsletter
is ready. Runs on its own SSE stream against
`/api/podcast-script/generate`.

```
WebUi              Server               PodcastAgent      LlmProvider
  |                  |                       |                |
  |-- GET /podcast-script/generate -->       |                |
  |                  |-- read newsletter.json|                |
  |                  | (404 if missing → error event)         |
  |                  |-- generatePodcastScript -------------->|
  |                  |                       |-- strip HTML   |
  |                  |                       |-- chat(MAIN, no tools, no thinking)->|
  |                  |                       |<-- text --------|
  |<-- phase/status/step_cost/(thinking) ----|                |
  |                  |<-- {script, cost} ----|                |
  |                  |-- write podcast-script.txt             |
  |<-- done with script -|                                    |
```

A failure here emits `error` and ends the stream (R15) without
affecting the main newsletter cache.
