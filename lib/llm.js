/**
 * Unified LLM provider — Claude or Ollama, selected via LLM_PROVIDER env var.
 * All agents call chat() and makeToolResultMessages(); no provider SDK leaks out.
 */
// CRC: crc-LlmProvider.md | Seq: seq-fresh-run.md, seq-elicitor.md, seq-podcast.md | R86

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { calcCost as _calcClaudeCost } from '../agents/pricing.js';

// ── Configuration ─────────────────────────────────────────────────────────────

// CRC: crc-LlmProvider.md | R87, R88, R89, R90, R91
export const PROVIDER = (process.env.LLM_PROVIDER || 'claude').toLowerCase();

const IS_OLLAMA = PROVIDER === 'ollama';

export const MODEL = IS_OLLAMA
  ? (process.env.OLLAMA_MODEL      || 'qwen3:14b')
  : (process.env.CLAUDE_MODEL      || 'claude-opus-4-7');

export const FAST_MODEL = IS_OLLAMA
  ? (process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:4b')
  : (process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5');

// ── Tool format conversion ────────────────────────────────────────────────────

// CRC: crc-LlmProvider.md | R100
function toOllamaTool(t) {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema }
  };
}

// CRC: crc-LlmProvider.md | R101
function normalizeArgs(args) {
  if (!args) return {};
  if (typeof args === 'string') { try { return JSON.parse(args); } catch { return {}; } }
  return args;
}

// ── Claude provider ───────────────────────────────────────────────────────────

const _claude = IS_OLLAMA ? null : new Anthropic();

// CRC: crc-LlmProvider.md | Seq: seq-fresh-run.md | R94, R95, R96, R104, R105
async function claudeChat({ system, messages, tools, maxTokens, model, thinking }) {
  const response = await _claude.messages.create({
    model,
    max_tokens: maxTokens,
    ...(thinking !== false ? { thinking: { type: 'adaptive' } } : {}),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    ...(tools?.length ? { tools } : {}),
    messages
  });

  let thinkingText = null, text = null;
  const toolCalls = [];

  for (const block of response.content) {
    if (block.type === 'thinking' && block.thinking) thinkingText = block.thinking;
    else if (block.type === 'text'     && block.text)    text = block.text;
    else if (block.type === 'tool_use')
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
  }

  return {
    thinking:         thinkingText,
    text,
    toolCalls,
    assistantMessage: { role: 'assistant', content: response.content },
    usage:            response.usage,
    stopReason:       response.stop_reason
  };
}

// CRC: crc-LlmProvider.md | R97
function claudeToolResultMessages(toolCalls, contents) {
  return [{
    role: 'user',
    content: toolCalls.map((call, i) => ({
      type: 'tool_result', tool_use_id: call.id, content: contents[i]
    }))
  }];
}

// ── Ollama provider ───────────────────────────────────────────────────────────

// CRC: crc-LlmProvider.md | R91, R103
let _ollama = null;
async function getOllama() {
  if (!_ollama) {
    const { Ollama } = await import('ollama');
    const { Agent, fetch: undiciFetch } = await import('undici');
    const tenMinuteFetch = (input, init) => {
      const someInit = init || {};
      return undiciFetch(input, { ...someInit, dispatcher: new Agent({ headersTimeout: 600000 }) });
    };
    _ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434', fetch: tenMinuteFetch });
  }
  return _ollama;
}

// CRC: crc-LlmProvider.md | Seq: seq-fresh-run.md | R94, R95, R96, R100, R101, R102
async function ollamaChat({ system, messages, tools, model, thinking, maxTokens, numCtx }) {
  const ollama = await getOllama();

  const response = await ollama.chat({
    model,
    messages:   [{ role: 'system', content: system }, ...messages],
    ...(tools?.length ? { tools: tools.map(toOllamaTool) } : {}),
    stream:     false,
    think:      thinking !== false,
    options:    {
      temperature: 0.5,
      ...(numCtx    ? { num_ctx:     numCtx    } : {}),
      ...(maxTokens ? { num_predict: maxTokens } : {})
    },
    keep_alive: '1m'
  });

  const msg = response.message;
  const toolCalls = (msg.tool_calls || []).map((tc, i) => ({
    id:    `tc_${Date.now()}_${i}`,
    name:  tc.function.name,
    input: normalizeArgs(tc.function.arguments)
  }));

  // Do NOT include .thinking in the assistant message pushed back to history —
  // qwen3 loses track of context when its own thinking is reflected back.
  const assistantMessage = { role: 'assistant', content: msg.content || '' };
  if (msg.tool_calls?.length) assistantMessage.tool_calls = msg.tool_calls;

  return {
    thinking:   msg.thinking || null,
    text:       msg.content  || null,
    toolCalls,
    assistantMessage,
    usage: {
      input_tokens:                response.prompt_eval_count || 0,
      output_tokens:               response.eval_count        || 0,
      cache_read_input_tokens:     0,
      cache_creation_input_tokens: 0
    },
    stopReason: toolCalls.length ? 'tool_use' : 'end_turn'
  };
}

// CRC: crc-LlmProvider.md | R97
function ollamaToolResultMessages(toolCalls, contents) {
  // Ollama expects one 'tool' message per result, not batched into one user message
  return toolCalls.map((_, i) => ({ role: 'tool', content: contents[i] }));
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * chat({ system, messages, tools, maxTokens, model, thinking })
 *
 * Returns { thinking, text, toolCalls:[{id,name,input}], assistantMessage, usage, stopReason }
 *
 * Push assistantMessage to messages[], then call makeToolResultMessages()
 * and push all returned messages before the next turn.
 */
// CRC: crc-LlmProvider.md | R86, R94, R95
export async function chat(options) {
  const opts = { maxTokens: 16000, model: MODEL, thinking: true, ...options };
  const t0 = Date.now();
  const result = IS_OLLAMA ? await ollamaChat(opts) : await claudeChat(opts);
  result.elapsed_ms = Date.now() - t0;
  return result;
}

/**
 * makeToolResultMessages(toolCalls, contents) → message[]
 *
 * Claude: returns [ { role:'user', content:[...tool_result blocks] } ]
 * Ollama: returns [ { role:'tool', content:'...' }, ... ]   (one per call)
 */
// CRC: crc-LlmProvider.md | R97
export function makeToolResultMessages(toolCalls, contents) {
  return IS_OLLAMA
    ? ollamaToolResultMessages(toolCalls, contents)
    : claudeToolResultMessages(toolCalls, contents);
}

/**
 * calcCost(model, usage) → USD. Always 0 for Ollama.
 */
// CRC: crc-LlmProvider.md | R98
export function calcCost(model, usage) {
  return IS_OLLAMA ? 0 : _calcClaudeCost(model, usage);
}

/**
 * extractJson(text) — pull the first {...} block out of free text.
 * Needed because Ollama models emit thinking prose before the JSON payload.
 */
// CRC: crc-LlmProvider.md | R99
export function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text.trim()); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
