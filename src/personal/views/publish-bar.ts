/**
 * Unpublished changes, and the token that publishes them.
 *
 * Changes are kept on the device until they are published, so a shop basement with no
 * signal loses nothing. The count is always visible, because a queue that fills up
 * silently is the failure that costs real work.
 */
import { el, frag } from '../lib/dom';

export interface PublishBarState {
  pendingCount: number;
  hasToken: boolean;
  busy: boolean;
  message: string;
  lastCommitUrl: string | null;
  askingForToken: boolean;
  onAskForToken(): void;
  onSaveToken(token: string): Promise<void>;
  onForgetToken(): void;
  onPublish(): Promise<void>;
  onDiscard(): Promise<void>;
}

export function renderPublishBar(state: PublishBarState): HTMLElement | null {
  if (state.pendingCount === 0 && !state.askingForToken && !state.message) return null;

  if (state.askingForToken) {
    const input = el('input', {
      type: 'password',
      placeholder: 'github_pat_…',
      'aria-label': 'GitHub token',
      autocomplete: 'off',
    });

    return el(
      'section',
      { class: 'publish token-form' },
      el('p', {
        class: 'ui',
        text: 'Paste a fine-grained token scoped to this repository with contents: write and nothing else. It is kept on this device only.',
      }),
      el(
        'div',
        { class: 'search-row' },
        input,
        el('button', {
          type: 'button',
          text: state.busy ? 'Checking…' : 'Save token',
          disabled: state.busy,
          onClick: () => state.onSaveToken(input.value.trim()),
        }),
      ),
      state.message ? el('p', { class: 'form-error ui', text: state.message }) : null,
    );
  }

  return el(
    'section',
    { class: 'publish' },
    el('span', {
      class: 'ui',
      text:
        state.pendingCount === 0
          ? 'Everything is published.'
          : `${state.pendingCount} unpublished change${state.pendingCount === 1 ? '' : 's'} on this device.`,
    }),
    frag(
      state.pendingCount > 0
        ? el('button', {
            type: 'button',
            text: state.busy ? 'Publishing…' : state.hasToken ? 'Publish' : 'Add a token to publish',
            disabled: state.busy,
            onClick: state.hasToken ? state.onPublish : state.onAskForToken,
          })
        : null,
      state.pendingCount > 0
        ? el('button', {
            type: 'button',
            class: 'chip',
            text: 'Discard',
            onClick: () => {
              // Unpublished work only exists here, so losing it is not recoverable from
              // git the way a published mistake is.
              if (confirm(`Throw away ${state.pendingCount} unpublished change(s)? They are only on this device.`)) {
                void state.onDiscard();
              }
            },
          })
        : null,
      state.hasToken
        ? el('button', { type: 'button', class: 'chip', text: 'Forget token', onClick: state.onForgetToken })
        : null,
      state.lastCommitUrl
        ? el('a', { class: 'ui', href: state.lastCommitUrl, target: '_blank', rel: 'noreferrer', text: 'View commit' })
        : null,
    ),
    state.message ? el('p', { class: 'form-error ui', text: state.message }) : null,
  );
}
