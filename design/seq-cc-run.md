# Sequence: CC mode — full run (Discover → Research → Render)
**Requirements:** R151, R161, R163, R164, R165, R166, R167, R168, R169, R174, R175, R177, R184, R185, R186, R203, R213

After bootstrap, the UI clicks Generate (Claude Code mode); the
skill's `wait` returns the work item and dispatches phases to
subagents. After each phase the skill calls `cost-tail` for
event-paced cost telemetry and `event` to push status to the UI.

```
WebUi        Server           Skill          NewsletterCli      Subagent       CostTracker
  |             |                |                  |                 |             |
  |- POST /api/cc/run ----->|                       |                 |             |
  |  (with optional ?nonce=) |  resolve windowId    |                 |             |
  |                          |  via existing CDP path (R213)          |             |
  |                          |  → seed cache/run.json                 |             |
  |<-- 202 accepted ---------|                                        |             |
  |             |- pop slot, fan to /api/cc/wait ->                   |             |
  |             |                |<- wait returns { kind: "run", ... }|             |
  |             |                |                                    |             |
  |             |                |- Bash --------> event run-started <id>            |
  |             |                |                  |- POST /event ->|             |
  |             |<- SSE fan-out -|                                    |             |
  |             |                |                                    |             |
  |             |                |- Bash --------> next               |             |
  |             |                |                  |  (CrankHandle reads state.json)
  |             |                |<-- prompt for ELICIT phase --------|             |
  |             |                |                                    |             |
  |             |                |- Agent(newsletter-elicitor, prompt)|------------>|
  |             |                |                                    |  runs elicit
  |             |                |<- artifact path -------------------|<------------|
  |             |                |                                    |             |
  |             |                |- Bash --------> event step-done elicit            |
  |             |                |- Bash --------> cost-tail   ----------------------|
  |             |                |                  |  read offsets, scan JSONLs,    |
  |             |                |                  |  filter top-level via tool-call signature (R177)
  |             |                |                  |  emit step_cost events  ------>|
  |             |                |                                                   |- POST /api/cc/event
  |             |<- SSE fan-out (step_cost) ------------------------------------------|
  |             |                |                                                   |
  |             |                |- Bash --------> next                              |
  |             |                |<-- prompt for DISCOVER -----------|                |
  |             |                |- Agent(newsletter-discovery, prompt) ------------->|
  |             |                |  fetch each tab via newsletter fetch              |
  |             |                |  write cache/clusters.json                        |
  |             |                |<- artifact path --------------------|<-------------|
  |             |                |- Bash --> cost-tail; event clusters …             |
  |             |                |                                                   |
  |             |                |  (RESEARCH phase: same shape, newsletter-research)|
  |             |                |                                                   |
  |             |                |- Bash --------> render                            |
  |             |                |  (no model — HTML + PDF; uses CDP printToPDF)     |
  |             |                |- Bash --------> event output_ready                |
  |             |                |- Bash --------> event run-finished <id>           |
  |             |<- SSE fan-out (newsletter, output_ready, done) -----                |
  |             |                |                                                   |
  |             |                |- Bash --------> wait  (back to seq-cc-bootstrap)
```

Notes:
- `cache/run.json` carries the tab list and config; populated by
  the server when accepting `/api/cc/run`. Window-scoped runs
  inherit R146/R147 — server resolves windowId and seeds the
  scoped tab list.
- Per-phase subagent dispatch passes the crank-handle prompt
  template as the subagent's input. Subagent runs to completion;
  artifact path returned (R203).
- `cost-tail` is event-paced (R175) — called after every status
  event push. Stateless: reads / writes
  `cache/cost-offsets.json` each invocation.
- All `event` POSTs fan out via SSE on the existing `/api/stream`
  channel; the existing `_elicitorBuffer` (R19) buffers them
  until the UI's `EventSource` connects (R180).
- Schema validation in `next` (R164): if the prior phase's
  artifact fails schema, `next` exits non-zero with the error;
  the skill re-dispatches the same phase with the validation
  message.
