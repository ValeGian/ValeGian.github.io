/**
 * When a 404 from TCGdex is worth doubting.
 *
 * Normally a 404 is an answer and asking again is waste. TCGdex is the exception: `eu`
 * runs on several machines and they do not all carry a new set at once. M6a was published
 * on 28 September 2026 and every card in it then answered 404 to GitHub's runners while
 * answering 200 to a laptop in Europe — which cost five days of price history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Serves the given statuses in order, then repeats the last one. */
function serving(...statuses: number[]) {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const status = statuses[Math.min(seen.length, statuses.length - 1)];
    seen.push(url);
    return status === 200
      ? new Response(JSON.stringify({ id: 'M6a-017', name: 'ピカチュウ' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('', { status });
  }) as typeof fetch;
  return seen;
}

test('a 404 that is really a stale server is recovered on the second ask', async () => {
  const real = globalThis.fetch;
  const seen = serving(404, 200);
  try {
    const { card } = await import(`../scripts/lib/tcgdex.mjs?${Math.random()}`);
    const found = await card('M6a-017');

    assert.equal(found.id, 'M6a-017');
    assert.equal(seen.length, 2, 'asked exactly twice');
  } finally {
    globalThis.fetch = real;
  }
});

test('a card that truly does not exist costs two requests, not five', async () => {
  // The budget is the point: without a cap every run would pay the delay for every
  // genuinely missing card, for ever.
  const real = globalThis.fetch;
  const seen = serving(404);
  try {
    const { card } = await import(`../scripts/lib/tcgdex.mjs?${Math.random()}`);
    await assert.rejects(() => card('M6a-999'));

    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = real;
  }
});

test('any other 4xx is taken at its word, first time', async () => {
  const real = globalThis.fetch;
  const seen = serving(400);
  try {
    const { card } = await import(`../scripts/lib/tcgdex.mjs?${Math.random()}`);
    await assert.rejects(() => card('nonsense'), /400/);

    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});
