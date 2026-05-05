# WebUi
**Requirements:** R115, R116, R117, R118, R119, R120, R121, R122, R123, R124, R125, R126, R127, R128, R129, R130, R131, R132, R133, R134, R135, R136, R137, R138, R139, R140, R141, R142, R143, R144, R145, R149

Single-page browser UI. The only entry point for the pipeline.
Fetches tabs, sends the user's prompt to the elicitor, opens the
SSE stream, dispatches events to live panels, and triggers
on-demand actions like Save and Podcast.

## Knows
- All `/api/*` endpoint URLs
- The Simple/Advanced mode flag (persisted in localStorage)
- The current pipeline cost ticker
- The current set of cluster cards
- The newsletter HTML and download link state
- The page's own `location.origin` (used to bake the bookmarklet
  link at render time) and any `?nl-nonce=<n>` query parameter
  passed in by the bookmarklet

## Does
- Loads tabs (`/api/tabs`, or `/api/tabs?nonce=<n>` when the
  page URL carries `?nl-nonce=<n>`), prompts (`/api/prompts`),
  settings (`/api/settings`), Ollama models (`/api/ollama-models`),
  and prior status (`/api/status`) on page load
- Renders the Chrome Tabs, Run, Settings (Advanced), Progress,
  Activity, Clusters (Advanced), Newsletter, and Podcast cards
- On Run/Research-only/Clear&Redo: POSTs to `/api/elicit` first,
  shows the elicitor questions in-card, posts answers to
  `/api/elicit/synthesize`, then opens an `EventSource` against
  `/api/stream` (with optional `?redo=true` or `?phase=2`)
- Dispatches each SSE event type to the right panel (status →
  activity feed; clusters → clusters card; newsletter →
  newsletter output; step_cost → live cost ticker; etc.)
- Handles the Skip path by opening the SSE stream directly without
  synthesis
- On Podcast click: opens an `EventSource` against
  `/api/podcast-script/generate` and dispatches the same event
  types into the podcast card
- Triggers Save (`POST /api/save-dist`) and Purge
  (`POST /api/purge`)
- Saves prompt edits (`POST /api/prompts`) and per-agent settings
  (`POST /api/settings`) live as the user changes them
- Toggles between Simple and Advanced mode, hiding/showing the
  cost ticker, cluster card, settings card, thinking text, and
  prompt event log
- Renders a collapsible bookmarklet install panel inside the
  Chrome Tabs card; the draggable link is generated with the
  current `location.origin` baked in and contains only a
  `window.open('<origin>/?nl-nonce=<nonce>')` call (no eval, no
  remote-controlled JS, no secrets)

## Collaborators
- Server: every interaction goes through one of its endpoints
- (the user, indirectly — via clicks and textareas)

## Sequences
- seq-fresh-run.md
- seq-research-only.md
- seq-clear-redo.md
- seq-elicitor.md
- seq-podcast.md
- seq-cache-load.md
- seq-bookmarklet-run.md
