# LLM providers (Claude + Ollama)

**Language / environment:** Node.js 18+, ESM. Wraps the
`@anthropic-ai/sdk` and `ollama` JavaScript clients behind one
provider-agnostic interface.

Agents never call a provider SDK directly. They call a single
`chat()` interface. The provider is selected at startup from
environment variables and used for the whole session.

## Provider selection

The `LLM_PROVIDER` environment variable selects the provider. Two
values are supported: `claude` (default) and `ollama`. Once set,
all agents use the same provider for the whole pipeline.

## Default models

Two models per provider — a "main" model used by Discovery,
Research, and Podcast, and a "fast" model used by the Elicitor:

- Claude main:    `CLAUDE_MODEL`      (default `claude-opus-4-7`)
- Claude fast:    `CLAUDE_FAST_MODEL` (default `claude-haiku-4-5`)
- Ollama main:    `OLLAMA_MODEL`      (default `qwen3:14b`)
- Ollama fast:    `OLLAMA_FAST_MODEL` (default `qwen3:4b`, falls
                  back to `OLLAMA_MODEL` if unset)
- `OLLAMA_HOST`   (default `http://localhost:11434`)

## Per-agent model overrides

The UI's Model Settings panel (Advanced mode) lets the user
override, per agent (Elicitor / Discovery / Research / Podcast):
- model name (free-text dropdown of installed Ollama models or
  Claude model IDs)
- context window size (`num_ctx`, Ollama only — affects how much
  conversation history the model sees)
- max output tokens
- thinking on/off

Per-agent overrides are persisted to the cache and survive server
restarts. Overrides are passed through `chat()` and applied
provider-side.

## Common interface

```
chat({ system, messages, tools, maxTokens, model, thinking, numCtx })
  → { thinking, text, toolCalls, assistantMessage, usage,
      stopReason, elapsed_ms }

makeToolResultMessages(toolCalls, contents) → message[]
calcCost(model, usage) → USD (always 0 for Ollama)
extractJson(text) → object | null
```

`toolCalls` is normalized to `[{ id, name, input }, ...]` regardless
of provider. `assistantMessage` is the message to push back to the
conversation history; the message shape differs by provider but the
caller does not need to know that. `makeToolResultMessages` returns
the right shape per provider — Claude uses one user message with
`tool_result` blocks, Ollama uses one `tool` message per result.

## Ollama-specific behavior

- Tool definitions are converted from Claude's
  `{ name, description, input_schema }` to Ollama's
  `{ type: 'function', function: { name, description, parameters }}`.
- Tool argument values are normalized — Ollama may emit the args as
  a JSON string or an object.
- The model's `thinking` text is **not** reflected back in the
  assistant message pushed to history. Local models like qwen3
  lose track of context when their own thinking is fed back.
- Token cost is always reported as 0 — local inference has no
  per-token charge.
- A 10-minute fetch timeout is configured to accommodate slow local
  inference.

## Claude-specific behavior

- The system prompt is sent with `cache_control: ephemeral` so that
  prompt-caching kicks in on subsequent steps in the same loop.
- When `thinking` is enabled, Claude is asked for `adaptive`
  thinking.
- Cost is computed using a per-model rate table: input, output,
  cache-write, and cache-read prices. Unknown models cost 0.

## JSON extraction

`extractJson` accepts free-form model text, strips an optional
`<think>...</think>` prefix, and attempts to find the first JSON
object — first by parsing the whole string, then by extracting the
first `{...}` block. Returns `null` on failure. Used by the
Elicitor (which returns a strict JSON object) to be tolerant of
local models that emit extra prose.
