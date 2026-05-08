# NewsletterSubagents
**Requirements:** R201, R202, R203

Four Claude Code subagent definitions, one per phase. Each agent
sets its own model and tool whitelist. The top-level skill session
dispatches phases to these subagents via the Agent tool, passing
the crank-handle output as the prompt template.

## Knows
- Their own model setting (advisory — CC may route to a different
  model via `ANTHROPIC_BASE_URL` or the Agent SDK custom
  provider)
- Their own tool whitelist (hermetic-seal — Discovery only fetches,
  Research fetches + searches + writes, etc.)

## Does
- **newsletter-elicitor** (default: Haiku) — runs the elicit
  phase. Tools: Read, Bash(newsletter ask-elicitor),
  Bash(newsletter await-answers), Write
- **newsletter-discovery** (default: Opus) — runs the discover
  phase. Tools: Read, Bash(newsletter fetch), Write
- **newsletter-research** (default: Opus) — runs the research
  phase. Tools: Read, Bash(newsletter fetch),
  Bash(newsletter search), Write
- **newsletter-podcast** (default: Haiku) — runs the podcast
  phase. Tools: Read, Write
- Each subagent runs to completion and returns the artifact path;
  the top-level cranks forward via `newsletter next`

## Collaborators
- NewsletterSkill: dispatches each phase via the Agent tool
- NewsletterCli: subagents call CLI subcommands for fetch /
  search / ask-elicitor / await-answers
- CostTracker: tracks each subagent's JSONL via the
  subagent-session → agent-name registry the skill writes

## Sequences
- seq-cc-run.md
- seq-cc-elicitor.md
