/**
 * The personal area.
 *
 * Mounts after unlocking and rebuilds itself whenever state changes. Nothing is cached
 * in a readable form, so closing the tab locks it; only ciphertext and already-public
 * JSON are ever written to the device.
 */
import { el, frag, need, rebuildPreservingFocus } from './lib/dom.ts';
import { createStore } from './lib/store.ts';
import { emptyFilters, type Filters, type SortKey } from './lib/filters.ts';
import { value, type Valued } from './lib/money.ts';
import { loadPublicData, stalenessDays, type PublicData } from './lib/data.ts';
import { renderCollection } from './views/collection.ts';
import { renderDetail, type CardEdit } from './views/detail.ts';
import { renderWishlists, type WishlistEdit } from './views/wishlists.ts';
import { blankFields, renderAddCard, searchCards, type AddCardState, type AddMode } from './views/add-card.ts';
import { renderPublishBar } from './views/publish-bar.ts';
import { addCard, addWishToMany, applyResolutions, deleteCard, deleteWish, markBought, newCardId, updateCard, updateWish, type Envelope, type Resolution, type Vault } from './lib/vault.ts';
import { savePending } from './lib/local.ts';
import { discardPending, forgetToken, getToken, listPending, publish, rememberToken } from './lib/sync.ts';
import { unlock } from '../lib/unlock.mjs';
import { decryptWithKey } from '../lib/crypto.mjs';
import type { Collection, CollectionItem, Wishlist, WishlistItem } from './lib/types.ts';

type Friend = { role: 'friend'; owner: string; wishlist: Wishlist };

interface AppState {
  phase: 'locked' | 'checking' | 'open';
  message: string;
  vault: Vault | null;
  friend: Friend | null;
  data: PublicData | null;
  tab: 'collection' | 'wishlists';
  filters: Filters;
  sortKey: SortKey;
  sortDescending: boolean;
  combined: boolean;
  openItemId: string | null;
  adding: boolean;
  add: Omit<
    AddCardState,
    'names' | 'lists' | 'onChange' | 'onField' | 'latest' | 'onSearch' | 'onSave' | 'onSaveWish' | 'onCancel' | 'nextId'
  >;
  pendingCount: number;
  hasToken: boolean;
  publishBusy: boolean;
  publishMessage: string;
  lastCommitUrl: string | null;
  askingForToken: boolean;
  editingWish: WishlistEdit | null;
  editingCard: CardEdit | null;
  openWishCardId: string | null;
  /** Bumped to force a rebuild when the change was to the vault, not to this object. */
  tick: number;
}

/** Older than this and the figures are stale enough that showing them silently is wrong. */
const STALE_AFTER_DAYS = 2;

const blankAdd = (mode: AddMode = 'collection'): AppState['add'] => ({
  ...blankFields(),
  mode,
  results: [],
  searching: false,
  picked: null,
  manual: false,
  photo: null,
  error: '',
  saving: false,
});

/** Long enough not to search on every keystroke, short enough to feel immediate. */
const SEARCH_DELAY_MS = 300;

/** Gives a burst of edits time to settle into one commit rather than one commit each. */
const PUBLISH_DELAY_MS = 2500;

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let publishTimer: ReturnType<typeof setTimeout> | undefined;

const store = createStore<AppState>({
  phase: 'locked',
  message: '',
  vault: null,
  friend: null,
  data: null,
  tab: 'collection',
  filters: { ...emptyFilters },
  sortKey: 'value',
  sortDescending: true,
  combined: true,
  openItemId: null,
  adding: false,
  add: blankAdd(),
  pendingCount: 0,
  hasToken: false,
  publishBusy: false,
  publishMessage: '',
  lastCommitUrl: null,
  askingForToken: false,
  editingWish: null,
  editingCard: null,
  openWishCardId: null,
  tick: 0,
});

const emptyNames = { species: {} };

async function refreshPendingCount(): Promise<number> {
  try {
    const writes = await listPending();
    store.update({ pendingCount: writes.length });
    return writes.length;
  } catch {
    return 0;
  }
}

/**
 * Builds the vault, preferring any unpublished copy kept on this device.
 *
 * A queued file is newer than what GitHub is serving by definition — it has not been
 * published yet — so it wins. Publishing from another device while changes are queued
 * here would be a genuine conflict, which the count and the banner put in front of a
 * human rather than resolving silently.
 */
async function buildVault(
  files: Record<string, unknown>,
  keys: Map<string, CryptoKey>,
  envelopes: Map<string, Envelope>,
  data: PublicData,
): Promise<Vault> {
  const queued = new Map((await listPending()).map((write) => [write.path, write.content]));

  for (const [name, key] of keys) {
    const local = queued.get(`public/data/personal/${name}.enc`);
    if (!local) continue;
    const envelope = JSON.parse(local) as Envelope;
    const opened = await decryptWithKey(key, envelope);
    if (opened) {
      files[name] = opened;
      envelopes.set(name, envelope);
    }
  }

  const { collection, ...wishlists } = files as Record<string, unknown>;

  return {
    collection: collection as Collection,
    wishlists: wishlists as Record<string, Wishlist>,
    keys,
    envelopes,
    manualCardIds: [...data.overrides.keys()],
  };
}

/**
 * Fills in cards the catalog has published since they were added.
 *
 * The daily job cannot write to the collection — it holds no key — so it publishes what
 * it found and this applies it on the next visit. Nothing has to be triggered by hand.
 */
async function catchUpOnResolutions(vault: Vault): Promise<void> {
  try {
    const response = await fetch('/data/resolutions.json', { cache: 'no-cache' });
    if (!response.ok) return;

    const { resolved } = (await response.json()) as { resolved?: Resolution[] };
    if (!resolved?.length) return;

    const writes = await applyResolutions(vault, resolved);
    if (!writes) return;

    await savePending(writes);
    store.update({ publishMessage: 'Cards that were awaiting the catalog have been filled in.' });
    schedulePublish();
  } catch {
    // A missing or unreadable file just means nothing to catch up on.
  }
}

function valuedRows(state: AppState): Valued[] {
  if (!state.vault) return [];
  return state.vault.collection.items.map((item) => value(item, state.data?.prices ?? null));
}

function stalenessBanner(state: AppState): HTMLElement | null {
  const days = stalenessDays(state.data?.prices ?? null);
  if (days === null) return el('p', { class: 'banner', text: 'No price data has been published yet.' });
  if (days < STALE_AFTER_DAYS) return null;
  return el('p', {
    class: 'banner',
    text: `Prices are ${days} days old. The daily job may have stopped — check the repository's issues.`,
  });
}

function lockScreen(state: AppState): DocumentFragment {
  const form = el(
    'form',
    {
      class: 'unlock',
      onSubmit: async (event: Event) => {
        event.preventDefault();
        const field = need<HTMLInputElement>('#password', form);
        const password = field.value;
        field.value = '';
        store.update({ phase: 'checking', message: 'Checking…' });

        try {
          const opened = (await unlock(password)) as
            | { role: 'admin'; files: Record<string, unknown>; keys: Map<string, CryptoKey>; envelopes: Map<string, Envelope> }
            | { role: 'friend'; owner: string; list: Wishlist }
            | null;

          if (!opened) {
            // Says nothing about which file was tried or how close the guess was.
            store.update({ phase: 'locked', message: 'That password does not open anything here.' });
            return;
          }

          const data = await loadPublicData();

          if (opened.role === 'friend') {
            store.update({
              phase: 'open',
              message: '',
              data,
              friend: { role: 'friend', owner: opened.owner, wishlist: opened.list },
            });
            return;
          }

          const vault = await buildVault(opened.files, opened.keys, opened.envelopes, data);
          store.update({ phase: 'open', message: '', data, vault, hasToken: Boolean(getToken()) });
          await catchUpOnResolutions(vault);
          await refreshPendingCount();
        } catch (error) {
          store.update({
            phase: 'locked',
            message: `Could not read the vault: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
    },
    el('label', { for: 'password', text: 'Password' }),
    el('input', {
      id: 'password',
      name: 'password',
      type: 'password',
      autocomplete: 'current-password',
      required: true,
      disabled: state.phase === 'checking',
    }),
    el('button', {
      type: 'submit',
      text: state.phase === 'checking' ? 'Checking…' : 'Unlock',
      disabled: state.phase === 'checking',
    }),
  );

  return frag(
    el('p', { class: 'intro', text: 'Enter your password to open your list.' }),
    form,
    el('p', { class: 'status ui', role: 'status', 'aria-live': 'polite', text: state.message }),
  );
}

/** Nudges a rebuild when something changed outside the store, such as the vault. */
const rerender = (): void => store.update((current) => ({ tick: current.tick + 1 }) as Partial<AppState>);

/**
 * Searches the catalog as the person types.
 *
 * Debounced, because every keystroke would otherwise be a request, and the last one wins
 * so a slow earlier reply cannot overwrite a newer result.
 */
let searchGeneration = 0;

function runCatalogSearch(query: string): void {
  store.update((current) => ({ add: { ...current.add, query } }));
  clearTimeout(searchTimer);

  if (query.trim().length < 2) {
    store.update((current) => ({ add: { ...current.add, results: [], searching: false } }));
    return;
  }

  const generation = ++searchGeneration;
  store.update((current) => ({ add: { ...current.add, searching: true } }));

  searchTimer = setTimeout(async () => {
    const names = store.get().data?.names ?? emptyNames;
    try {
      const results = await searchCards(query, names);
      if (generation !== searchGeneration) return;
      store.update((current) => ({ add: { ...current.add, results, searching: false } }));
    } catch (error) {
      if (generation !== searchGeneration) return;
      store.update((current) => ({
        add: { ...current.add, searching: false, error: error instanceof Error ? error.message : String(error) },
      }));
    }
  }, SEARCH_DELAY_MS);
}

/**
 * Publishes on its own a moment after the last change.
 *
 * Adding a card should not need a second deliberate action. A burst of edits settles
 * into one commit, and anything that fails stays queued with the count on screen, so a
 * shop with no signal costs nothing and needs no decision.
 */
function schedulePublish(): void {
  clearTimeout(publishTimer);
  if (!getToken()) return;

  publishTimer = setTimeout(async () => {
    if (store.get().publishBusy) return;
    store.update({ publishBusy: true, publishMessage: '' });
    const result = await publish('chore(personal): update from the browser');
    await refreshPendingCount();
    store.update({
      publishBusy: false,
      lastCommitUrl: result.url ?? null,
      publishMessage: result.ok ? '' : (result.reason ?? 'Publishing failed; the changes are still here.'),
    });
  }, PUBLISH_DELAY_MS);
}

async function saveCard(item: CollectionItem, photo?: { base64: string } | null): Promise<void> {
  const { vault } = store.get();
  if (!vault) return;
  await savePending(await addCard(vault, item, photo));
  await refreshPendingCount();
  store.update({ adding: false, add: blankAdd() });
  schedulePublish();
}

async function saveWish(owners: string[], item: Omit<WishlistItem, 'id'>): Promise<void> {
  const { vault } = store.get();
  if (!vault) return;
  await savePending(await addWishToMany(vault, owners, item));
  await refreshPendingCount();
  store.update({ adding: false, add: blankAdd('wishlist') });
  schedulePublish();
}

/**
 * Applies an edit to an owned card.
 *
 * The exchange rate is only re-fetched when the money actually changed. A card bought at
 * a rate that was recorded at the time keeps it — recomputing from today would restate
 * what was paid, which is the one thing a ledger must not do.
 */
async function saveCardEdit(): Promise<void> {
  const { vault, editingCard } = store.get();
  if (!vault || !editingCard) return;

  const item = vault.collection.items.find((candidate) => candidate.id === editingCard.itemId);
  if (!item) return;

  const amount = Number(editingCard.amount);
  const quantity = Number(editingCard.quantity);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(quantity) || quantity < 1) return;

  const moneyChanged =
    amount !== item.purchase.amount ||
    editingCard.currency !== item.purchase.currency ||
    editingCard.date !== item.purchase.date;

  let purchase = { ...item.purchase, amount, currency: editingCard.currency, date: editingCard.date };

  if (moneyChanged) {
    const { convert } = await import('./lib/fx.ts');
    const converted = await convert(amount, editingCard.currency, editingCard.date);
    purchase = {
      ...purchase,
      amountEur: converted.amountEur,
      fxRate: converted.fxRate,
      fxSource: editingCard.currency === 'EUR' ? 'identity' : 'frankfurter',
      // The import date no longer stands in once a real one has been given.
      dateIsBootstrap: editingCard.date === item.purchase.date ? item.purchase.dateIsBootstrap : false,
    };
  }

  await savePending(
    await updateCard(vault, editingCard.itemId, {
      condition: editingCard.condition,
      quantity,
      notes: editingCard.notes,
      purchase,
    }),
  );
  await refreshPendingCount();
  store.update({ editingCard: null });
  schedulePublish();
}

async function removeCard(itemId: string): Promise<void> {
  const { vault } = store.get();
  if (!vault) return;
  await savePending(await deleteCard(vault, itemId));
  await refreshPendingCount();
  store.update({ openItemId: null, editingCard: null });
  schedulePublish();
}

function publishBar(state: AppState): HTMLElement | null {
  return renderPublishBar({
    pendingCount: state.pendingCount,
    hasToken: state.hasToken,
    busy: state.publishBusy,
    message: state.publishMessage,
    lastCommitUrl: state.lastCommitUrl,
    askingForToken: state.askingForToken,
    onAskForToken: () => store.update({ askingForToken: true, publishMessage: '' }),
    onDiscard: async () => {
      await discardPending();
      await refreshPendingCount();
      // The screen still shows the discarded edits, so reload to read the published copy.
      location.reload();
    },
    onForgetToken: () => {
      forgetToken();
      store.update({ hasToken: false, publishMessage: 'Token removed from this device.' });
    },
    onSaveToken: async (token) => {
      store.update({ publishBusy: true, publishMessage: '' });
      const result = await rememberToken(token);
      store.update({
        publishBusy: false,
        hasToken: result.ok,
        askingForToken: !result.ok,
        publishMessage: result.ok ? '' : (result.reason ?? 'That token was not accepted.'),
      });
      if (result.ok) schedulePublish();
    },
    onPublish: async () => {
      store.update({ publishBusy: true, publishMessage: '' });
      const result = await publish(`chore(personal): update from the browser`);
      await refreshPendingCount();
      store.update({
        publishBusy: false,
        lastCommitUrl: result.url ?? null,
        // A failed publish leaves the queue alone, so the work is still here to retry.
        publishMessage: result.ok ? '' : (result.reason ?? 'Publishing failed.'),
      });
    },
  });
}

function adminView(state: AppState, vault: Vault): DocumentFragment {
  const rows = valuedRows(state);
  const open = state.openItemId ? rows.find((entry) => entry.item.id === state.openItemId) : undefined;
  const names = state.data?.names ?? emptyNames;

  const tabs = el(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...(['collection', 'wishlists'] as const).map((tab) =>
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(state.tab === tab),
        class: state.tab === tab ? 'tab on' : 'tab',
        text: tab === 'collection' ? 'Collection' : 'Wishlists',
        onClick: () => store.update({ tab, openItemId: null, adding: false, add: blankAdd(tab === 'collection' ? 'collection' : 'wishlist') }),
      }),
    ),
    el('button', {
      type: 'button',
      class: 'chip add-button',
      text: state.adding ? 'Close' : state.tab === 'collection' ? 'Add a card' : 'Add a wanted card',
      onClick: () =>
        store.update({
          adding: !state.adding,
          openItemId: null,
          add: blankAdd(state.tab === 'collection' ? 'collection' : 'wishlist'),
        }),
    }),
  );

  const body =
    state.tab === 'collection'
      ? renderCollection({
          rows,
          names,
          filters: state.filters,
          sortKey: state.sortKey,
          sortDescending: state.sortDescending,
          onFilters: (change) => store.update((current) => ({ filters: { ...current.filters, ...change } })),
          onSort: (key) =>
            store.update((current) => ({
              sortKey: key,
              sortDescending: current.sortKey === key ? !current.sortDescending : true,
            })),
          onOpen: (itemId) => store.update({ openItemId: itemId, adding: false, editingCard: null }),
        })
      : renderWishlists({
          lists: vault.wishlists,
          prices: state.data?.prices ?? null,
          names,
          combined: state.combined,
          canEdit: true,
          editing: state.editingWish,
          openCardId: state.openWishCardId,
          onOpenCard: (cardId) => store.update({ openWishCardId: cardId }),
          onToggleCombined: () => store.update((current) => ({ combined: !current.combined })),
          onStartEdit: (edit) => store.update({ editingWish: edit }),
          // Silent, for the same reason the add form's fields are: rebuilding replaces
          // the element the caret is in.
          onEditField: (change) =>
            store.set((current) => ({
              editingWish: current.editingWish ? { ...current.editingWish, ...change } : null,
            })),
          onCancelEdit: () => store.update({ editingWish: null }),
          onSaveEdit: async () => {
            const edit = store.get().editingWish;
            if (!edit) return;
            const target = edit.target.trim() === '' ? null : Number(edit.target);
            if (target !== null && (!Number.isFinite(target) || target <= 0)) return;
            await savePending(
              await updateWish(vault, edit.owner, edit.itemId, {
                targetPriceEur: target,
                priority: edit.priority,
                notes: edit.notes,
              }),
            );
            await refreshPendingCount();
            store.update({ editingWish: null });
            schedulePublish();
          },
          onDeleteWish: async (owner, itemId) => {
            await savePending(await deleteWish(vault, owner, itemId));
            await refreshPendingCount();
            store.update({ editingWish: null });
            schedulePublish();
          },
          onMarkBought: async (owner, itemId) => {
            const paid = prompt('What did it cost? Enter the amount, then the currency.', '');
            if (paid === null) return;
            const amount = Number(paid.replace(/[^0-9.]/g, ''));
            if (!Number.isFinite(amount) || amount <= 0) return;
            const currency = /eur|€/i.test(paid) ? 'EUR' : 'JPY';
            const date = new Date().toISOString().slice(0, 10);
            const { convert } = await import('./lib/fx');
            const money = await convert(amount, currency, date);
            const { writes } = await markBought(vault, owner, itemId, {
              date,
              amount,
              currency,
              amountEur: money.amountEur,
              fxRate: money.fxRate,
              fxSource: currency === 'EUR' ? 'identity' : 'frankfurter',
            });
            await savePending(writes);
            await refreshPendingCount();
            rerender();
            schedulePublish();
          },
        });

  return frag(
    tabs,
    state.adding
      ? renderAddCard({
          ...state.add,
          names,
          lists: Object.entries(vault.wishlists).map(([id, list]) => ({ id, label: list.owner })),
          nextId: () => newCardId(vault),
          onChange: (change) => store.update((current) => ({ add: { ...current.add, ...change } })),
          onField: (change) => store.set((current) => ({ add: { ...current.add, ...change } })),
          latest: () => store.get().add,
          onSearch: runCatalogSearch,
          onSave: saveCard,
          onSaveWish: saveWish,
          onCancel: () => store.update({ adding: false, add: blankAdd(state.add.mode) }),
        })
      : null,
    open
      ? renderDetail(
          open,
          names,
          state.data?.overrides ?? new Map(),
          {
            onClose: () => store.update({ openItemId: null, editingCard: null }),
            onDelete: removeCard,
            onStartEdit: (edit) => store.update({ editingCard: edit }),
            // Silent, like every other field: rebuilding would move the caret.
            onEditField: (change) =>
              store.set((current) => ({
                editingCard: current.editingCard ? { ...current.editingCard, ...change } : null,
              })),
            onCancelEdit: () => store.update({ editingCard: null }),
            onSaveEdit: () => void saveCardEdit(),
          },
          state.editingCard,
        )
      : null,
    body,
  );
}

function friendView(state: AppState, friend: Friend): DocumentFragment {
  return renderWishlists({
    lists: { [friend.owner]: friend.wishlist },
    prices: state.data?.prices ?? null,
    names: state.data?.names ?? emptyNames,
    combined: false,
    canEdit: false,
    editing: null,
    openCardId: state.openWishCardId,
    onOpenCard: (cardId) => store.update({ openWishCardId: cardId }),
    onToggleCombined: () => undefined,
  });
}

function render(state: AppState): void {
  rebuildPreservingFocus(() => paint(state));
}

function paint(state: AppState): void {
  const root = need<HTMLElement>('#personal-app');
  const heading = need<HTMLElement>('#personal-heading');
  const actions = need<HTMLElement>('#personal-actions');

  heading.textContent = state.friend
    ? `${state.friend.wishlist.owner}’s list`
    : state.vault
      ? state.tab === 'collection'
        ? 'Collection'
        : 'Wishlists'
      : 'Personal';

  actions.replaceChildren(
    state.phase === 'open'
      ? // Nothing readable is stored anywhere, so reloading is a complete lock.
        el('button', { type: 'button', class: 'chip', text: 'Lock', onClick: () => location.reload() })
      : frag(),
  );

  root.replaceChildren(
    frag(
      state.phase === 'open' ? publishBar(state) : null,
      state.phase === 'open' ? stalenessBanner(state) : null,
      state.phase === 'open' && state.vault
        ? adminView(state, state.vault)
        : state.phase === 'open' && state.friend
          ? friendView(state, state.friend)
          : lockScreen(state),
    ),
  );
}

export function start(): void {
  store.subscribe(render);
  render(store.get());
}
