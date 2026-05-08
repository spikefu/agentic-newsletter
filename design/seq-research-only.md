# Sequence: Research-only (phase=2)
**Requirements:** R9, R47, R131

The user clicks "⚡ Research Only" to re-run only the writing
phase against the cached clusters.

```
WebUi              Server                ResearchAgent     HtmlRenderer
  |                  |                         |                |
  |-- GET /stream?phase=2 -->                  |                |
  |                  |-- delete newsletter.{json,html,pdf}, podcast-script.txt, cost.json
  |                  |   (clusters.json preserved)              |
  |                  |-- read clusters.json    |                |
  |<-- phase 1 banner with "loaded from cache" message          |
  |<-- clusters event-|                        |                |
  |                  |-- runResearchAgent ---->|                |
  |                  |                         |  (loop as in seq-fresh-run)
  |<-- newsletter, output_ready, pipeline_cost, done             |
```

Discovery is skipped entirely. Cluster cache must exist; if not,
the pipeline runs Discovery normally.
