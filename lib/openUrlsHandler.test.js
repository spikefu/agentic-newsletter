import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createOpenUrlsHandler } from './openUrlsHandler.js';

// Spin up a real express app with the handler mounted, then drive it with fetch
// against an ephemeral port. Project code (planOpenUrls, the handler) is real;
// only the third-party CDP boundary (openTab) and the Chrome integration
// (getChromeTabs) are faked — this matches CLAUDE.md's mocking policy.

function makeApp({ tabs = [], tabError = null, openTabImpl = async () => {} } = {}) {
  const app = express();
  app.use(express.json());
  const opened = [];
  const handler = createOpenUrlsHandler({
    getChromeTabs: async () => ({ tabs, error: tabError }),
    openTab: async (url) => {
      opened.push(url);
      return openTabImpl(url);
    }
  });
  app.post('/api/open-urls', handler);
  return { app, opened };
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) });
    });
  });
}

async function post(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/open-urls`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ── req-01.4: malformed body ─────────────────────────────────────────────────

test('400 when body.urls is missing', async () => {
  const { app } = makeApp();
  const srv = await listen(app);
  try {
    const r = await post(srv.url, {});
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: 'urls must be a string' });
  } finally { await srv.close(); }
});

test('400 when body.urls is not a string', async () => {
  const { app } = makeApp();
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: ['http://a.com'] });
    assert.equal(r.status, 400);
  } finally { await srv.close(); }
});

// ── req-01.5: per-URL outcomes ───────────────────────────────────────────────

test('opens all-new URLs and reports them as opened in order', async () => {
  const { app, opened } = makeApp({ tabs: [] });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'https://a.com\nhttps://b.com\nhttps://c.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.results, [
      { url: 'https://a.com', status: 'opened' },
      { url: 'https://b.com', status: 'opened' },
      { url: 'https://c.com', status: 'opened' }
    ]);
    assert.deepEqual(opened, ['https://a.com', 'https://b.com', 'https://c.com']);
  } finally { await srv.close(); }
});

test('skips URL already open in Chrome and does not call openTab for it', async () => {
  const { app, opened } = makeApp({ tabs: [{ url: 'https://dup.com' }] });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'https://dup.com\nhttps://new.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.results, [
      { url: 'https://dup.com', status: 'already_open' },
      { url: 'https://new.com', status: 'opened' }
    ]);
    assert.deepEqual(opened, ['https://new.com']);
  } finally { await srv.close(); }
});

test('reports invalid lines and continues with the rest of the batch', async () => {
  const { app, opened } = makeApp();
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'garbage\nftp://x\nhttps://ok.com' });
    assert.equal(r.json.results[0].status, 'invalid');
    assert.equal(r.json.results[1].status, 'invalid');
    assert.equal(r.json.results[2].status, 'opened');
    assert.deepEqual(opened, ['https://ok.com']);
  } finally { await srv.close(); }
});

test('downgrades opened to failed when openTab throws; continues batch', async () => {
  const { app, opened } = makeApp({
    openTabImpl: async (url) => {
      if (url === 'https://bad.com') throw new Error('navigation timed out');
    }
  });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'https://good.com\nhttps://bad.com\nhttps://also-good.com' });
    assert.deepEqual(r.json.results, [
      { url: 'https://good.com',      status: 'opened' },
      { url: 'https://bad.com',       status: 'failed', reason: 'navigation timed out' },
      { url: 'https://also-good.com', status: 'opened' }
    ]);
    // openTab is still attempted on the failing URL
    assert.deepEqual(opened, ['https://good.com', 'https://bad.com', 'https://also-good.com']);
  } finally { await srv.close(); }
});

test('failed reason is truncated to 200 chars', async () => {
  const longMsg = 'x'.repeat(500);
  const { app } = makeApp({ openTabImpl: async () => { throw new Error(longMsg); } });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'https://x.com' });
    assert.equal(r.json.results[0].status, 'failed');
    assert.equal(r.json.results[0].reason.length, 200);
  } finally { await srv.close(); }
});

// ── req-01.4: Chrome unreachable ─────────────────────────────────────────────

test('503 when getChromeTabs reports an error', async () => {
  const { app, opened } = makeApp({ tabError: 'connection refused on port 9222' });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, { urls: 'https://x.com' });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /Chrome unreachable/);
    assert.deepEqual(opened, []);   // nothing opened when Chrome is down
  } finally { await srv.close(); }
});

// ── req-01.5: complex ordering with all four statuses ────────────────────────

test('preserves order of non-empty input lines across all four status types', async () => {
  const { app } = makeApp({
    tabs: [{ url: 'https://existing.com' }],
    openTabImpl: async (url) => { if (url === 'https://broken.com') throw new Error('boom'); }
  });
  const srv = await listen(app);
  try {
    const r = await post(srv.url, {
      urls: [
        'https://new.com',
        '',
        'https://existing.com',
        'not-a-url',
        'https://broken.com',
        'https://new.com'
      ].join('\n')
    });
    assert.deepEqual(r.json.results.map(x => [x.url, x.status]), [
      ['https://new.com',      'opened'],
      ['https://existing.com', 'already_open'],
      ['not-a-url',            'invalid'],
      ['https://broken.com',   'failed'],
      ['https://new.com',      'already_open']
    ]);
  } finally { await srv.close(); }
});
