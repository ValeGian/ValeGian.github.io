/**
 * A field the person is typing into must not cause a rebuild.
 *
 * Rebuilding replaces the element the caret is in, and `selectionStart` is null on a
 * number input, so the caret cannot be put back and every keystroke lands at the start.
 * Typing 30 produced 03. The guard is that field edits go through `set`, not `update`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/personal/lib/store.ts';

test('update tells subscribers, because the view has to change', () => {
  const store = createStore({ picked: null as string | null });
  let rebuilds = 0;
  store.subscribe(() => (rebuilds += 1));

  store.update({ picked: 'S12a-261' });

  assert.equal(rebuilds, 1);
  assert.equal(store.get().picked, 'S12a-261');
});

test('set records the change without rebuilding', () => {
  const store = createStore({ target: '' });
  let rebuilds = 0;
  store.subscribe(() => (rebuilds += 1));

  for (const value of ['3', '30']) store.set({ target: value });

  assert.equal(rebuilds, 0, 'typing must not replace the element being typed into');
  assert.equal(store.get().target, '30', 'but the value is still recorded');
});

test('a later rebuild renders what was typed silently', () => {
  const store = createStore({ target: '', picked: null as string | null });
  let seen = '';
  store.subscribe((state) => (seen = state.target));

  store.set({ target: '220' });
  store.update({ picked: 'M6-113' });

  assert.equal(seen, '220', 'the silent value is present the next time the view is built');
});

test('both forms accept a function of the current state', () => {
  const store = createStore({ count: 1 });
  store.set((current) => ({ count: current.count + 1 }));
  store.update((current) => ({ count: current.count + 1 }));
  assert.equal(store.get().count, 3);
});
