/**
 * How much of the watchlist a snapshot actually priced.
 *
 * Pulled out of the daily job so it can be tested without a network, and because the
 * arithmetic was wrong in a way that was invisible in the job: it counted every price it
 * held and then subtracted the hand-priced overrides, which is only the same number when
 * every override has a price. An override entry with none was subtracted without ever
 * having been added, quietly making the day look worse than it was and moving the
 * threshold at which the job refuses to write.
 *
 * Counting the watched cards directly needs no correction and cannot drift from the way
 * the prices were collected.
 *
 * @param {{cards: {cardId: string}[]}} watchlist
 * @param {Record<string, unknown>} prices every price the run holds, overrides included
 * @returns {{expected: number, got: number, missing: string[]}}
 */
export function watchlistCoverage(watchlist, prices) {
  const missing = watchlist.cards.filter((entry) => !(entry.cardId in prices)).map((entry) => entry.cardId);
  return { expected: watchlist.cards.length, got: watchlist.cards.length - missing.length, missing };
}

/** True when so much of the watchlist is missing that the day is not worth writing. */
export function isTooIncomplete({ expected, got }, maxLossRatio) {
  return expected > 0 && got / expected < 1 - maxLossRatio;
}
