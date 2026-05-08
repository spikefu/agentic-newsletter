<!-- CRC: crc-NewsletterSkill.md | Seq: seq-cc-run.md | R199, R207 -->

# Research phase

The CLI emits the canonical research-phase prompt via
`./bin/newsletter next`. This file is supporting documentation.

## What research does

1. The prompt from `./bin/newsletter next` already contains the
   discovery clusters embedded as markdown and the exact output
   shape; treat that as the source of truth.
2. For 3–8 of the most interesting `notable_links` across
   clusters, run `./bin/newsletter fetch <url>` to add depth.
3. Use `./bin/newsletter search <query>` for supplemental
   context (single-quote the query — the shell otherwise expands
   `$`, backticks, etc.).
4. Write the newsletter to **`cache/newsletter.md`** in the
   markdown shape from the prompt. The CLI parses this into the
   on-disk JSON the renderer reads — the agent writes prose-
   shaped markdown with `[text](url)` links, not JSON, not raw
   HTML.
5. Run `./bin/newsletter next` to advance to render.

## Output shape

`cache/newsletter.md` is structured as: `# Title`,
`**Subtitle:**`, intro paragraphs, then 3–8 `## Section
headline` blocks each carrying `**Cluster:**` (slug from
clusters.md) + body paragraphs + `**Key links:**` bullets,
followed by reserved `## Closing` and `## References` sections.
The CLI converts inline markdown links and emphasis to HTML and
writes `cache/newsletter.json` for the renderer.
