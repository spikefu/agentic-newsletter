# Sequence: CC mode — elicitor Q&A bridging
**Requirements:** R168, R171, R172, R187

The elicit phase emits clarifying questions to the UI, then blocks
on a second blocking exchange (separate from the main `wait`)
until the user submits answers via the UI.

```
WebUi              Server                  Skill            NewsletterCli         Elicitor subagent
  |                  |                       |                    |                      |
  |  (run is in progress; elicit phase dispatched per seq-cc-run.md)                     |
  |                  |                       |- Agent(newsletter-elicitor, prompt) ---->|
  |                  |                       |                                          |  decides to ask
  |                  |                       |                                          |  writes cache/elicitor-questions.json
  |                  |                       |                                          |- Bash ------> ask-elicitor cache/elicitor-questions.json
  |                  |<-- POST /api/cc/event (questions) ----------------------------------------|
  |<- SSE event "questions" ----                                  |                      |
  |   render in elicitor card  |                                  |                      |
  |                  |                                            |                      |
  |                  |                                            |- Bash ------> await-answers <run-id>
  |                  |                                            |  POST /api/cc/answer is a separate slot;
  |                  |                                            |  this call blocks via long-poll until that POST arrives
  |  (user types answers, clicks Continue)                        |                      |
  |- POST /api/cc/answer -->|                                     |                      |
  |  { run-id, answers }    |                                     |                      |
  |                          |- unblock the awaiting CLI -------->|                      |
  |<-- 202 accepted ---------|                                    |- writes cache/elicitor-qa.json
  |                                                               |<-- exits 0 with the answers payload
  |                                                               |                      |
  |                                                               |          synthesize 3–5 sentence context
  |                                                               |          write cache/elicitor-context.txt
  |                                                               |<-- subagent done ----|
```

Notes:
- The elicitor's blocking exchange is run-scoped and short-lived:
  a separate single-slot pair from the main `wait` slot. This
  matches the spec's "second blocking exchange" intent.
- Skip path: the user closes the elicitor dialog (UI POSTs
  empty answers body). `await-answers` exits with empty
  `cache/elicitor-qa.json`; the elicit phase synthesizes a
  default context and proceeds.
- Heartbeat timeout (R167) still applies: the subagent's CLI
  invocations are heartbeats. If CC dies during `await-answers`,
  the server demotes presence to `not_connected` and the UI
  shows a "session lost" notice with a Cancel button.
