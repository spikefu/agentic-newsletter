const RATES = {
  'claude-opus-4-7': {
    input:        5.00 / 1e6,
    output:      25.00 / 1e6,
    cache_write:  6.25 / 1e6,
    cache_read:   0.50 / 1e6
  },
  'claude-haiku-4-5': {
    input:        1.00 / 1e6,
    output:       5.00 / 1e6,
    cache_write:  1.25 / 1e6,
    cache_read:   0.10 / 1e6
  }
};

export function calcCost(model, usage = {}) {
  const r = RATES[model];
  if (!r) return 0;
  return (
    (usage.input_tokens                || 0) * r.input       +
    (usage.output_tokens               || 0) * r.output      +
    (usage.cache_creation_input_tokens || 0) * r.cache_write +
    (usage.cache_read_input_tokens     || 0) * r.cache_read
  );
}

export function fmtCost(d) { return `$${d.toFixed(4)}`; }
export function fmtTokens(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n || 0); }
