# LlmProvider
**Requirements:** R86, R87, R88, R89, R90, R91, R92, R94, R95, R96, R97, R99, R100, R101, R102, R103, R104, R105

Provider-agnostic LLM facade. One `chat()` interface, two
back-ends (Claude SDK or Ollama client), normalized tool-call
shapes, and a JSON extractor for loose model output.

## Knows
- `LLM_PROVIDER` env var (`claude` or `ollama`)
- Default model ids: CLAUDE_MODEL, CLAUDE_FAST_MODEL,
  OLLAMA_MODEL, OLLAMA_FAST_MODEL
- `OLLAMA_HOST` env var
- The Anthropic SDK client (lazy)
- The Ollama client + 10-minute fetch dispatcher (lazy)

## Does
- `chat({ system, messages, tools, maxTokens, model, thinking,
  numCtx })` — dispatches to the active provider and returns
  `{ thinking, text, toolCalls, assistantMessage, usage,
  stopReason, elapsed_ms }`
- Normalizes Ollama tool-call args (string→object) and converts
  Claude tool schemas to Ollama function-tool shape
- Strips Ollama `thinking` from the assistant message it pushes to
  history (qwen3 stays coherent that way)
- `makeToolResultMessages(toolCalls, contents)` — returns the
  provider-correct tool-result message shape
- `calcCost(model, usage)` — Claude path delegates to Pricing,
  Ollama path returns 0
- `extractJson(text)` — strips a leading `<think>...</think>` and
  tries `JSON.parse` on the whole string then on the first `{...}`
  match; returns `null` on failure
- For Claude: sends system prompt with `cache_control: ephemeral`
  and asks for `adaptive` thinking when enabled
- Exports `PROVIDER`, `MODEL`, `FAST_MODEL` for use elsewhere

## Collaborators
- Pricing: per-model rate table
- Anthropic SDK: Claude path
- Ollama client: Ollama path

## Sequences
- seq-fresh-run.md
- seq-elicitor.md
- seq-podcast.md
