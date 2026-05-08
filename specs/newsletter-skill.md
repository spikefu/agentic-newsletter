# Newsletter skill, subagents, and slash command

**Language / environment:** Claude Code skill packaged as a
directory under `.claude/skills/newsletter-pipeline/`, with
YAML-frontmatter Markdown for `SKILL.md`, per-phase prompts, and
JSON schemas. Subagents are `.claude/agents/<name>.md` files with
their own model assignment and tool whitelist. The `/newsletter`
slash command is the interactive entry point from inside a Claude
Code session.

When a Claude Code session is driving the pipeline, the skill is
what orients it. The skill's prompt body teaches the model how to
loop on `newsletter wait` and dispatch each event to a phase
prompt. Each phase runs as a subagent so it gets its own model
choice, tool whitelist, and cost attribution.

## Skill layout

`.claude/skills/newsletter-pipeline/` contains:

- **`SKILL.md`** — bootstrap entry point. Frontmatter declares
  `name`, `description` (used by Claude Code to route invocations),
  `disable-model-invocation: true` (so the skill only runs when
  asked, not when the model thinks it might be relevant), and
  `allowed-tools: Bash(newsletter *)`. The body is at most 500
  lines and instructs the session to run `newsletter connect
  --session ${CLAUDE_SESSION_ID}` first and then loop on `newsletter
  wait`, dispatching each returned event to the right phase.
- **`phases/elicit.md`, `phases/discover.md`, `phases/research.md`,
  `phases/podcast.md`** — per-phase prompts loaded on demand via
  `${CLAUDE_SKILL_DIR}/phases/...`. Each is a self-contained
  crank-handle prompt: it embeds the relevant inputs as
  pre-chewed markdown and tells the model exactly which artifacts
  to write.
- **`schemas/clusters.json`, `schemas/newsletter.json`** — JSON
  schemas the model fills in after the CLI parses its markdown
  output. Loaded on demand via `${CLAUDE_SKILL_DIR}/schemas/...`.
- **`README.md`** — implementation notes for humans, not loaded by
  Claude Code.

`SKILL.md` renders once when invoked and stays in the conversation
for the rest of the session via auto-compaction. The bootstrap is
one-shot; the model doesn't re-orient on every `wait` cycle.

## Subagents

Each phase becomes a Claude Code subagent so it gets its own model,
tool whitelist, and cost attribution:

- **`newsletter-elicitor`** — Haiku (default; advisory).
- **`newsletter-discovery`** — Opus (default; advisory).
- **`newsletter-research`** — Opus (default; advisory).
- **`newsletter-podcast`** — Haiku (default; advisory).

These defaults are advisory because Claude Code may route to
Ollama, in which case the assignments map to whatever local model
the session is configured with. The crank-handle prompt for each
phase becomes the prompt template the top-level session passes to
the subagent via the Agent tool. The subagent runs to completion,
returns the artifact path, and the top-level session cranks
forward.

## `/newsletter` slash command

The `/newsletter` slash command is the interactive entry point from
inside a Claude Code session. Typing it boots a one-shot run: read
the current Chrome tabs, ask for context inline, crank through the
phases. The web UI is optional — if it's running, it sees the
events too (same `newsletter event` calls) — but the slash-command
flow does not depend on the UI being open.

## Phase choreography

Each `newsletter next` invocation picks a phase from
`cache/state.json` and emits a self-contained prompt. The model
never needs to remember pipeline structure.

Agent-facing inputs are markdown — the prompt embeds the tab list,
the discovery clusters, etc., as pre-chewed markdown. Agent-authored
outputs are markdown where the shape is rich enough that
JSON-with-correctly-balanced-braces was costing recovery turns; the
CLI parses the markdown into the on-disk JSON the renderer wants.

- **elicit** — read the tab list (in the prompt); optionally ask
  2–3 clarifying questions via `ask-elicitor` + `await-answers`;
  synthesize a 3–5 sentence context block to
  `cache/elicitor-context.txt`.
- **discover** — for every URL in the tab list, run `newsletter
  fetch <url>`. Group fetched content into 3–8 thematic clusters.
  Write `cache/clusters.md` in the prescribed markdown shape; the
  CLI parses it into `cache/clusters.json`.
- **research** — read `cache/clusters.json`. For 3–8 of the most
  interesting `notable_links`, run `newsletter fetch`. Use
  `newsletter search` for supplemental context. Write
  `cache/newsletter.md` in the prescribed markdown shape; the CLI
  parses it into `cache/newsletter.json`.
- **render** — `newsletter render` (no model work).
- **podcast** (on demand) — convert `cache/newsletter.json` to a
  3–6 minute spoken-word script; write `cache/podcast-script.txt`.

The shared-prompt rule: both API/Ollama mode and CC mode use the
same system prompts. API/Ollama reads them from the existing
`SYSTEM` consts in `agents/*.js`; the CC mode imports the same
exported strings. If the prompts ever fork, the two paths drift
two newsletters apart — they stay one source.
