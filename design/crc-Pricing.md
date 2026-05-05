# Pricing
**Requirements:** R98, R106

Per-model token cost calculator and small formatting helpers for
Claude. Returns 0 for unknown models so the pipeline degrades
gracefully when a new model isn't yet in the rate table.

## Knows
- RATES table — input, output, cache_write, cache_read prices per
  model id (per token, USD)
- Currently configured: `claude-opus-4-7`, `claude-haiku-4-5`

## Does
- `calcCost(model, usage)` — sums `input_tokens × input` +
  `output_tokens × output` + `cache_creation_input_tokens ×
  cache_write` + `cache_read_input_tokens × cache_read`; returns
  0 if model isn't in RATES
- `fmtCost(d)` — formats as `$0.0000`
- `fmtTokens(n)` — formats as `N` or `N.NK`

## Collaborators
- LlmProvider: imports `calcCost` and re-exports as the
  Claude-specific implementation behind the unified
  `calcCost(model, usage)` interface

## Sequences
(none — pure utility, called from per-step cost reporting)
