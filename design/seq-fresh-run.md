# Sequence: Fresh run (Discover → Research → Render)
**Requirements:** R1, R2, R4, R5, R8, R12, R14, R17, R20, R34, R37, R38, R44, R45, R46, R49, R50, R51, R55, R59, R61, R62, R107

After the elicitor (or skip), the UI opens an SSE stream against
`/api/stream`. The Server clears stale outputs, fetches tabs,
runs Discovery, then Research, then renders HTML/PDF.

```
WebUi              Server                DiscoveryAgent      ResearchAgent     BrowserTools    HtmlRenderer
  |                  |                         |                  |                 |               |
  |-- GET /stream -->|                         |                  |                 |               |
  |                  |-- send model_info ----->|                  |                 |               |
  |<-- model_info ---|                         |                  |                 |               |
  |                  |-- replay elicitor buf ->|                  |                 |               |
  |                  |-- getChromeTabs() -------------------------------------------->|               |
  |                  |<-- tabs --------------------------------------------------------|               |
  |<-- tabs event ---|                         |                  |                 |               |
  |                  |-- runDiscoveryAgent --->|                  |                 |               |
  |                  |                         |-- chat()/loop -->|                 |               |
  |                  |                         |-- fetchPage() x N ----------------->|               |
  |                  |                         |<-- text+date ----------------------|               |
  |                  |                         |                  |                 |               |
  |<-- phase/status/prompt/thinking/agent_text/tool_call/tool_result/step_cost (per step) -----------|
  |                  |                         |                  |                 |               |
  |                  |<-- {clusters,cost} -----|                  |                 |               |
  |<-- clusters -----|                         |                  |                 |               |
  |                  |-- write clusters.json ->|                  |                 |               |
  |                  |                                            |                 |               |
  |                  |-- runResearchAgent ----------------------->|                 |               |
  |                  |                                            |-- chat()/loop ->|               |
  |                  |                                            |-- fetchPage()/webSearch() ----->|
  |                  |                                            |<-- text/results ---------------|
  |                  |                                            |                 |               |
  |<-- phase/status/...../tool_call/tool_result/step_cost ---------------------------|               |
  |                  |                                            |                 |               |
  |                  |<-- {newsletter,cost} ----------------------|                 |               |
  |<-- newsletter ---|                                            |                 |               |
  |                  |-- write newsletter.json + add generatedAt -|                 |               |
  |                  |-- renderNewsletterHTML(newsletter) ------------------------------------------>|
  |                  |<-- html string -----------------------------------------------|---------------|
  |                  |-- write newsletter.html                                                       |
  |                  |-- printToPDF(/api/newsletter.html, newsletter.pdf) ---------->|               |
  |                  |<-- (best-effort; status event on failure)                     |               |
  |<-- output_ready -|                                                                               |
  |                  |-- write cost.json                                                             |
  |<-- pipeline_cost-|                                                                               |
  |<-- done ---------|                                                                               |
```

Notes:
- The replay-elicitor-buffer step delivers any `step_cost` events
  the elicitor produced before this stream opened (R19).
- The discovery and research loops nudge once and stop after the
  step limit (R44, R62).
- A failed `printToPDF` emits `status` instead of failing the run
  (R14).
