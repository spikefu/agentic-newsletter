# Sequence: Clear & redo
**Requirements:** R10, R132

The user clicks "↺ Clear & Redo" to wipe all cached output and
run the full pipeline fresh.

```
WebUi              Server
  |                  |
  |-- GET /stream?redo=true -->
  |                  |-- delete clusters.json, newsletter.json, newsletter.html,
  |                  |          newsletter.pdf, podcast-script.txt, cost.json,
  |                  |          elicitor-context.txt
  |                  |
  |  (proceeds as seq-fresh-run; nothing cached, so Discovery runs from scratch)
```

Differs from a fresh run only in the pre-run cleanup step. The
elicitor-context.txt is also deleted, so any prior synthesized
context is discarded.
