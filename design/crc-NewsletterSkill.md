# NewsletterSkill
**Requirements:** R151, R197, R198, R199, R200, R204, R205, R206, R207, R208, R209

The Claude Code skill that bootstraps a CC session into the
newsletter loop. A skill directory at
`.claude/skills/newsletter-pipeline/` (the `-pipeline` suffix
keeps the skill's name distinct from the user-facing
`/newsletter` slash command). Loaded once per CC session — the
skill has `disable-model-invocation: true`, so the only entry
points are the slash command and the web UI's "Run with Claude
Code" toggle, both of which load `SKILL.md` explicitly. Once
loaded, it stays in the conversation via auto-compaction.

## Knows
- Its own bundled directory layout: `phases/`, `schemas/`,
  `README.md`
- The `${CLAUDE_SKILL_DIR}` substitution for resolving sibling
  paths regardless of installation location
- The `${CLAUDE_SESSION_ID}` substitution for `connect`

## Does
- **SKILL.md** — frontmatter declares `name`, `description`,
  `disable-model-invocation: true`, `allowed-tools: Bash(newsletter *)`.
  Body bootstraps: first run `newsletter connect --session
  ${CLAUDE_SESSION_ID}`, then loop on `newsletter wait` and
  dispatch each event. ≤500 lines; phase prompts loaded on
  demand
- **`/newsletter` slash command** — entry point for interactive
  use from inside CC. Boots a one-shot run (read tabs, optional
  context, crank through)
- **phases/elicit.md** — the elicit phase prompt: read tabs +
  prior context, optionally ask 2–3 clarifying questions via
  `ask-elicitor` + `await-answers`, synthesize a 3–5 sentence
  context block to `cache/elicitor-context.txt`
- **phases/discover.md** — for every URL in the tab list run
  `newsletter fetch <url>`; group fetched content into 3–8
  thematic clusters; write `cache/clusters.md` (markdown stencil
  parsed by the CLI into `cache/clusters.json` for downstream
  consumers)
- **phases/research.md** — read clusters; deepen 3–8 of the
  most interesting `notable_links` via `fetch`; use `search` for
  supplemental context; write `cache/newsletter.json` matching
  the schema
- **phases/podcast.md** — convert the newsletter to a 3–6
  minute spoken-word script; write `cache/podcast-script.txt`
- **schemas/clusters.json** and **schemas/newsletter.json** —
  the stencil schemas; loaded on demand by the model so it knows
  what shape to fill

## Collaborators
- NewsletterCli: every dispatch is a Bash call to `newsletter`
- NewsletterSubagents: dispatched via the Agent tool with
  per-phase prompt templates
- (the user, indirectly — via `/newsletter` or via the web UI's
  Generate click that the skill's `wait` loop picks up)

## Sequences
- seq-cc-bootstrap.md
- seq-cc-run.md
