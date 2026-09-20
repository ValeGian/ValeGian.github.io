/**
 * What the browser is allowed to send to GitHub.
 *
 * This exists because of a real outage: a `Cache-Control: no-cache` request header was
 * added to stop a commit being built on a cached branch head. It is not CORS-safelisted,
 * so it turns every call into a preflight, and GitHub does not list it in
 * Access-Control-Allow-Headers — so the browser blocked every request and reported
 * "Failed to fetch", which reads as a network problem and is not one. Publishing from the
 * browser stopped working entirely.
 *
 * The cache is bypassed by the fetch option instead, which needs no preflight.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkToken } from '../src/lib/github.mjs';

/** Captures what the client sends, without a network. */
async function headersSentBy(run: () => Promise<unknown>): Promise<{ headers: Headers; init: RequestInit }> {
  const real = globalThis.fetch;
  let seen: { headers: Headers; init: RequestInit } | null = null;

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen = { headers: new Headers(init.headers), init };
    return new Response(JSON.stringify({ permissions: { push: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }

  assert.ok(seen, 'nothing was sent');
  return seen;
}

test('no request header that GitHub will not allow through a preflight', async () => {
  const { headers } = await headersSentBy(() => checkToken({ token: 't', owner: 'o', repo: 'r' }));

  // The one that broke it. Anything else outside the safelist belongs in this check too.
  assert.equal(headers.get('cache-control'), null, 'Cache-Control blocks the preflight — use the fetch option');
  assert.equal(headers.get('pragma'), null);
});

test('the cache is bypassed the way that needs no preflight', async () => {
  const { init, headers } = await headersSentBy(() => checkToken({ token: 't', owner: 'o', repo: 'r' }));

  // A commit built on a minute-old branch head is rejected as not a fast forward, so
  // these responses must never come from the cache.
  assert.equal(init.cache, 'no-store');

  // And the headers the API does need are still there.
  assert.equal(headers.get('accept'), 'application/vnd.github+json');
  assert.equal(headers.get('authorization'), 'Bearer t');
  assert.equal(headers.get('x-github-api-version'), '2022-11-28');
});
