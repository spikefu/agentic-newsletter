# Web UI

**Language / environment:** Single-page web app served by the
project's Express server. Vanilla HTML, CSS, and JavaScript — no
framework. Targets modern browsers (Chrome, Firefox, Safari).

The UI is the only entry point for the pipeline. The server itself
does not have a CLI runner.

## Page anatomy (top to bottom)

1. **Header** — project name, run-mode toggle (Claude API / Ollama
   / Claude Code), CC presence indicator (only meaningful in CC
   mode), provider/model badge (Advanced), live cost ticker
   (Advanced), Advanced toggle.
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

## Run mode toggle

A three-state toggle in the header — *Claude API · Ollama · Claude
Code* — selects which LLM driver runs the pipeline. The setting
persists in `localStorage` (key: `newsletterRunMode`).

- **Claude API** and **Ollama** post to the existing `/api/stream`
  endpoint and behave exactly as today.
- **Claude Code** posts to `/api/cc/run` and listens on the same
  SSE channel for events fanned out by the server.

## CC presence indicator

In Claude Code mode, a small indicator next to the toggle reflects
the current presence of the connected Claude Code session:

- **Green** — listening (a CC session is blocked on `wait`, ready
  to take work).
- **Spin** — running (CC took a work item and is processing).
- **Gray** — not connected (no CC session, or it's been silent for
  > 30s).

The UI polls `/api/cc/status` every 2–3 seconds in CC mode to
keep the indicator current.

## Click handling per CC presence state

When the user clicks Generate in Claude Code mode, the UI's
behavior depends on the current presence state:

- **listening** → enqueue the run; happy path.
- **running** → toast: "run in progress." (Cancellation is out of
  scope for v1.)
- **reconnecting** → enqueue and hold. The next `wait` within 30s
  receives it. After 30s, the state demotes to `not_connected`
  and the UI shows a 503 toast.
- **not_connected** → reject with an onboarding modal explaining
  how to start a CC session and which command to run (`/newsletter`
  slash command from inside CC, or `newsletter wait` if the user
  has set up the skill manually). The click does NOT enqueue —
  nothing would pick it up.

The onboarding modal is the user's first surface for "Claude Code
mode requires Claude Code running locally." It links the two
entry points and explains why neither is automatic from the UI's
side.
