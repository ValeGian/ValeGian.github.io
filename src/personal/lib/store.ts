/**
 * State for the personal area: one object, one subscriber list, rebuilt views.
 *
 * Deliberately not a general-purpose store. It holds what the screen needs, and every
 * change goes through `update` so there is a single place to watch when something
 * re-renders that should not have.
 */
export interface Store<T> {
  get(): T;
  update(change: Partial<T> | ((current: T) => Partial<T>)): void;
  /**
   * Records a change without rebuilding the view.
   *
   * For state the DOM already reflects — the text in a field the person is typing into.
   * Rebuilding to show what was just typed is not only wasted work: it replaces the
   * element, and `selectionStart` is null on a number input, so the caret cannot be put
   * back and every keystroke lands at the start. Typing 30 produced 03.
   */
  set(change: Partial<T> | ((current: T) => Partial<T>)): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();

  const apply = (change: Partial<T> | ((current: T) => Partial<T>)): void => {
    state = { ...state, ...(typeof change === 'function' ? change(state) : change) };
  };

  return {
    get: () => state,
    update(change) {
      apply(change);
      for (const listener of listeners) listener(state);
    },
    set: apply,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
