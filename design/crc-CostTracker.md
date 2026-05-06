# CostTracker
**Requirements:** R154, R174, R175, R176, R177, R178, R179, R180, R181, R182, R183, R212

Cost telemetry for CC mode. Reads CC's own session and subagent
JSONL files, prices new assistant lines, emits `step_cost` events
matching the existing API-mode shape. Stateless and event-paced —
the skill calls it after each `newsletter event` push.

## Knows
- JSONL location pattern: `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- `cache/cost-offsets.json` — the persisted byte-offset map
  `{ <session-id>: <byte-offset>, ... }`
- The subagent registry the skill writes mapping
  `<sub-session-id>` → agent name (Discovery / Research /
  Elicitor / Podcast)
- The `agents/pricing.js` rate table (imported directly — single
  source of truth shared with API-mode telemetry)

## Does
- `cost-tail` — reads offsets, scans each tracked JSONL from
  offset to current EOF, parses new assistant lines, prices via
  `pricing.js`, writes new offsets back, emits `step_cost` events
  via `POST /api/cc/event` (or stdout if server is unreachable)
- `cost-summary` — one-shot total for the current run
- Top-level JSONL filter: includes a turn only if its
  `.message.content` has a `tool_use` block where
  `name === "Bash"` AND `input.command` starts with `newsletter `,
  OR `name === "Agent"` AND the spawned agent name starts with
  `newsletter-`
- Subagent JSONLs: tracked unconditionally (100% newsletter work)
- Per-agent labeling: maps `<sub-session-id>` → agent name via the
  registry, so cost events read "Discovery · step N" /
  "Research · step N" exactly as today
- Graceful degradation: a model not in `pricing.js` prices at 0;
  CC routed to Ollama with missing/malformed usage fields reports
  "n/a" without crashing; thinking blocks skipped from cost output
  by default

## Collaborators
- Server: `POST /api/cc/event` for `step_cost` fan-out
- (indirectly) `agents/pricing.js`: imported for the rate table

## Sequences
- seq-cc-run.md
