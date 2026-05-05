# UI: Elicitor question dialog
**Requirements:** R23, R24, R134, R135, R136

When the elicitor returns `ready: false`, the Run card expands to
show a question/answer block before opening the SSE stream.

```
┌─ Run · Elicitor wants to clarify ─────────────────────────────┐
│                                                               │
│   "I noticed you have several arXiv papers and a Hacker News  │
│    thread on diffusion models — what angle?"                  │
│                                                               │
│   1. Which audience is this for? (engineers / general)        │
│      [textarea]                                               │
│                                                               │
│   2. Should the regulatory side be emphasized?                │
│      [textarea]                                               │
│                                                               │
│   3. Anything to downplay?                                    │
│      [textarea]                                               │
│                                                               │
│   [Skip]                                          [Continue]  │
└───────────────────────────────────────────────────────────────┘
```

Behavior:
- **Skip** → opens `/api/stream` directly, original context used.
- **Continue** → POSTs `/api/elicit/synthesize` with the answers,
  then opens `/api/stream`. The synthesized context is persisted
  to `cache/elicitor-context.txt` and overrides
  `discovery-prompt.md` for this run.

References: WebUi (crc-WebUi.md), seq-elicitor.md.
