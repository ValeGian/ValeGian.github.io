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
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();

  return {
    get: () => state,
    update(change) {
      const patch = typeof change === 'function' ? change(state) : change;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
