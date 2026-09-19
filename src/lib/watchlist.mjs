/**
 * Derives the two public files from the private ones.
 *
 * Shared by the command-line builder and the browser, because they must produce
 * byte-identical output: if the app and the script disagreed, publishing from a phone
 * and publishing from a laptop would fight over the same file forever.
 *
 * Neither output carries an owner, a price paid or a target. That is what lets the daily
 * price job run without a decryption key.
 */

/**
 * @param {object} input
 * @param {{items: any[]}} input.collection
 * @param {{items: any[], owner?: string}[]} input.wishlists
 * @param {Iterable<string>} input.manualCardIds
 * @param {string} [input.now]
 */
export function derivePublicFiles({ collection, wishlists, manualCardIds, now }) {
  const manual = new Set(manualCardIds);
  const cards = new Map();
  const waiting = [];
  const skipped = [];

  for (const item of collection.items) {
    if (item.status === 'pending') {
      // The hint is what was read off the physical card. It identifies a printing, not
      // an owner, so it is as publishable as the card id it will become.
      waiting.push({ id: item.id, hint: item.hint, pendingSince: item.pendingSince });
      continue;
    }
    if (item.status !== 'resolved' || !item.cardId) continue;

    if (manual.has(item.cardId)) {
      skipped.push(`${item.cardId} priced manually`);
      continue;
    }
    if (!item.variantId) {
      skipped.push(`${item.cardId} has no priced variant`);
      continue;
    }
    cards.set(item.cardId, { cardId: item.cardId, variantId: item.variantId });
  }

  // Wanted cards need a price too: a target with nothing to compare against is useless.
  for (const list of wishlists) {
    for (const item of list.items) {
      if (item.status === 'bought' || !item.cardId) continue;
      if (manual.has(item.cardId) || cards.has(item.cardId)) continue;
      cards.set(item.cardId, { cardId: item.cardId });
    }
  }

  const generatedAt = now ?? new Date().toISOString();

  return {
    watchlist: {
      version: 1,
      generatedAt,
      cards: [...cards.values()].sort((a, b) => a.cardId.localeCompare(b.cardId)),
    },
    pending: {
      version: 1,
      generatedAt,
      items: waiting.sort((a, b) => a.id.localeCompare(b.id)),
    },
    skipped,
  };
}
