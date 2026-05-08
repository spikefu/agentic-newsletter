# CrankHandle
**Requirements:** R153, R163, R164, R210, R211

The phase-choreography brain. Reads the pipeline state, decides
which phase is next, emits a self-contained prompt for that phase.
Validates the prior phase's artifact against its schema before
advancing.

## Knows
- `cache/state.json` — current phase, run id, run config
- `cache/run.json` — the run's tab list and config (populated by
  the server when it accepts `POST /api/cc/run`)
- `cache/clusters.md` — the discover phase's agent-authored
  artifact (markdown stencil; parsed by ClusterParser)
- `cache/newsletter.md` — the research phase's agent-authored
  artifact (markdown stencil; parsed by NewsletterParser, which
  also runs inline markdown → HTML for body content)
- The bundled JSON schemas in `lib/schemas/` for each phase's
  output artifact (CLI-internal — agents do not see these)
- The phase prompt strings, re-exported from `agents/*.js`'s
  `SYSTEM` consts via `lib/crank.js` (no duplication — same
  source of truth as the API-mode pipeline)
- The phase order: elicit → discover → research → render → done;
  podcast is on-demand and parallel

## Does
- `nextPhase()` — consults `cache/state.json` and returns the
  identifier of the next phase to run
- `validateArtifact(phase)` — loads the schema for the prior
  phase, validates the artifact at the expected cache path,
  returns ok or a structured error. For discover, runs
  ClusterParser first and writes the resulting JSON to
  `cache/clusters.json` for the renderer/research consumers.
  For research, runs NewsletterParser and writes
  `cache/newsletter.json`
- `emitPrompt(phase)` — prints to stdout the self-contained prompt
  telling the model what to do for `phase`. Agent-facing inputs
  (tab list for discover; clusters for research) are embedded as
  markdown — no "read this JSON file" instructions
- On parse or schema validation failure: appends a record to
  `cache/.cc/parse-errors.log` (silent diagnostic — the agent only
  sees the retry prompt) and exits non-zero so the model sees the
  errors and re-runs the phase

## Collaborators
- NewsletterCli: invokes `next` which delegates here
- ClusterParser (`lib/parseClusters.js`): converts the discover
  phase's markdown stencil into the clusters object
- NewsletterParser (`lib/parseNewsletter.js`): converts the
  research phase's markdown stencil into the newsletter object,
  including inline markdown → HTML for body / closing / refs
- (indirectly) `agents/*.js`: source of truth for `SYSTEM`
  prompt strings, re-exported via `lib/crank.js`

## Sequences
- seq-cc-run.md
