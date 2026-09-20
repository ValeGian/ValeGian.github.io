/**
 * Turning a failed request into something worth reading.
 *
 * `Failed to fetch` is what a browser says when the connection drops, and it means
 * nothing to someone standing in a shop with the card in their hand. Worse, it reads as
 * though the app is broken, when the way out is already on the form: a card can be typed
 * in by hand and matched to the catalog later by the daily job.
 *
 * Anything that is not a connection failure is passed through untouched — "Could not
 * load SV2a-201 (404)" is a fact about that card, and rewording it would hide it.
 */

/**
 * Failures that are the network rather than the answer.
 *
 * The wording differs by browser — Chrome says "Failed to fetch", Firefox
 * "NetworkError when attempting to fetch resource", Safari "Load failed" — and a 5xx or
 * a 429 reaching here means the retry inside the catalog client already gave up.
 */
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed|\((?:5\d\d|429)\)/i;

const CANNOT_REACH_CATALOG =
  'Could not reach the catalog. Try again in a moment, or tick “Not in the catalog yet” to record ' +
  'the card now — the daily job matches it up later.';

export function saveErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return NETWORK_FAILURE.test(text) ? CANNOT_REACH_CATALOG : text;
}
