# Web UI

**Language / environment:** Single-page web app served by the
project's Express server. Vanilla HTML, CSS, and JavaScript — no
framework. Targets modern browsers (Chrome, Firefox, Safari).

The UI is the only entry point for the pipeline. The server itself
does not have a CLI runner.

## Page anatomy (top to bottom)

1. **Header** — project name, provider/model badge (Advanced),
   live cost ticker (Advanced), Advanced toggle.
2. **Chrome Tabs** card — list of open tabs being processed, with a
   refresh control.
3. **Run** card — two free-text prompt panes ("What were you
   reading about?" and "Newsletter Style"), example chips for
   quick context, Run / Research-only / Clear&Redo / Purge buttons,
   and per-phase progress banners (Advanced).
4. **Settings** card (Advanced only) — per-agent model settings
   table (Elicitor, Discovery, Research, Podcast) with model name,
   `num_ctx`, max tokens, thinking toggle. Saved live.
5. **Progress checklist** card — three steps (Discovery,
   Research, Done) with simple/advanced sub-text.
6. **Activity feed** card — streaming log of agent activity.
   Simple mode shows status messages and tool calls. Advanced mode
   adds thinking text and full prompts.
7. **Clusters** card (Advanced only) — visual rendering of the
   thematic clusters.
8. **Newsletter output** — the rendered newsletter, with download
   buttons (HTML, PDF), Save-to-dist, and Podcast trigger.
9. **Podcast** card — script preview with browser-speech playback
   controls when a script is generated.

## Modes

The "⚙ Advanced" toggle in the header switches the UI between
**Simple** and **Advanced** mode. Setting persists in localStorage.

- **Simple** (default) — only the toolbars, the activity feed, the
  progress checklist, and the newsletter output. No cost meter, no
  per-agent settings, no clusters preview, no thinking text.
- **Advanced** — exposes per-agent model settings, cluster
  preview, live cost ticker, model badge, thinking output,
  per-step prompts, phase banners, and "⚡ Research Only".

## Run flow from the user's view

1. User opens tabs in Chrome (their actual browsing).
2. User opens the page; Chrome Tabs card fills in.
3. User types context into "What were you reading about?".
4. User clicks "✨ Generate Newsletter".
5. The Elicitor may pop a small dialog with 2–3 questions; the
   user can answer each or skip.
6. Activity feed and progress checklist update live as Discovery
   and Research run.
7. Newsletter renders inline. Download / Save / Podcast buttons
   appear.

## Caching, redo, purge

- **Cached newsletter** — when the page loads with a newsletter
  already in cache, the UI shows it immediately and exposes the
  download/save/podcast controls without running anything.
- **⚡ Research Only** — re-runs the Research stage against cached
  clusters. Useful when iterating on the style prompt.
- **↺ Clear & Redo** — clears all cached output and starts a fresh
  full run.
- **🗑 Purge** — deletes everything in the cache directory and
  resets the UI to the empty state.

## Elicitor dialog UX

When the elicitor returns questions:
- A modal-style block appears in the Run card with each question
  and an answer textbox.
- "Skip" and "Continue" buttons; "Continue" sends the answers to
  the synthesize endpoint and then opens the SSE stream.
- "Skip" opens the SSE stream directly with the original context.

## Live SSE consumption

The UI opens an SSE stream when the user clicks Run, Research-only,
or Clear&Redo. It dispatches each event type to the right panel:
status text → activity feed; clusters → clusters card; newsletter
→ newsletter output; cost → live cost ticker; etc.

The Podcast button opens a separate SSE stream against the podcast
generate endpoint.
