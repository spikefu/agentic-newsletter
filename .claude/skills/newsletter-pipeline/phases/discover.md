<!--
CRC: crc-NewsletterSkill.md | Seq: seq-cc-run.md | R199, R206
-->
# Discover phase

The CLI emits a self-contained discover-phase prompt via
`newsletter next` — that prompt is the source of truth for what
to do. This file is supporting documentation: read it if you
need the prompt's expanded background or want to understand why
the prompt is shaped the way it is.

## What discover does

1. The prompt from `newsletter next` already contains the tab
   list and the exact markdown shape the output must follow.
2. For every URL listed, run `newsletter fetch <url>` to pull
   the page's text + publication date via the project's CDP
   wrapper.
3. Group the fetched content into **3–8 thematic clusters**.
   Each cluster has a title and a theme summary; each source
   under it has a URL, page title, published date, summary,
   key points, and notable links.
4. Write the result to **`cache/clusters.md`** in the markdown
   shape from the prompt. The CLI parses this into the on-disk
   JSON the renderer reads — the agent writes prose-shaped
   markdown, not JSON. The cluster `id` slug is derived from
   the title by the CLI; the agent does not write one.
5. Run `newsletter next`. The CLI parses the markdown, validates
   the shape, and either advances or returns errors for retry.

## Why `newsletter fetch`, not WebFetch

`newsletter fetch` runs through the project's Chrome DevTools
Protocol wrapper, so it:

- Sees pages behind login (the user's real Chrome profile).
- Extracts publication dates from JSON-LD / `article:published_time`
  / `time[datetime]` and prefixes the result with
  `[Published: <date>]`.
- Strips clutter (`script`, `style`, `nav`, `footer`, `header`,
  `aside`) before extracting visible text.
- Returns up to 8000 chars by default.

WebFetch can't do any of those.

## Shape reference

The agent-facing shape is markdown — see the example block
inside the prompt emitted by `newsletter next` for the discover
phase. The on-disk JSON form
(`${CLAUDE_SKILL_DIR}/schemas/clusters.json`) is what the CLI
produces internally after parsing; the agent does not write or
read it.
