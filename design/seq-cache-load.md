# Sequence: Page load with cached newsletter
**Requirements:** R130

When the user opens the page after a prior successful run, the UI
shows the existing newsletter and download controls without
running anything.

```
WebUi              Server
  |                  |
  |-- GET / -------->|
  |<-- index.html ---|
  |-- GET /api/tabs ->|
  |<-- {tabs} -------|
  |-- GET /api/prompts ->|
  |<-- {discovery, research} ---|
  |-- GET /api/status ->|
  |<-- {hasClusters, hasNewsletter, hasPdf, hasPodcast,
  |     clusters, newsletter, cost} ---|
  |
  | branch: hasNewsletter=true
  |   |-- render newsletter inline (no SSE stream opened)
  |   |-- enable HTML/PDF/Save/Podcast buttons
  |   |-- if hasPodcast=true, also fetch podcast-script
  |
  | branch: hasNewsletter=false
  |   |-- hide newsletter card; user must click Run
```

Pure read path — no agent invocations, no SSE.
