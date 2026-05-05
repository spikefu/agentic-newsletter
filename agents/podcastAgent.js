// CRC: crc-PodcastAgent.md | Seq: seq-podcast.md | R67
import { chat, calcCost, MODEL } from '../lib/llm.js';

// CRC: crc-PodcastAgent.md | R66
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// CRC: crc-PodcastAgent.md | Seq: seq-podcast.md | R63, R65, R66, R68, R69, R70
export async function generatePodcastScript(newsletter, send = () => {}, settings = {}) {
  send('phase', { phase: 3, label: 'Podcast', message: 'Generating podcast script…' });
  send('status', { message: 'Writing podcast script…' });

  const sections = (newsletter.sections || []).map(s => ({
    headline: s.headline,
    body: stripHtml(s.body)
  }));

  const content = [
    `Title: ${newsletter.title}`,
    `Intro: ${stripHtml(newsletter.intro)}`,
    '',
    ...sections.map((s, i) => `Section ${i + 1}: ${s.headline}\n${s.body}`),
    newsletter.closing ? `Closing: ${stripHtml(newsletter.closing)}` : ''
  ].filter(Boolean).join('\n\n');

  const system = `You are a podcast script writer. Convert a newsletter into a natural, engaging spoken-word script.

Rules:
- Write in first person plural ("Today we're looking at...", "What's interesting here is...", "Let's dig in...")
- No markdown, no links, no bullet symbols — pure spoken prose
- Spell out numbers when reading them helps ("twenty-five" not "25"), but keep years as numbers
- Add natural transitions between sections ("Moving on to our next story...", "Shifting gears...")
- Start with a warm 2–3 sentence intro welcoming the listener and teasing the topics
- End with a brief sign-off ("That's it for today — thanks for listening")
- 3–6 minutes at normal pace (~550–900 words)
- Do not say "quote" or use quotation marks — rephrase quoted material into the narrative
- Expand acronyms on first use`;

  const result = await chat({
    system,
    messages: [{ role: 'user', content: `Convert this newsletter content into a podcast script:\n\n${content}` }],
    model:    MODEL,
    thinking: false,
    ...settings
  });

  const cost = calcCost(MODEL, result.usage);
  const tps = result.elapsed_ms > 0 && (result.usage?.output_tokens || 0) > 0
    ? Math.round(result.usage.output_tokens / (result.elapsed_ms / 1000)) : null;
  send('step_cost', {
    agent:              'podcast',
    label:              'Podcast · script',
    model:              MODEL,
    input_tokens:       result.usage?.input_tokens                || 0,
    output_tokens:      result.usage?.output_tokens               || 0,
    cache_read_tokens:  result.usage?.cache_read_input_tokens     || 0,
    cache_write_tokens: result.usage?.cache_creation_input_tokens || 0,
    cost,
    running_total:      cost,
    elapsed_ms:         result.elapsed_ms || 0,
    tokens_per_sec:     tps
  });

  if (result.thinking) send('thinking', { text: result.thinking.slice(0, 600) });

  return { script: result.text?.trim() || '', cost };
}
