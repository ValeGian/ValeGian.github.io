/**
 * One card, in full.
 *
 * Every price carries where it came from and when it was last read. Cardmarket and
 * TCGplayer are different markets, and a hand-checked figure is a different thing again,
 * so a number without its origin is not worth showing.
 */
import { el } from '../lib/dom';
import { money, signedMoney, percent, type Valued } from '../lib/money';
import { displayName, fullImage, type CatalogOverride, type NameTable } from '../lib/data';

const SOURCE_LABEL: Record<string, string> = {
  'cardmarket/tcgdex': 'Cardmarket 30-day average, all conditions',
  'cardmarket/manual': 'Cardmarket, checked by hand',
};

const dateLabel = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso)) : 'unknown';

function line(label: string, ...content: (Node | string | null)[]): HTMLElement {
  return el('div', { class: 'detail-line' }, el('dt', { text: label }), el('dd', {}, ...content));
}

export function renderDetail(
  entry: Valued,
  names: NameTable,
  overrides: Map<string, CatalogOverride>,
  onClose: () => void,
  onDelete?: (itemId: string) => void,
): HTMLElement {
  const { item, price } = entry;
  const image = fullImage(item);
  const override = item.cardId ? overrides.get(item.cardId) : undefined;
  const paidNative =
    item.purchase.currency === 'EUR'
      ? null
      : `${item.purchase.amount.toLocaleString('en-GB')} ${item.purchase.currency} at ${item.purchase.fxRate}`;

  return el(
    'div',
    { class: 'detail' },
    el(
      'div',
      { class: 'detail-actions' },
      onDelete
        ? el('button', {
            type: 'button',
            class: 'detail-delete',
            text: 'Remove',
            // Git history is the undo, so a single confirmation is enough friction.
            onClick: () => {
              if (confirm(`Remove ${displayName(item, names)} from the collection?`)) onDelete(item.id);
            },
          })
        : null,
      el('button', { type: 'button', class: 'detail-close', text: 'Close', onClick: onClose }),
    ),
    el(
      'div',
      { class: 'detail-body' },
      image
        ? el('img', { class: 'detail-image', src: image, alt: displayName(item, names), loading: 'lazy' })
        : el('div', { class: 'detail-image detail-image-empty ui', text: 'No image in the catalog' }),
      el(
        'div',
        {},
        el('h3', { text: displayName(item, names) }),
        item.nameJa ? el('p', { class: 'detail-ja', text: item.nameJa }) : null,
        el(
          'dl',
          { class: 'detail-lines' },
          line('Set', item.setId && item.number ? `${item.setId} ${item.number}` : 'awaiting catalog'),
          item.rarity ? line('Rarity', item.rarity) : null,
          line('Condition', item.condition),
          line('Copies', String(item.quantity)),
          line(
            'Paid',
            money(entry.paid),
            paidNative ? el('span', { class: 'detail-note', text: paidNative }) : null,
            item.purchase.dateIsBootstrap
              ? el('span', { class: 'detail-note', text: 'date recorded at import, not at purchase' })
              : el('span', { class: 'detail-note', text: `bought ${dateLabel(item.purchase.date)}` }),
          ),
          line(
            'Value now',
            entry.value === null ? 'No price yet' : money(entry.value),
            price
              ? el('span', {
                  class: 'detail-note',
                  text: `${SOURCE_LABEL[price.source] ?? price.source} · read ${dateLabel(price.updated)}`,
                })
              : null,
          ),
          entry.gain === null
            ? null
            : line(
                'Gain',
                el('span', { class: entry.gain >= 0 ? 'gain up' : 'gain down', text: signedMoney(entry.gain) }),
                entry.ratio === null ? null : el('span', { class: 'detail-note', text: percent(entry.ratio) }),
              ),
          item.notes ? line('Notes', item.notes) : null,
          override?.cardmarketUrl
            ? line('Cardmarket', el('a', { href: override.cardmarketUrl, target: '_blank', rel: 'noreferrer', text: 'Open product page' }))
            : null,
        ),
      ),
    ),
  );
}
