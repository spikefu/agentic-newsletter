# Elicitor agent

**Language / environment:** Node.js 18+, ESM. Runs server-side
before the main SSE pipeline opens.

The Elicitor exists because vague user prompts produce generic
newsletters. Its job is to look at the user's open tabs and any
context they typed in, then either ask 2–3 short clarifying
questions or declare the context already sufficient. It is the
cheapest stage and uses the configured "fast" model.

## Behavior

### Phase 1: analyze
Given the list of tab titles + URLs and any free-text context the
user already provided, the elicitor returns one of:

- `ready: true` with an empty `questions` list and a one-sentence
  `suggestion` summarizing what it noticed. The pipeline can run
  immediately.
- `ready: false` with 2–3 short, specific questions and a one-
  sentence `suggestion` explaining what gap prompted the questions.

Questions must be:
- Short — one sentence each.
- Specific — referencing particular tab titles or domains where
  possible (so the user can see the elicitor is paying attention).
- Focused on: what the user was trying to accomplish, who will read
  the newsletter, what to emphasize or group.

### Phase 2: synthesize
After the user answers the questions, the elicitor turns the Q&A
into a 3–5 sentence context block written as direct instructions to
the Discovery and Research agents (second person — "Focus on...",
"The reader is...", "Group by...").

If the user answered no questions, the synthesized output is empty
and the original free-text context (if any) is used unchanged.

The synthesized context is persisted to the cache and takes
precedence over the raw discovery prompt file when the main
pipeline runs.

## Cost and progress

The elicitor reports its own `step_cost` events labeled
"Elicitor · analysis" and "Elicitor · synthesis". Because the
elicitor runs before the main SSE stream opens, its events are
buffered and replayed when the stream connects.

## Output parsing

The elicitor model is instructed to return a strict JSON object.
Its output is parsed loosely — leading/trailing prose and
`<think>...</think>` blocks (emitted by some local models) are
stripped before JSON extraction. If parsing fails, the elicitor
returns `ready: true` with an empty question list so the pipeline
proceeds rather than blocking on a malformed response.
