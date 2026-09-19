/**
 * One card, in full.
 *
 * Every price carries where it came from and when it was last read. Cardmarket and
 * TCGplayer are different markets, and a hand-checked figure is a different thing again,
 * so a number without its origin is not worth showing.
 */
import { el, frag } from '../lib/dom.ts';
import { money, signedMoney, percent, type Valued } from '../lib/money.ts';
import { displayName, fullImage, type CatalogOverride, type NameTable } from '../lib/data.ts';
import type { Condition, Currency } from '../lib/types.ts';

export interface CardEdit {
  itemId: string;
  condition: Condition;
  quantity: string;
  amount: string;
  currency: Currency;
  date: string;
  notes: string;
}

const CONDITIONS: Condition[] = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

/**
 * Where a figure came from, spelled out. Two of the sources are different markets and a
 * third was read by a person, so a bare number would be asking the reader to assume.
 */
function sourceLabel(entry: Valued): string {
  const measure = entry.basis === 'avg7' ? '7-day average' : '30-day average';
  return entry.price?.source === 'cardmarket/manual'
    ? `Cardmarket, checked by hand`
    : `Cardmarket ${measure}, all conditions`;
}

const dateLabel = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso)) : 'unknown';

function line(label: string, ...content: (Node | string | null)[]): HTMLElement {
  return el('div', { class: 'detail-line' }, el('dt', { text: label }), el('dd', {}, ...content));
}

/** The card's own fields, editable in place. Catalog facts are not: they come from TCGdex. */
function editForm(
  entry: Valued,
  edit: CardEdit,
  onField: (change: Partial<CardEdit>) => void,
  onSave: () => void,
  onCancel: () => void,
): HTMLElement {
  const text = (id: string, value: string, key: keyof CardEdit, extra: Record<string, unknown> = {}) =>
    el('input', {
      id,
      value,
      ...extra,
      // Silent: rebuilding replaces the element the caret is in, and on a number input
      // the caret cannot be put back, so digits arrive reversed.
      onInput: (event: Event) => onField({ [key]: (event.target as HTMLInputElement).value } as Partial<CardEdit>),
    });

  const labelled = (id: string, label: string, control: HTMLElement) =>
    el('label', { class: 'field', for: id }, el('span', { text: label }), control);

  return el(
    'form',
    {
      class: 'card-edit',
      onSubmit: (event: Event) => {
        event.preventDefault();
        onSave();
      },
    },
    el(
      'div',
      { class: 'grid-fields' },
      labelled('edit-paid', 'Paid', text('edit-paid', edit.amount, 'amount', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal' })),
      labelled(
        'edit-currency',
        'Currency',
        el(
          'select',
          { id: 'edit-currency', onChange: (event: Event) => onField({ currency: (event.target as HTMLSelectElement).value as Currency }) },
          ...(['JPY', 'EUR'] as const).map((code) => el('option', { value: code, text: code, selected: edit.currency === code })),
        ),
      ),
      labelled('edit-date', 'Date', text('edit-date', edit.date, 'date', { type: 'date' })),
      labelled('edit-quantity', 'Copies', text('edit-quantity', edit.quantity, 'quantity', { type: 'number', min: '1', step: '1' })),
      labelled(
        'edit-condition',
        'Condition',
        el(
          'select',
          { id: 'edit-condition', onChange: (event: Event) => onField({ condition: (event.target as HTMLSelectElement).value as Condition }) },
          ...CONDITIONS.map((grade) => el('option', { value: grade, text: grade, selected: edit.condition === grade })),
        ),
      ),
    ),
    labelled('edit-card-notes', 'Notes', text('edit-card-notes', edit.notes, 'notes', { type: 'text' })),
    // States the rule rather than the current state: these fields update without
    // rebuilding the view, so anything derived from them would show the previous answer.
    el('p', {
      class: 'detail-note',
      text:
        'Change the amount, currency or date and the rate for that date is fetched and frozen in. Leave them alone and the rate on record is kept.',
    }),
    el(
      'div',
      { class: 'form-actions' },
      el('button', { type: 'submit', text: 'Save' }),
      el('button', { type: 'button', class: 'chip', text: 'Cancel', onClick: onCancel }),
    ),
  );
}

export interface DetailHandlers {
  onClose: () => void;
  onDelete?: (itemId: string) => void;
  onStartEdit?: (edit: CardEdit) => void;
  onEditField?: (change: Partial<CardEdit>) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
}

export function renderDetail(
  entry: Valued,
  names: NameTable,
  overrides: Map<string, CatalogOverride>,
  handlers: DetailHandlers,
  editing: CardEdit | null = null,
): HTMLElement {
  const { onClose, onDelete, onStartEdit, onEditField, onSaveEdit, onCancelEdit } = handlers;
  const { item, price } = entry;
  // A photograph taken in a shop stands in until the catalog publishes artwork.
  const image = fullImage(item) ?? item.photoUrl ?? null;
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
      onStartEdit && !editing
        ? el('button', {
            type: 'button',
            class: 'chip',
            text: 'Edit',
            onClick: () =>
              onStartEdit({
                itemId: item.id,
                condition: item.condition,
                quantity: String(item.quantity),
                amount: String(item.purchase.amount),
                currency: item.purchase.currency,
                date: item.purchase.date,
                notes: item.notes ?? '',
              }),
          })
        : null,
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
        editing && onEditField && onSaveEdit && onCancelEdit
          ? editForm(entry, editing, onEditField, onSaveEdit, onCancelEdit)
          : el(
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
              ? el('span', { class: 'detail-note', text: `${sourceLabel(entry)} · read ${dateLabel(price.updated)}` })
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
        frag(),
      ),
    ),
  );
}
