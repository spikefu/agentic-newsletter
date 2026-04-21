import { chat, calcCost, extractJson, FAST_MODEL } from '../lib/llm.js';

const ELICIT_SYSTEM = `You are a context elicitor for an AI newsletter pipeline.

The user has a set of browser tabs open. A Discovery Agent will fetch those pages, cluster them into themes, and a Research Agent will write a newsletter from the results. You read the tab list and any context the user already provided, then decide what to ask.

Rules:
- Ask 2–3 short, specific questions — not open-ended essays
- Reference specific tab titles or domains you noticed (shows you're paying attention)
- Focus on: what the user was trying to accomplish, who will read the newsletter, what to emphasize or group
- If the existing context already answers these clearly, return ready=true instead of asking redundant questions
- Keep each question to one sentence

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "ready": false,
  "questions": ["...", "..."],
  "suggestion": "One sentence on what you noticed that prompted these questions"
}

If context is already sufficient:
{
  "ready": true,
  "questions": [],
  "suggestion": "Context is clear — ready to proceed."
}`;

const SYNTHESIZE_SYSTEM = `You are synthesizing a brief clarifying Q&A into a context block for an AI newsletter pipeline.

The Discovery Agent and Research Agent will use this context to decide how to cluster content, what angle to take, and how to write.

Write 3–5 sentences. Capture: what the user was trying to accomplish, their role/background if mentioned, what to focus on, and any grouping or framing preferences. Be specific — incorporate details from their answers. Write as direct instructions to the agents in second person ("Focus on...", "The reader is...", "Group by..."). Do not repeat the questions — just synthesize the intent.`;

export async function elicitContext(tabs, existingContext, send = () => {}) {
  send('phase', { phase: 0, label: 'Elicitor', message: 'Analyzing your tabs and context…' });
  send('status', { message: 'Elicitor: determining clarifying questions…' });

  const tabSummary = tabs.map((t, i) => `${i + 1}. "${t.title}" — ${t.url}`).join('\n');

  const userMsg = [
    '## Browser tabs open right now',
    tabSummary,
    existingContext?.trim()
      ? `\n## Context the user already provided\n${existingContext.trim()}`
      : '\n(No existing context provided)',
    '\nWhat questions, if any, should I ask this user before running the newsletter pipeline?'
  ].join('\n');

  const result = await chat({
    system:    ELICIT_SYSTEM,
    messages:  [{ role: 'user', content: userMsg }],
    model:     FAST_MODEL,
    maxTokens: 512,
    thinking:  false
  });

  const stepCost = calcCost(FAST_MODEL, result.usage);
  send('step_cost', {
    agent:              'elicitor',
    label:              'Elicitor · analysis',
    model:              FAST_MODEL,
    input_tokens:       result.usage?.input_tokens                || 0,
    output_tokens:      result.usage?.output_tokens               || 0,
    cache_read_tokens:  result.usage?.cache_read_input_tokens     || 0,
    cache_write_tokens: result.usage?.cache_creation_input_tokens || 0,
    cost:               stepCost,
    running_total:      stepCost
  });

  // qwen3 can embed <think>…</think> in msg.content even when think:false
  const rawText   = result.text || '';
  const cleanText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const parsed    = extractJson(cleanText);
  if (!parsed) {
    console.warn('[elicitor] Could not parse model response:', rawText.slice(0, 400));
    return { ready: true, questions: [], suggestion: 'Ready to proceed.' };
  }

  return {
    ready:      parsed.ready      ?? true,
    questions:  parsed.questions  ?? [],
    suggestion: parsed.suggestion ?? ''
  };
}

export async function synthesizeContext(tabs, existingContext, qa, send = () => {}) {
  const tabSummary = tabs.map((t, i) => `${i + 1}. "${t.title}" — ${t.url}`).join('\n');
  const qaText = qa
    .filter(item => item.a?.trim())
    .map((item, i) => `Q${i + 1}: ${item.q}\nAnswer: ${item.a}`)
    .join('\n\n');

  if (!qaText) return existingContext || '';

  send('status', { message: 'Elicitor: synthesizing your answers…' });

  const userMsg = [
    '## Browser tabs',
    tabSummary,
    existingContext?.trim()
      ? `\n## User's original context notes\n${existingContext.trim()}`
      : '',
    `\n## Clarifying Q&A\n${qaText}`,
    '\nSynthesize this into a context block for the Discovery and Research agents.'
  ].filter(Boolean).join('\n');

  const result = await chat({
    system:    SYNTHESIZE_SYSTEM,
    messages:  [{ role: 'user', content: userMsg }],
    model:     FAST_MODEL,
    maxTokens: 400,
    thinking:  false
  });

  const stepCost = calcCost(FAST_MODEL, result.usage);
  send('step_cost', {
    agent:              'elicitor',
    label:              'Elicitor · synthesis',
    model:              FAST_MODEL,
    input_tokens:       result.usage?.input_tokens                || 0,
    output_tokens:      result.usage?.output_tokens               || 0,
    cache_read_tokens:  result.usage?.cache_read_input_tokens     || 0,
    cache_write_tokens: result.usage?.cache_creation_input_tokens || 0,
    cost:               stepCost,
    running_total:      stepCost
  });

  return result.text?.trim() || existingContext || '';
}
