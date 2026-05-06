// CRC: crc-CrankHandle.md | R164
//
// Run: node --test lib/parseClusters.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClusters } from './parseClusters.js';

const HAPPY = `
## AI Reasoning Models
**Theme:** Claude 4.7 and o3 demonstrate that inference-time reasoning
extends what models can do without retraining. The shift is architectural,
not just a tuning trick.

### Source: https://example.com/article-one
- **Page title:** Article One Title
- **Published:** 2026-04-15
- **Summary:** Two-sentence summary describing what the article covers.
- **Key points:**
  - First key point
  - Second key point
- **Notable links:**
  - https://example.com/follow-up
  - https://example.com/related

## Climate Policy
**Theme:** EU carbon pricing is reshaping industrial planning across multiple sectors.

### Source: https://example.com/eu-cbam
- **Page title:** EU Carbon Border Adjustment
- **Published:** (unknown)
- **Summary:** What the article covers.
- **Key points:**
  - Single key point
- **Notable links:**
`;

test('happy path: two clusters, sources, fields, dates, arrays', () => {
  const { result, errors } = parseClusters(HAPPY);
  assert.deepEqual(errors, []);
  assert.equal(result.clusters.length, 2);

  const [ai, climate] = result.clusters;
  assert.equal(ai.id, 'ai-reasoning-models');
  assert.equal(ai.title, 'AI Reasoning Models');
  assert.match(ai.theme_summary, /^Claude 4\.7/);
  assert.match(ai.theme_summary, /architectural,\nnot just/);  // multi-line theme joined
  assert.equal(ai.sources.length, 1);

  const src = ai.sources[0];
  assert.equal(src.url, 'https://example.com/article-one');
  assert.equal(src.page_title, 'Article One Title');
  assert.equal(src.published_date, '2026-04-15');
  assert.equal(src.summary, 'Two-sentence summary describing what the article covers.');
  assert.deepEqual(src.key_points, ['First key point', 'Second key point']);
  assert.deepEqual(src.notable_links, ['https://example.com/follow-up', 'https://example.com/related']);

  const cSrc = climate.sources[0];
  assert.equal(cSrc.published_date, null);
  assert.deepEqual(cSrc.notable_links, []);
});

test('slug uniqueness: identical titles get suffixed', () => {
  const md = `
## Same Title
**Theme:** A.
### Source: https://a/
- **Page title:** A
- **Summary:** A.
- **Key points:**
  - p

## Same Title
**Theme:** B.
### Source: https://b/
- **Page title:** B
- **Summary:** B.
- **Key points:**
  - p
`;
  const { result, errors } = parseClusters(md);
  assert.deepEqual(errors, []);
  assert.equal(result.clusters[0].id, 'same-title');
  assert.equal(result.clusters[1].id, 'same-title-2');
});

test('reports error when source appears before any cluster', () => {
  const md = `
### Source: https://orphan/
- **Page title:** orphan
`;
  const { errors } = parseClusters(md);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^line 2: /);
  assert.match(errors[0], /before any cluster/);
});

test('reports error when bullet field appears before any source', () => {
  const md = `
## Cluster
**Theme:** t.
- **Page title:** orphan field
`;
  const { errors } = parseClusters(md);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^line 4: /);
  assert.match(errors[0], /before any source/);
});

test('reports error for unknown source field with line number', () => {
  const md = `
## Cluster
**Theme:** t.
### Source: https://x/
- **Tldr:** wrong field
- **Page title:** ok
- **Summary:** ok.
- **Key points:**
  - p
`;
  const { result, errors } = parseClusters(md);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^line 5: /);
  assert.match(errors[0], /unknown source field "Tldr"/);
  // Other fields still parsed
  assert.equal(result.clusters[0].sources[0].page_title, 'ok');
});

test('inline-on-same-line array entry is captured', () => {
  const md = `
## Cluster
**Theme:** t.
### Source: https://x/
- **Page title:** P
- **Summary:** S.
- **Key points:** single inline point
- **Notable links:** https://only-one/
`;
  const { result, errors } = parseClusters(md);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.clusters[0].sources[0].key_points, ['single inline point']);
  assert.deepEqual(result.clusters[0].sources[0].notable_links, ['https://only-one/']);
});

test('"(none)" placeholders are treated as empty', () => {
  const md = `
## Cluster
**Theme:** t.
### Source: https://x/
- **Page title:** P
- **Published:** (unknown)
- **Summary:** S.
- **Key points:**
  - (none)
- **Notable links:**
  - (none)
`;
  const { result, errors } = parseClusters(md);
  assert.deepEqual(errors, []);
  assert.equal(result.clusters[0].sources[0].published_date, null);
  assert.deepEqual(result.clusters[0].sources[0].key_points, []);
  assert.deepEqual(result.clusters[0].sources[0].notable_links, []);
});
