/**
 * The catalog lookup that stands between a person and their card being recorded.
 *
 * It is made at the moment the button is pressed, on whatever connection is available in
 * a shop, and it used to be a single `fetch`: one dropped packet and the save failed. The
 * point of these tests is the discrimination — a bad moment is retried, an answer is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardDetail } from '../src/personal/lib/tcgdex.ts';

const card = { id: 'SV2a-201', localId: '201', name: 'リザードンex', set: { id: 'SV2a' } };
const ok = () => new Response(JSON.stringify(card), { status: 200, headers: { 'content-type': 'application/json' } });

/** Replaces `fetch` for one test, and puts the real one back whatever happens. */
async function withFetch(stub: typeof fetch, run: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test('a dropped connection is retried once, and the card is still recorded', async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return ok();
  }) as typeof fetch;

  await withFetch(stub, async () => {
    const detail = await cardDetail('SV2a-201');

    assert.equal(detail.id, 'SV2a-201');
    assert.equal(calls, 2, 'asked again rather than failing the save');
  });
});

test('a server having a moment is retried once', async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return calls === 1 ? new Response('', { status: 503 }) : ok();
  }) as typeof fetch;

  await withFetch(stub, async () => {
    await cardDetail('SV2a-201');
    assert.equal(calls, 2);
  });
});

test('a card the catalog does not have is not asked for twice', async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return new Response('', { status: 404 });
  }) as typeof fetch;

  await withFetch(stub, async () => {
    await assert.rejects(() => cardDetail('M6a-105'), /M6a-105 \(404\)/);
    assert.equal(calls, 1, 'a 404 is an answer; asking again would only cost time');
  });
});

test('a connection that is still down reports the failure rather than hanging on it', async () => {
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;

  await withFetch(stub, async () => {
    await assert.rejects(() => cardDetail('SV2a-201'), /Failed to fetch/);
    assert.equal(calls, 2, 'two attempts, then the truth');
  });
});
