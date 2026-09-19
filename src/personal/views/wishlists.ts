/**
 * Wishlists.
 *
 * One list per person, and a combined view that puts every wanted card on one page —
 * the one to hold while walking a shop, so nothing needs switching between people.
 *
 * A card bought for a friend never enters the collection. It stays on their list, marked
 * bought, and its cost joins what they owe. Their cards are not my assets.
 */
import { el, frag } from '../lib/dom.ts';
import { money, marketValue } from '../lib/money.ts';
import { displayName, subtitle, type NameTable } from '../lib/data.ts';
import { cardThumb } from './thumb.ts';
import type { Price, PriceSnapshot, Wishlist, WishlistItem } from '../lib/types.ts';

export interface WishlistViewState {
  lists: Record<string, Wishlist>;
  prices: PriceSnapshot | null;
  names: NameTable;
  combined: boolean;
  canEdit: boolean;
  onToggleCombined(): void;
  onMarkBought?(owner: string, itemId: string): void;
}

const priceFor = (item: WishlistItem, prices: PriceSnapshot | null): Price | undefined =>
  item.cardId ? prices?.prices[item.cardId] : undefined;

/** Balance is computed from the purchases behind it, never stored, so it cannot drift. */
export function balance(list: Wishlist): { bought: number; settled: number; owed: number } {
  const bought = list.items
    .filter((item) => item.status === 'bought')
    .reduce((sum, item) => sum + (item.purchase?.amountEur ?? 0), 0);
  const settled = list.settlements.reduce((sum, entry) => sum + entry.amountEur, 0);
  return { bought, settled, owed: bought - settled };
}

function targetMarker(item: WishlistItem, price: Price | undefined): HTMLElement | null {
  const market = marketValue(price);
  if (market === null || item.targetPriceEur === null) return null;
  const under = market <= item.targetPriceEur;
  return el('span', {
    class: under ? 'target under' : 'target over',
    text: under ? 'at or under target' : 'over target',
  });
}

function wishRow(
  item: WishlistItem,
  owner: string,
  state: WishlistViewState,
  showOwner: boolean,
): HTMLElement {
  const price = priceFor(item, state.prices);
  const market = marketValue(price);
  const bought = item.status === 'bought';

  return el(
    'li',
    { class: bought ? 'wish-row bought' : 'wish-row' },
    // Eager: a wishlist is short, and these rows appear on a tab switch, where the lazy
    // loader does not reliably fire for freshly inserted elements.
    cardThumb(item, { width: 40, height: 56 }, 'eager'),
    el(
      'span',
      { class: 'card-name' },
      el('span', { class: 'card-title', text: displayName(item, state.names) }),
      el(
        'span',
        { class: 'card-meta ui' },
        subtitle(item),
        showOwner ? el('span', { class: 'owner', text: owner }) : null,
        item.priority === 'high' ? el('span', { class: 'flag', text: 'priority' }) : null,
      ),
      item.notes ? el('span', { class: 'wish-note', text: item.notes }) : null,
    ),
    el(
      'span',
      { class: 'wish-figures' },
      el('span', {
        class: 'target-price numeric',
        text: item.targetPriceEur === null ? 'no target' : `target ${money(item.targetPriceEur)}`,
      }),
      el('span', { class: 'value numeric', text: market === null ? '—' : money(market) }),
      bought
        ? el('span', {
            class: 'bought-badge ui',
            text: `bought ${item.purchase ? money(item.purchase.amountEur) : ''}`.trim(),
          })
        : targetMarker(item, price),
    ),
    bought || !state.canEdit || !state.onMarkBought
      ? null
      : el('button', {
          type: 'button',
          class: 'mark-bought',
          text: 'Bought',
          onClick: () => state.onMarkBought?.(owner, item.id),
        }),
  );
}

function listBlock(owner: string, list: Wishlist, state: WishlistViewState): HTMLElement {
  const wanted = list.items.filter((item) => item.status !== 'bought');
  const purchased = list.items.filter((item) => item.status === 'bought');
  const figures = balance(list);
  const isFriend = owner !== 'valerio';

  return el(
    'section',
    { class: 'wish-list' },
    el('h3', { text: list.owner }),
    isFriend
      ? el(
          'dl',
          { class: 'summary' },
          el('div', {}, el('dt', { text: 'Bought so far' }), el('dd', { class: 'numeric', text: money(figures.bought) })),
          el('div', {}, el('dt', { text: 'Settled' }), el('dd', { class: 'numeric', text: money(figures.settled) })),
          el('div', {}, el('dt', { text: 'Owes me' }), el('dd', { class: 'numeric', text: money(figures.owed) })),
        )
      : null,
    list.items.length === 0
      ? el('p', { class: 'empty', text: 'Nothing on this list yet.' })
      : el('ul', { class: 'wish-rows' }, ...[...wanted, ...purchased].map((item) => wishRow(item, owner, state, false))),
    list.settlements.length === 0
      ? null
      : el(
          'ul',
          { class: 'settlements ui' },
          ...list.settlements.map((entry) =>
            el('li', { text: `${entry.date}: paid ${money(entry.amountEur)}${entry.note ? ` (${entry.note})` : ''}` }),
          ),
        ),
  );
}

function combinedView(state: WishlistViewState): HTMLElement {
  const rank = { high: 0, normal: 1, low: 2 };
  const wanted = Object.entries(state.lists).flatMap(([owner, list]) =>
    list.items.filter((item) => item.status !== 'bought').map((item) => ({ owner, list, item })),
  );

  wanted.sort(
    (a, b) =>
      rank[a.item.priority] - rank[b.item.priority] ||
      `${a.item.setId}${a.item.number}`.localeCompare(`${b.item.setId}${b.item.number}`),
  );

  if (wanted.length === 0) {
    return el('p', { class: 'empty', text: 'Nothing on anyone’s list yet.' });
  }

  return el(
    'ul',
    { class: 'wish-rows' },
    ...wanted.map(({ owner, item }) => wishRow(item, state.lists[owner].owner, state, true)),
  );
}

export function renderWishlists(state: WishlistViewState): DocumentFragment {
  const owners = Object.keys(state.lists);
  // With one list there is nothing to combine, so the toggle would only be noise.
  const showToggle = owners.length > 1;

  return frag(
    showToggle
      ? el(
          'div',
          { class: 'chips' },
          el('button', {
            type: 'button',
            class: state.combined ? 'chip on' : 'chip',
            text: 'One shopping list',
            onClick: state.onToggleCombined,
          }),
          el('button', {
            type: 'button',
            class: state.combined ? 'chip' : 'chip on',
            text: 'By person',
            onClick: state.onToggleCombined,
          }),
        )
      : null,
    state.combined && showToggle
      ? combinedView(state)
      : frag(...owners.map((owner) => listBlock(owner, state.lists[owner], state))),
  );
}
