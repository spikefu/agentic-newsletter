import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOpenUrls } from './openUrls.js';

// ── req-01.2: parsing ────────────────────────────────────────────────────────

test('empty string yields no results', () => {
  const { results, toOpen } = planOpenUrls('', []);
  assert.deepEqual(results, []);
  assert.deepEqual(toOpen, []);
});

test('whitespace-only string yields no results', () => {
  const { results, toOpen } = planOpenUrls('  \n\t\n   \r\n', []);
  assert.deepEqual(results, []);
  assert.deepEqual(toOpen, []);
});

test('lines are trimmed of leading/trailing whitespace', () => {
  const { results, toOpen } = planOpenUrls('   https://example.com  ', []);
  assert.deepEqual(results, [{ url: 'https://example.com', status: 'opened' }]);
  assert.deepEqual(toOpen, ['https://example.com']);
});

test('CRLF line endings are handled', () => {
  const { toOpen } = planOpenUrls('https://a.com\r\nhttps://b.com\r\n', []);
  assert.deepEqual(toOpen, ['https://a.com', 'https://b.com']);
});

test('http and https are valid; other protocols are invalid', () => {
  const raw = [
    'http://plain.com',
    'https://secure.com',
    'ftp://files.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:a@b.com'
  ].join('\n');
  const { results } = planOpenUrls(raw, []);
  assert.equal(results[0].status, 'opened');
  assert.equal(results[1].status, 'opened');
  assert.equal(results[2].status, 'invalid');
  assert.equal(results[3].status, 'invalid');
  assert.equal(results[4].status, 'invalid');
  assert.equal(results[5].status, 'invalid');
});

test('garbage lines are reported invalid with original line preserved', () => {
  const { results } = planOpenUrls('not a url at all', []);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'not a url at all');
  assert.equal(results[0].status, 'invalid');
  assert.ok(results[0].reason);
});

test('does not auto-prepend https://', () => {
  // req-01.2 explicitly forbids fuzzy extraction
  const { results } = planOpenUrls('example.com', []);
  assert.equal(results[0].status, 'invalid');
});

// ── req-01.3: deduplication ──────────────────────────────────────────────────

test('URL matching an existing tab is reported already_open and not opened', () => {
  const { results, toOpen } = planOpenUrls('https://x.com/a', ['https://x.com/a']);
  assert.deepEqual(results, [{ url: 'https://x.com/a', status: 'already_open' }]);
  assert.deepEqual(toOpen, []);
});

test('duplicate within batch is opened once; subsequent occurrences already_open', () => {
  const { results, toOpen } = planOpenUrls('https://a.com\nhttps://a.com\nhttps://a.com', []);
  assert.equal(results.length, 3);
  assert.equal(results[0].status, 'opened');
  assert.equal(results[1].status, 'already_open');
  assert.equal(results[2].status, 'already_open');
  assert.deepEqual(toOpen, ['https://a.com']);
});

test('exact-string match only: trailing slash difference is NOT a duplicate', () => {
  // Per spec note in req-01.3 — string comparison only, no normalization.
  const { results, toOpen } = planOpenUrls('https://x.com/a/', ['https://x.com/a']);
  assert.equal(results[0].status, 'opened');
  assert.deepEqual(toOpen, ['https://x.com/a/']);
});

test('order of results matches order of non-empty input lines', () => {
  const raw = [
    'https://one.com',
    '',
    '   ',
    'not-a-url',
    'https://two.com',
    'https://one.com'   // dup of first
  ].join('\n');
  const { results } = planOpenUrls(raw, ['https://three.com']);
  assert.deepEqual(results.map(r => [r.url, r.status]), [
    ['https://one.com',  'opened'],
    ['not-a-url',        'invalid'],
    ['https://two.com',  'opened'],
    ['https://one.com',  'already_open']
  ]);
});

test('mixed invalid + dup + new + existing gives correct toOpen list', () => {
  const existing = ['https://already.com'];
  const raw = [
    'https://new1.com',
    'https://already.com',
    'garbage',
    'https://new2.com',
    'https://new1.com'
  ].join('\n');
  const { toOpen } = planOpenUrls(raw, existing);
  assert.deepEqual(toOpen, ['https://new1.com', 'https://new2.com']);
});

// ── input validation ─────────────────────────────────────────────────────────

test('throws TypeError if raw is not a string', () => {
  assert.throws(() => planOpenUrls(null, []),       /raw must be a string/);
  assert.throws(() => planOpenUrls(123,  []),       /raw must be a string/);
  assert.throws(() => planOpenUrls(['a'], []),      /raw must be a string/);
});

test('throws TypeError if existingUrls is not an array', () => {
  assert.throws(() => planOpenUrls('', null),       /existingUrls must be an array/);
  assert.throws(() => planOpenUrls('', 'http://x'), /existingUrls must be an array/);
});
