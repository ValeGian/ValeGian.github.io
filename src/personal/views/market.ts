import { el } from '../lib/dom.ts';
import { marketLinks, type Market } from '../lib/market.ts';

/**
 * The two "see it on the market" links under a card.
 *
 * The market data is held here rather than threaded through every view, for the reason
 * `data.ts` holds the discovered artwork: it is one presentational lookup, read by the
 * collection panel and the wishlist panel and nowhere else. `marketLinks` stays a pure
 * function of its arguments, so what it decides is testable without a browser.
 */
let published: Market | null = null;

export function usePublishedMarket(market: Market | null): void {
  published = market;
}

/**
 * A set's name as a person would say it, for a heading.
 *
 * Taken from the market data, which holds Cardmarket's own expansion names — read off
 * their expansion list rather than invented here, so "M6" reads as "Storm Emeralda" and
 * not as something plausible. A card still waiting on the catalog carries the set name
 * that was typed with it, and the bare code is the last resort: better a code than a
 * guess, since the code is what is printed on the card.
 */
export function setName(setId: string | undefined, hinted?: string): string | null {
  if (!setId) return hinted ?? null;
  const known = published?.sets?.[setId]?.cardmarket?.expansion;
  return known ?? hinted ?? setId;
}

interface Identifiable {
  cardId?: string;
  setId?: string;
  number?: string;
  nameEn?: string | null;
  hint?: { setCode: string; number: string };
}

/**
 * Says so when a link is a search rather than the card's own page.
 *
 * Both kinds land on the right card, but they are not the same promise, and this project
 * has been bitten often enough by a link that looked exact and was not.
 */
function marketLink(label: string, link: { href: string; isExact: boolean }): HTMLElement {
  return el(
    'a',
    {
      class: 'market-link',
      href: link.href,
      target: '_blank',
      // noopener for the new tab, noreferrer so the shop is not told where we came from.
      rel: 'noopener noreferrer',
    },
    el('span', { text: label }),
    link.isExact ? null : el('span', { class: 'market-note ui', text: 'search' }),
  );
}

/** Null when neither site can be reached for this card, rather than an empty row. */
export function marketRow(item: Identifiable): HTMLElement | null {
  const links = marketLinks(item, published);
  if (!links.cardmarket && !links.pricecharting) return null;

  return el(
    'div',
    { class: 'market-links' },
    links.cardmarket ? marketLink('Cardmarket', links.cardmarket) : null,
    links.pricecharting ? marketLink('PriceCharting', links.pricecharting) : null,
  );
}
