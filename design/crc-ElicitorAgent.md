# ElicitorAgent
**Requirements:** R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31

Pre-pipeline clarifier. Looks at the user's open tabs plus any
existing context and either asks 2–3 clarifying questions or
declares the context sufficient. After the user answers, turns the
Q&A into a context block for downstream agents.

## Knows
- ELICIT_SYSTEM prompt (analyze)
- SYNTHESIZE_SYSTEM prompt (synthesize)
- Fast-model identity from LlmProvider

## Does
- `elicitContext(tabs, existingContext, send, settings)` — calls
  the fast model, parses JSON loosely (strips `<think>` blocks),
  returns `{ ready, questions, suggestion }`; on parse failure
  defaults to `ready: true`
- `synthesizeContext(tabs, existingContext, qa, send, settings)` —
  calls the fast model with the Q&A and returns 3–5 second-person
  sentences; returns the original context unchanged when the user
  answered nothing
- Emits `step_cost` events labeled "Elicitor · analysis" and
  "Elicitor · synthesis"

## Collaborators
- LlmProvider: `chat()`, `calcCost()`, `extractJson()`, FAST_MODEL
- Server: receives the synthesized context and persists it to
  `cache/elicitor-context.txt`

## Sequences
- seq-elicitor.md
