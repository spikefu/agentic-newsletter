// CRC: crc-CrankHandle.md | R164
//
// Run: node --test lib/parseNewsletter.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewsletter } from './parseNewsletter.js';

const HAPPY = `
# AI Reasoning Hits the Wall

**Subtitle:** What this week's releases tell us about the next year.

The opening paragraph sets the through-line for the issue.

A second intro paragraph adds context.

## Reasoning at Inference Time
**Cluster:** ai-reasoning

Lead paragraph with a concrete finding: [Anthropic's announcement](https://example.com/anthropic) (May 2026) ships Opus 4.7.

Second body paragraph develops the point. *Reasoning* models scale differently from base models; that distinction now matters in **production**.

Third body paragraph closes the section.

**Key links:**
- [Detailed writeup](https://example.com/writeup) (May 2026)
- [Benchmark results](https://example.com/bench) (April 2026)

## EU Carbon Pricing Update
**Cluster:** climate-policy

A different topic entirely.

A second paragraph.

**Key links:**
- [Policy paper](https://example.com/policy)

## Closing

The closing paragraph ties it together with a call to action.

## References

- [Anthropic Opus 4.7 release](https://example.com/anthropic) (May 2026)
- [Reasoning models survey](https://example.com/survey) (March 2026)
`;

test('happy path: title, subtitle, intro, sections, closing, references', () => {
  const { result, errors } = parseNewsletter(HAPPY);
  assert.deepEqual(errors, []);
  assert.equal(result.title, 'AI Reasoning Hits the Wall');
  assert.equal(result.subtitle, "What this week's releases tell us about the next year.");
  assert.match(result.intro, /^<p>The opening paragraph/);
  assert.match(result.intro, /<p>A second intro paragraph adds context\.<\/p>$/);
  assert.equal(result.sections.length, 2);

  const [s1, s2] = result.sections;
  assert.equal(s1.headline, 'Reasoning at Inference Time');
  assert.equal(s1.cluster_id, 'ai-reasoning');
  assert.match(s1.body, /<a href="https:\/\/example\.com\/anthropic" target="_blank" rel="noopener">Anthropic's announcement<\/a>/);
  assert.match(s1.body, /<em>Reasoning<\/em>/);
  assert.match(s1.body, /<strong>production<\/strong>/);
  assert.equal(s1.key_links.length, 2);
  assert.deepEqual(s1.key_links[0], {
    text: 'Detailed writeup',
    url: 'https://example.com/writeup',
    published_date: 'May 2026',
  });

  assert.equal(s2.headline, 'EU Carbon Pricing Update');
  assert.equal(s2.cluster_id, 'climate-policy');
  assert.equal(s2.key_links.length, 1);
  assert.equal(s2.key_links[0].published_date, undefined);

  assert.match(result.closing, /^<p>The closing paragraph/);
  assert.match(result.references, /^<ul>/);
  assert.match(result.references, /<li><a href="https:\/\/example\.com\/anthropic" target="_blank" rel="noopener">Anthropic Opus 4\.7 release<\/a> \(May 2026\)<\/li>/);
});

test('paragraph collapse: single paragraph from contiguous lines', () => {
  const md = `
# T
**Subtitle:** s

## Section
**Cluster:** c

This is one paragraph
spread across two lines.

This is a second paragraph.

**Key links:**
- [a](https://a/)

## Closing

Done.

## References

- ref
`;
  const { result, errors } = parseNewsletter(md);
  assert.deepEqual(errors, []);
  // Two paragraphs, contiguous lines joined.
  assert.match(result.sections[0].body, /<p>This is one paragraph spread across two lines\.<\/p>/);
  assert.match(result.sections[0].body, /<p>This is a second paragraph\.<\/p>/);
});

test('reserved heading names are not treated as sections', () => {
  const md = `
# T
**Subtitle:** s

intro

## Closing
done.
## References
- ref
`;
  const { result, errors } = parseNewsletter(md);
  assert.deepEqual(errors, []);
  assert.equal(result.sections.length, 0);
  assert.match(result.closing, /^<p>done\.<\/p>$/);
  assert.match(result.references, /<li>ref<\/li>/);
});

test('reports orphan cluster line outside any section', () => {
  const md = `
# T
**Subtitle:** s

**Cluster:** c
`;
  const { errors } = parseNewsletter(md);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^line 5: cluster line outside any section/);
});

test('missing top-level # title surfaces as line 1 error', () => {
  const md = `
**Subtitle:** s

## Section
**Cluster:** c
text.

## Closing
.

## References
- r
`;
  const { errors } = parseNewsletter(md);
  assert.equal(errors[0], 'line 1: missing top-level "# Title" heading');
});

test('key_links accept bare URL or trailing-paren title shape', () => {
  const md = `
# T
**Subtitle:** s

## S
**Cluster:** c

body.

**Key links:**
- https://bare.example/
- Title with trailing url (https://trail.example/)
- [md link](https://md.example/)

## Closing
.

## References
- r
`;
  const { result, errors } = parseNewsletter(md);
  assert.deepEqual(errors, []);
  const ks = result.sections[0].key_links;
  assert.equal(ks.length, 3);
  assert.equal(ks[0].url, 'https://bare.example/');
  assert.equal(ks[0].text, 'https://bare.example/');
  assert.equal(ks[1].text, 'Title with trailing url');
  assert.equal(ks[1].url, 'https://trail.example/');
  assert.equal(ks[2].text, 'md link');
  assert.equal(ks[2].url, 'https://md.example/');
});
