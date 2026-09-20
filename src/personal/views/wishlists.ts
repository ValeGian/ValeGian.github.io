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
import { money, parseAmount, quote, basisLabel } from '../lib/money.ts';
import { displayName, subtitle, fullImage, priceKey, type NameTable } from '../lib/data.ts';
import { cardThumb } from './thumb.ts';
import { chartIcon } from './icons.ts';
import { artworkPanel } from './artwork.ts';
import { armedButton } from './armed-button.ts';
import { marketRow } from './market.ts';
import type { Price, PriceSnapshot, Wishlist, WishlistItem } from '../lib/types.ts';

/**
 * A purchase being entered, before it is committed.
 *
 * The amount stays a string until it is confirmed, for the reason every other field here
 * does: a number input that reformats while you are typing puts the caret somewhere else,
 * and "1200" becomes "1002".
 */
export interface BuyEdit {
  owner: string;
  itemId: string;
  amount: string;
  currency: 'JPY' | 'EUR';
}

export interface WishlistEdit {
  owner: string;
  itemId: string;
  target: string;
  priority: WishlistItem['priority'];
  notes: string;
}

/** 'all' is a filter value, not a priority a card can have. */
export type PriorityFilter = 'all' | WishlistItem['priority'];
export type WishSort = 'priority' | 'set' | 'target' | 'market';

export const PRIORITY_RANK: Record<WishlistItem['priority'], number> = { high: 0, normal: 1, low: 2 };

export interface WishlistViewState {
  lists: Record<string, Wishlist>;
  prices: PriceSnapshot | null;
  names: NameTable;
  combined: boolean;
  view: 'list' | 'grid';
  priority: PriorityFilter;
  sort: WishSort;
  onPriority?(priority: PriorityFilter): void;
  onSort?(sort: WishSort): void;
  canEdit: boolean;
  /** The row currently open for editing, if any. */
  editing: WishlistEdit | null;
  /** The row currently asking what a card cost, if any. */
  buying?: BuyEdit | null;
  onToggleCombined(): void;
  onView?(view: 'list' | 'grid'): void;
  onStartBuy?(edit: BuyEdit): void;
  onBuyField?(change: Partial<BuyEdit>): void;
  onCancelBuy?(): void;
  onConfirmBuy?(): Promise<void>;
  onStartEdit?(edit: WishlistEdit): void;
  onEditField?(change: Partial<WishlistEdit>): void;
  onCancelEdit?(): void;
  onSaveEdit?(): Promise<void>;
  onDeleteWish?(owner: string, itemId: string): Promise<void>;
  /** The card whose detail panel is open, by card id. */
  openCardId?: string | null;
  onOpenCard?(cardId: string | null): void;
  /** Built by the caller for whichever card is open. */
  chartFor?(cardId: string): HTMLElement | null;
  chartOpen?: boolean;
  onToggleChart?(): void;
}

/** Opens the card behind a row, by the key its price is stored under. */
const openThis = (item: WishlistItem, onOpenCard?: WishlistViewState['onOpenCard']): void => {
  const key = priceKey(item);
  if (key) onOpenCard?.(key);
};

const priceFor = (item: WishlistItem, prices: PriceSnapshot | null): Price | undefined => {
  const key = priceKey(item);
  return key ? prices?.prices[key] : undefined;
};

/**
 * How much this one matters, on the row itself.
 *
 * Shown for every card rather than only the urgent ones. A list of thirty cards is read
 * by scanning it, and "no tag" is not something you can scan for — it reads as a card
 * whose priority nobody set. Normal is deliberately the quietest of the three, so the
 * ones that are not normal are what the eye lands on.
 */
const priorityTag = (item: WishlistItem): HTMLElement =>
  el('span', { class: `flag priority-${item.priority}`, text: item.priority });

/** Filter by priority, then order. Shared by every view so they cannot disagree. */
function arrange(items: WishlistItem[], state: WishlistViewState): WishlistItem[] {
  const kept = state.priority === 'all' ? items : items.filter((item) => item.priority === state.priority);
  const setKey = (item: WishlistItem) => `${item.setId ?? ''}${(item.number ?? '').padStart(4, '0')}`;

  const by: Record<WishSort, (a: WishlistItem, b: WishlistItem) => number> = {
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || setKey(a).localeCompare(setKey(b)),
    set: (a, b) => setKey(a).localeCompare(setKey(b)),
    // A card with no target is "at any price", which is the loosest, so it sorts last.
    target: (a, b) => (a.targetPriceEur ?? Infinity) - (b.targetPriceEur ?? Infinity),
    market: (a, b) =>
      (quote(priceFor(b, state.prices))?.value ?? -Infinity) - (quote(priceFor(a, state.prices))?.value ?? -Infinity),
  };

  return [...kept].sort(by[state.sort]);
}

/** Balance is computed from the purchases behind it, never stored, so it cannot drift. */
export function balance(list: Wishlist): { bought: number; settled: number; owed: number } {
  const bought = list.items
    .filter((item) => item.status === 'bought')
    .reduce((sum, item) => sum + (item.purchase?.amountEur ?? 0), 0);
  const settled = list.settlements.reduce((sum, entry) => sum + entry.amountEur, 0);
  return { bought, settled, owed: bought - settled };
}

/**
 * Everyone who wants this card, and what each of them would pay.
 *
 * The combined shopping view shows one row per person, so opening a card is the only
 * place the whole picture appears at once — useful when two people want it at different
 * prices and only one of them is worth buying today.
 */
function wishDetail(key: string, state: WishlistViewState): HTMLElement | null {
  // Keyed on `priceKey`, not on `cardId`: most of the 30th Anniversary list is still
  // waiting on TCGdex to publish the set, and those items carry a set and a number but
  // no catalog id. Keying on the id left two thirds of the wishlist unopenable, while
  // their prices — stored under that same set-and-number key — were on the row already.
  const wanters = Object.entries(state.lists).flatMap(([owner, list]) =>
    list.items.filter((item) => priceKey(item) === key).map((item) => ({ owner, list, item })),
  );
  if (wanters.length === 0) return null;

  const sample = wanters[0].item;
  const price = state.prices?.prices[key];
  const reading = quote(price);
  const image = fullImage(sample);
  const measure = basisLabel(reading);

  const row = (list: Wishlist, item: WishlistItem) => {
    const bought = item.status === 'bought';
    const under = reading && item.targetPriceEur !== null && reading.value <= item.targetPriceEur;
    return el(
      'div',
      { class: 'wanter' },
      el('span', { class: 'wanter-name', text: list.owner }),
      el('span', {
        class: 'numeric',
        text: item.targetPriceEur === null ? 'any price' : `target ${money(item.targetPriceEur)}`,
      }),
      bought
        ? el('span', { class: 'bought-badge ui', text: `bought ${item.purchase ? money(item.purchase.amountEur) : ''}`.trim() })
        : reading
          ? el('span', { class: under ? 'target under' : 'target over', text: under ? 'at or under target' : 'over target' })
          : el('span', { class: 'muted ui', text: 'no price yet' }),
      item.notes ? el('span', { class: 'wanter-note', text: item.notes }) : null,
    );
  };

  return el(
    'div',
    { class: state.chartOpen ? 'detail chart-open' : 'detail' },
    el(
      'div',
      { class: 'detail-actions' },
      state.onToggleChart
        ? el('button', {
            type: 'button',
            class: state.chartOpen ? 'chip chart-toggle on' : 'chip chart-toggle',
            'aria-pressed': String(Boolean(state.chartOpen)),
            'aria-label': state.chartOpen ? 'Hide the price history' : 'Show the price history',
            title: 'Price history',
            onClick: () => state.onToggleChart?.(),
          }, chartIcon())
        : null,
      el('button', { type: 'button', class: 'detail-close', text: 'Close', onClick: () => state.onOpenCard?.(null) }),
    ),
    el(
      'div',
      { class: 'detail-body' },
      artworkPanel({
        source: image,
        alt: displayName(sample, state.names),
        emptyText: 'No artwork in the catalog yet',
      }),
      el(
        'div',
        {},
        el('h3', { text: displayName(sample, state.names) }),
        sample.nameJa ? el('p', { class: 'detail-ja', text: sample.nameJa }) : null,
        el(
          'dl',
          { class: 'detail-lines' },
          el('div', { class: 'detail-line' }, el('dt', { text: 'Set' }), el('dd', { text: subtitle(sample) || '—' })),
          el(
            'div',
            { class: 'detail-line' },
            el('dt', { text: 'Market' }),
            el(
              'dd',
              {},
              reading ? money(reading.value) : 'No price yet',
              price
                ? el('span', { class: 'detail-note', text: `Cardmarket ${measure}` })
                : null,
            ),
          ),
        ),
        el('p', { class: 'wanters-heading ui', text: wanters.length === 1 ? 'Wanted by' : `Wanted by ${wanters.length} people` }),
        el('div', { class: 'wanters' }, ...wanters.map(({ list, item }) => row(list, item))),
        // Both market sites, for checking the asking price against the list's target.
        marketRow(sample),
      ),
      el('div', { class: 'detail-chart' }, state.chartFor?.(key) ?? frag()),
    ),
  );
}

function targetMarker(item: WishlistItem, price: Price | undefined): HTMLElement | null {
  const market = quote(price)?.value ?? null;
  if (market === null || item.targetPriceEur === null) return null;
  const under = market <= item.targetPriceEur;
  return el('span', {
    class: under ? 'target under' : 'target over',
    text: under ? 'at or under target' : 'over target',
  });
}

/**
 * What a card cost, asked for in the page rather than by the browser.
 *
 * This used to be `prompt()`, which is one line of code and wrong in three ways: it
 * cannot be styled, it freezes the tab until it is answered, and on a phone it is a
 * cramped grey box with no currency control, so the currency had to be guessed from
 * whatever was typed. Here the amount and the currency are two fields, and the currency
 * is a choice rather than a guess.
 */
function buyRow(item: WishlistItem, state: WishlistViewState): HTMLElement {
  const buying = state.buying;
  if (!buying) return el('li');

  const set = (change: Partial<BuyEdit>) => state.onBuyField?.(change);

  /**
   * The note and the button are updated in place, not by rebuilding.
   *
   * Reporting a keystroke to the store on purpose does not repaint — rebuilding replaces
   * the element the caret is in, which is how a price of 1200 became 1002. So the two
   * things that have to answer every keystroke are held here and written to directly.
   */
  const note = el('p', { class: 'detail-note' });
  const confirm = el('button', { type: 'submit', text: 'Confirm' });

  const reflect = (typed: string, currency: BuyEdit['currency']) => {
    const amount = parseAmount(typed);
    confirm.disabled = amount === null;
    note.textContent =
      amount === null
        ? 'Enter what you paid, in whichever currency you paid it.'
        : `Recording ${amount.toLocaleString('en-GB')} ${currency}, converted at today's rate.`;
  };

  const amountField = el('input', {
    id: 'buy-amount',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '1200',
    value: buying.amount,
    onInput: (event: Event) => {
      const typed = (event.target as HTMLInputElement).value;
      set({ amount: typed });
      reflect(typed, currencyField.value as BuyEdit['currency']);
    },
  });

  const currencyField = el(
    'select',
    {
      id: 'buy-currency',
      onChange: (event: Event) => {
        const currency = (event.target as HTMLSelectElement).value as BuyEdit['currency'];
        set({ currency });
        reflect(amountField.value, currency);
      },
    },
    el('option', { value: 'JPY', text: 'JPY ¥', selected: buying.currency === 'JPY' }),
    el('option', { value: 'EUR', text: 'EUR €', selected: buying.currency === 'EUR' }),
  );

  reflect(buying.amount, buying.currency);

  return el(
    'li',
    { class: 'wish-row editing' },
    el(
      'form',
      {
        class: 'wish-edit',
        onSubmit: (event: Event) => {
          event.preventDefault();
          void state.onConfirmBuy?.();
        },
      },
      el('p', { class: 'wish-edit-title', text: `Bought ${displayName(item, state.names)}` }),
      el(
        'div',
        { class: 'grid-fields' },
        el(
          'label',
          { class: 'field', for: 'buy-amount' },
          el('span', { text: 'What it cost' }),
          amountField,
        ),
        el('label', { class: 'field', for: 'buy-currency' }, el('span', { text: 'Currency' }), currencyField),
      ),
      // Says what will be recorded before it is recorded, and why the button is off.
      note,
      el(
        'div',
        { class: 'form-actions' },
        confirm,
        el('button', { type: 'button', class: 'chip', text: 'Cancel', onClick: () => state.onCancelBuy?.() }),
      ),
    ),
  );
}

/**
 * The row in edit mode.
 *
 * Fields report their value without rebuilding the view: rebuilding replaces the element
 * the caret is in, and on a number input the caret cannot be put back, so digits arrive
 * in the wrong order. That is what turned a target of 30 into 3, then into 2.
 */
function editRow(item: WishlistItem, state: WishlistViewState): HTMLElement {
  const edit = state.editing;
  if (!edit) return el('li');

  const set = (change: Partial<WishlistEdit>) => state.onEditField?.(change);

  return el(
    'li',
    { class: 'wish-row editing' },
    el(
      'form',
      {
        class: 'wish-edit',
        onSubmit: (event: Event) => {
          event.preventDefault();
          void state.onSaveEdit?.();
        },
      },
      el('p', { class: 'wish-edit-title', text: item.nameEn ?? item.nameJa ?? item.cardId ?? 'this card' }),
      el(
        'div',
        { class: 'grid-fields' },
        el(
          'label',
          { class: 'field', for: 'edit-target' },
          el('span', { text: 'Target price (€)' }),
          el('input', {
            id: 'edit-target',
            type: 'number',
            min: '0',
            step: '0.01',
            inputmode: 'decimal',
            placeholder: 'any price',
            value: edit.target,
            onInput: (event: Event) => set({ target: (event.target as HTMLInputElement).value }),
          }),
        ),
        el(
          'label',
          { class: 'field', for: 'edit-priority' },
          el('span', { text: 'Priority' }),
          el(
            'select',
            {
              id: 'edit-priority',
              onChange: (event: Event) =>
                set({ priority: (event.target as HTMLSelectElement).value as WishlistItem['priority'] }),
            },
            ...(['high', 'normal', 'low'] as const).map((level) =>
              el('option', { value: level, text: level, selected: edit.priority === level }),
            ),
          ),
        ),
      ),
      el(
        'label',
        { class: 'field', for: 'edit-notes' },
        el('span', { text: 'Notes' }),
        el('input', {
          id: 'edit-notes',
          type: 'text',
          value: edit.notes,
          onInput: (event: Event) => set({ notes: (event.target as HTMLInputElement).value }),
        }),
      ),
      el(
        'div',
        { class: 'form-actions' },
        el('button', { type: 'submit', text: 'Save' }),
        el('button', { type: 'button', class: 'chip', text: 'Cancel', onClick: () => state.onCancelEdit?.() }),
        removeButton(item, edit.owner, state),
      ),
    ),
  );
}

function wishRow(
  item: WishlistItem,
  owner: string,
  state: WishlistViewState,
  showOwner: boolean,
): HTMLElement {
  if (state.editing?.owner === owner && state.editing.itemId === item.id) {
    return editRow(item, state);
  }

  if (state.buying?.owner === owner && state.buying.itemId === item.id) {
    return buyRow(item, state);
  }

  const price = priceFor(item, state.prices);
  const market = quote(price)?.value ?? null;
  const bought = item.status === 'bought';

  return el(
    'li',
    { class: bought ? 'wish-row bought' : 'wish-row' },
    // Eager: a wishlist is short, and these rows appear on a tab switch, where the lazy
    // loader does not reliably fire for freshly inserted elements.
    cardThumb(item, { width: 40, height: 56 }, 'eager'),
    el(
      'button',
      {
        type: 'button',
        class: 'card-name wish-open',
        disabled: !priceKey(item) || !state.onOpenCard,
        onClick: () => openThis(item, state.onOpenCard),
      },
      el('span', { class: 'card-title', text: displayName(item, state.names) }),
      el(
        'span',
        { class: 'card-meta ui' },
        subtitle(item),
        showOwner ? el('span', { class: 'owner', text: state.lists[owner]?.owner ?? owner }) : null,
        bought ? null : priorityTag(item),
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
    wishActions(item, owner, state),
  );
}

/**
 * Removing a card, in two taps rather than behind a dialog.
 *
 * A card removed by accident has to be searched for and added again, with its target and
 * its notes retyped, so the second tap is worth the moment it costs.
 */
function removeButton(item: WishlistItem, owner: string, state: WishlistViewState): HTMLElement | null {
  if (!state.onDeleteWish) return null;

  return armedButton({
    label: 'Remove',
    armedLabel: 'Remove?',
    className: 'chip danger',
    title: `Remove ${displayName(item, state.names)} from this list`,
    onConfirm: () => void state.onDeleteWish?.(owner, item.id),
  });
}

/**
 * Marking a card bought, and changing what you would pay for it.
 *
 * Shared by the row and the tile. They had drifted: the grid showed the picture, the
 * target and the market price — everything needed to decide — and then offered no way to
 * act on the decision, so buying a card meant switching back to the list first.
 *
 * Never inside the button that opens the card: a button inside a button is not valid,
 * and the browser's idea of which one was clicked is its own business.
 */
function wishActions(item: WishlistItem, owner: string, state: WishlistViewState): HTMLElement | null {
  if (item.status === 'bought' || !state.canEdit) return null;

  return el(
    'span',
    { class: 'wish-actions' },
    state.onStartBuy
      ? el('button', {
          type: 'button',
          class: 'mark-bought',
          text: 'Bought',
          // Yen by default: these are bought in Japan, and a shop is where this is used.
          onClick: () => state.onStartBuy?.({ owner, itemId: item.id, amount: '', currency: 'JPY' }),
        })
      : null,
    state.onStartEdit
      ? el('button', {
          type: 'button',
          class: 'chip',
          text: 'Edit',
          onClick: () =>
            state.onStartEdit?.({
              owner,
              itemId: item.id,
              target: item.targetPriceEur === null ? '' : String(item.targetPriceEur),
              priority: item.priority,
              notes: item.notes ?? '',
            }),
        })
      : null,
    removeButton(item, owner, state),
  );
}

/**
 * A wanted card as a picture.
 *
 * Grid is the faster read when walking a shop: the art is what matches the card in the
 * rack. The target and the market price stay on the tile, because the decision is
 * whether this one is worth buying, not merely whether it is the right card.
 */
function gridTile(item: WishlistItem, owner: string, state: WishlistViewState, showOwner: boolean): HTMLElement {
  if (state.editing?.owner === owner && state.editing.itemId === item.id) {
    return editRow(item, state);
  }

  if (state.buying?.owner === owner && state.buying.itemId === item.id) {
    return buyRow(item, state);
  }

  const market = quote(priceFor(item, state.prices))?.value ?? null;
  const bought = item.status === 'bought';
  const under = market !== null && item.targetPriceEur !== null && market <= item.targetPriceEur;

  return el(
    'li',
    { class: bought ? 'tile bought' : 'tile' },
    el(
      'button',
      {
        type: 'button',
        class: 'tile-open',
        disabled: !priceKey(item) || !state.onOpenCard,
        onClick: () => openThis(item, state.onOpenCard),
      },
      cardThumb(item, { width: 160, height: 224 }, 'lazy'),
      el('span', { class: 'tile-name', text: displayName(item, state.names) }),
      el(
        'span',
        { class: 'tile-figures ui' },
        el('span', {
          class: 'target-price numeric',
          text: item.targetPriceEur === null ? 'any price' : money(item.targetPriceEur),
        }),
        el('span', { class: 'numeric', text: market === null ? '—' : money(market) }),
      ),
      el(
        'span',
        { class: 'tile-figures ui' },
        showOwner ? el('span', { class: 'owner', text: state.lists[owner]?.owner ?? owner }) : null,
        bought ? null : priorityTag(item),
        bought
          ? el('span', { class: 'bought-badge ui', text: 'bought' })
          : market === null
            ? null
            : el('span', { class: under ? 'target under' : 'target over', text: under ? 'under target' : 'over target' }),
      ),
    ),
    wishActions(item, owner, state),
  );
}

function rows(items: WishlistItem[], owner: string, state: WishlistViewState, showOwner: boolean): HTMLElement {
  return state.view === 'grid'
    ? el('ul', { class: 'card-grid' }, ...items.map((item) => gridTile(item, owner, state, showOwner)))
    : el('ul', { class: 'wish-rows' }, ...items.map((item) => wishRow(item, owner, state, showOwner)));
}

function listBlock(owner: string, list: Wishlist, state: WishlistViewState): HTMLElement {
  const wanted = arrange(list.items.filter((item) => item.status !== 'bought'), state);
  // Bought cards keep their own order and sit at the end: the list is for shopping, and
  // these are the part of it that is finished.
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
      : wanted.length + purchased.length === 0
        ? el('p', { class: 'empty', text: `Nothing on this list at ${state.priority} priority.` })
        : rows([...wanted, ...purchased], owner, state, false),
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
  // Arranged as one list, then matched back to owners: the same card wanted by two people
  // has to stay next to itself, which sorting each list separately would not do.
  const owners = new Map<WishlistItem, string>();
  for (const [owner, list] of Object.entries(state.lists)) {
    for (const item of list.items) if (item.status !== 'bought') owners.set(item, owner);
  }

  const wanted = arrange([...owners.keys()], state).map((item) => ({ item, owner: owners.get(item) as string }));

  if (wanted.length === 0) {
    return el('p', {
      class: 'empty',
      text:
        state.priority === 'all'
          ? 'Nothing on anyone’s list yet.'
          : `Nothing on anyone’s list at ${state.priority} priority.`,
    });
  }

  return state.view === 'grid'
    ? el('ul', { class: 'card-grid' }, ...wanted.map(({ owner, item }) => gridTile(item, owner, state, true)))
    : el('ul', { class: 'wish-rows' }, ...wanted.map(({ owner, item }) => wishRow(item, owner, state, true)));
}

/**
 * Which cards to show and in what order.
 *
 * Two rows rather than one: filtering and ordering answer different questions, and thirty
 * cards from one set makes both worth having. They are labelled, unlike the view toggle
 * above, because "High" and "Target" say nothing on their own about what they do.
 */
function priorityControls(state: WishlistViewState): DocumentFragment {
  if (!state.onPriority && !state.onSort) return frag();

  const group = (
    label: string,
    options: readonly (readonly [string, string])[],
    current: string,
    choose: (value: string) => void,
  ): HTMLElement =>
    el(
      'div',
      { class: 'chips filter-row' },
      el('span', { class: 'chips-label ui', text: label }),
      ...options.map(([value, text]) =>
        el('button', {
          type: 'button',
          'aria-pressed': String(current === value),
          class: current === value ? 'chip on' : 'chip',
          text,
          onClick: () => choose(value),
        }),
      ),
    );

  return frag(
    state.onPriority
      ? group(
          'Priority',
          [
            ['all', 'All'],
            ['high', 'High'],
            ['normal', 'Normal'],
            ['low', 'Low'],
          ],
          state.priority,
          (value) => state.onPriority?.(value as PriorityFilter),
        )
      : null,
    state.onSort
      ? group(
          'Sort',
          [
            ['priority', 'Priority'],
            ['set', 'Set'],
            ['target', 'Target'],
            ['market', 'Value'],
          ],
          state.sort,
          (value) => state.onSort?.(value as WishSort),
        )
      : null,
  );
}

export function renderWishlists(state: WishlistViewState): DocumentFragment {
  const owners = Object.keys(state.lists);
  // With one list there is nothing to combine, so the toggle would only be noise.
  const showToggle = owners.length > 1;

  const detail = state.openCardId ? wishDetail(state.openCardId, state) : null;

  return frag(
    detail,
    el(
      'div',
      { class: 'chips' },
      ...(showToggle
        ? [
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
          ]
        : []),
      state.onView
        ? el(
            'span',
            { class: 'view-toggle' },
            ...([
              ['list', 'List'],
              ['grid', 'Grid'],
            ] as const).map(([view, label]) =>
              el('button', {
                type: 'button',
                'aria-pressed': String(state.view === view),
                class: state.view === view ? 'chip on' : 'chip',
                text: label,
                onClick: () => state.onView?.(view),
              }),
            ),
          )
        : null,
    ),
    priorityControls(state),
    state.combined && showToggle
      ? combinedView(state)
      : frag(...owners.map((owner) => listBlock(owner, state.lists[owner], state))),
  );
}
