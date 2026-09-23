/**
 * Telling a dead field from one that is merely not refreshed today.
 *
 * Cardmarket's averages move about once a week. Across the five snapshots from 19 to 23
 * September 2026, avg1, avg7 and avg30 changed on 58 to 59 of 60 cards at exactly one
 * boundary — the data stamped Sunday 20 September — and on none at the other three, while
 * `trend` and `low` moved every day and TCGdex's own `updated` stamp advanced daily.
 *
 * So "identical since yesterday" is the normal state of every card for most of a week,
 * and reporting it is noise. What is worth reporting is a run longer than one refresh
 * cycle with no movement at all.
 */

/** A week, plus enough slack that a late refresh is not mistaken for a dead one. */
export const CADENCE_DAYS = 10;

/** Below this share of the cards, it is a few quiet cards rather than a dead field. */
export const FROZEN_SHARE = 0.95;

/** Under this many cards there is no share worth taking. */
export const FROZEN_MINIMUM = 10;

/**
 * Which cards did not move on any of `fields` across every reading given.
 *
 * @param {Record<string, any>[]} readings oldest first, one per day, today's last
 * @param {string[]} cardIds cards to judge
 * @param {string[]} fields fields that must all be identical throughout
 */
export function unmovedAcross(readings, cardIds, fields) {
  const [first] = readings;
  return cardIds.filter((cardId) =>
    readings.every((day) => fields.every((field) => day[cardId][field] === first[cardId][field])),
  );
}

/**
 * Cards the catalog priced on every day of the window.
 *
 * A hand-read figure is a different measurement of the same card, so a window containing
 * one would read as movement and dilute the very signal this is looking for.
 */
export function comparableCards(readings) {
  const today = readings.at(-1) ?? {};
  return Object.keys(today).filter((cardId) =>
    readings.every((day) => day[cardId]?.source === 'cardmarket/tcgdex'),
  );
}

/**
 * Whether the averages have stopped, given a window of daily readings.
 *
 * Returns null when there is nothing to say — too little history to tell a dead field
 * from one that has simply not been refreshed yet, or too few comparable cards.
 */
export function frozenVerdict(readings) {
  if (readings.length <= CADENCE_DAYS) return null;

  const shared = comparableCards(readings);
  if (shared.length < FROZEN_MINIMUM) return null;

  const averages = unmovedAcross(readings, shared, ['avg30', 'avg7', 'avg1']);
  const spot = unmovedAcross(readings, shared, ['low', 'trend']);
  if (averages.length / shared.length < FROZEN_SHARE) return null;

  return { shared: shared.length, averages: averages.length, spot: spot.length };
}
