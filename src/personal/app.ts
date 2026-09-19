/**
 * The personal area.
 *
 * Mounts into the page after unlocking, and rebuilds itself whenever state changes.
 * Nothing is cached anywhere, so closing the tab locks it.
 */
import { el, frag, need } from './lib/dom';
import { createStore } from './lib/store';
import { emptyFilters, type Filters, type SortKey } from './lib/filters';
import { value, type Valued } from './lib/money';
import { loadPublicData, stalenessDays, type PublicData } from './lib/data';
import { renderCollection } from './views/collection';
import { renderDetail } from './views/detail';
import { renderWishlists } from './views/wishlists';
import { unlock } from '../lib/unlock.mjs';
import type { Collection, Wishlist } from './lib/types';

type Vault =
  | { role: 'admin'; collection: Collection; wishlists: Record<string, Wishlist> }
  | { role: 'friend'; owner: string; wishlist: Wishlist };

interface AppState {
  phase: 'locked' | 'checking' | 'open';
  message: string;
  vault: Vault | null;
  data: PublicData | null;
  tab: 'collection' | 'wishlists';
  filters: Filters;
  sortKey: SortKey;
  sortDescending: boolean;
  combined: boolean;
  openItemId: string | null;
}

/** Older than this and the figures are stale enough that showing them silently is wrong. */
const STALE_AFTER_DAYS = 2;

const store = createStore<AppState>({
  phase: 'locked',
  message: '',
  vault: null,
  data: null,
  tab: 'collection',
  filters: { ...emptyFilters },
  sortKey: 'value',
  sortDescending: true,
  combined: true,
  openItemId: null,
});

/** The unlock step hands back whatever opened; name the two shapes it can be. */
function toVault(session: unknown): Vault | null {
  const result = session as
    | { role: 'admin'; files: Record<string, unknown> }
    | { role: 'friend'; owner: string; list: unknown }
    | null;
  if (!result) return null;

  if (result.role === 'admin') {
    const { collection, ...rest } = result.files as Record<string, unknown>;
    return {
      role: 'admin',
      collection: collection as Collection,
      wishlists: rest as Record<string, Wishlist>,
    };
  }
  return { role: 'friend', owner: result.owner, wishlist: result.list as Wishlist };
}

function valuedRows(state: AppState): Valued[] {
  if (state.vault?.role !== 'admin') return [];
  return state.vault.collection.items.map((item) => value(item, state.data?.prices ?? null));
}

function stalenessBanner(state: AppState): HTMLElement | null {
  const days = stalenessDays(state.data?.prices ?? null);
  if (days === null) {
    return el('p', { class: 'banner', text: 'No price data has been published yet.' });
  }
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
          const vault = toVault(await unlock(password));
          if (!vault) {
            // Says nothing about which file was tried or how close the guess was.
            store.update({ phase: 'locked', message: 'That password does not open anything here.' });
            return;
          }
          store.update({ phase: 'open', message: '', vault, data: await loadPublicData() });
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

function adminView(state: AppState, vault: Extract<Vault, { role: 'admin' }>): DocumentFragment {
  const rows = valuedRows(state);
  const open = state.openItemId ? rows.find((entry) => entry.item.id === state.openItemId) : undefined;

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
        onClick: () => store.update({ tab, openItemId: null }),
      }),
    ),
  );

  const body =
    state.tab === 'collection'
      ? renderCollection({
          rows,
          names: state.data?.names ?? { species: {} },
          filters: state.filters,
          sortKey: state.sortKey,
          sortDescending: state.sortDescending,
          onFilters: (change) => store.update((current) => ({ filters: { ...current.filters, ...change } })),
          onSort: (key) =>
            store.update((current) => ({
              sortKey: key,
              sortDescending: current.sortKey === key ? !current.sortDescending : true,
            })),
          onOpen: (itemId) => store.update({ openItemId: itemId }),
        })
      : renderWishlists({
          lists: vault.wishlists,
          prices: state.data?.prices ?? null,
          names: state.data?.names ?? { species: {} },
          combined: state.combined,
          canEdit: false,
          onToggleCombined: () => store.update((current) => ({ combined: !current.combined })),
        });

  return frag(
    tabs,
    open
      ? renderDetail(
          open,
          state.data?.names ?? { species: {} },
          state.data?.overrides ?? new Map(),
          () => store.update({ openItemId: null }),
        )
      : null,
    body,
  );
}

function friendView(state: AppState, vault: Extract<Vault, { role: 'friend' }>): DocumentFragment {
  return renderWishlists({
    lists: { [vault.owner]: vault.wishlist },
    prices: state.data?.prices ?? null,
    names: state.data?.names ?? { species: {} },
    combined: false,
    canEdit: false,
    onToggleCombined: () => undefined,
  });
}

function render(state: AppState): void {
  const root = need<HTMLElement>('#personal-app');
  const heading = need<HTMLElement>('#personal-heading');
  const actions = need<HTMLElement>('#personal-actions');

  heading.textContent =
    state.vault === null
      ? 'Personal'
      : state.vault.role === 'admin'
        ? state.tab === 'collection'
          ? 'Collection'
          : 'Wishlists'
        : `${state.vault.wishlist.owner}’s list`;

  actions.replaceChildren(
    state.phase === 'open'
      ? el('button', {
          type: 'button',
          class: 'chip',
          text: 'Lock',
          // Nothing is stored anywhere, so reloading is a complete lock.
          onClick: () => location.reload(),
        })
      : frag(),
  );

  const banner = state.phase === 'open' ? stalenessBanner(state) : null;

  root.replaceChildren(
    frag(
      banner,
      state.phase === 'open' && state.vault
        ? state.vault.role === 'admin'
          ? adminView(state, state.vault)
          : friendView(state, state.vault)
        : lockScreen(state),
    ),
  );
}

export function start(): void {
  store.subscribe(render);
  render(store.get());
}
