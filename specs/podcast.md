# Podcast agent

**Language / environment:** Node.js 18+, ESM. Runs server-side
on its own dedicated SSE stream, started from the UI.

The Podcast agent converts a finished newsletter into a 3–6 minute
spoken-word script (~550–900 words). It runs only on user demand,
after the newsletter is already written.

## Behavior

### Trigger
The user clicks "🎙 Podcast" in the newsletter output toolbar. The
UI opens a separate SSE stream; the server reads the cached
newsletter and runs the podcast agent.

### What it does
- Strip HTML from the newsletter title, intro, section headlines,
  section bodies, and closing.
- Submit the resulting plain-text content to the configured main
  model with the podcast system prompt.
- Stream `step_cost` and (optionally) `thinking` events as it
  runs.
- Write the final script as plain text to the cache.

### Output
A single plain-text file containing the script. The UI receives a
`done` event with the script and exposes a download link.

## Style rules

Baked into the system prompt:

- First-person plural ("Today we're looking at...", "Let's dig in").
- No markdown, no links, no bullet symbols.
- Spell out small numbers when pronouncing them helps; keep years
  as numerals.
- Add natural transitions between sections.
- Open with a warm 2–3 sentence intro welcoming the listener.
- End with a brief sign-off ("That's it for today").
- Do not say "quote" — rephrase quoted material into the narrative.
- Expand acronyms on first use.

## Cost

The podcast script counts as its own pipeline stage with its own
`step_cost` events labeled "Podcast · script". It is not added to
the main pipeline's grand total cost (which is finalized when
Research completes).
