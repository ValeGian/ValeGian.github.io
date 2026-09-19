/**
 * Unpublished changes, kept on the device.
 *
 * Only ever holds ciphertext for the personal files and already-public JSON for the
 * derived ones, so nothing readable is left behind on the phone. Surviving a reload
 * therefore costs no stored secret: the next unlock supplies the key again.
 */
const DB_NAME = 'valegian-personal';
const STORE = 'pending-writes';

export interface PendingWrite {
  path: string;
  content: string;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'path' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Local storage write failed'));
    });
  } finally {
    db.close();
  }
}

export const savePending = (writes: PendingWrite[]): Promise<unknown> =>
  Promise.all(writes.map((write) => withStore('readwrite', (store) => store.put(write))));

export const listPending = (): Promise<PendingWrite[]> =>
  withStore<PendingWrite[]>('readonly', (store) => store.getAll());

export const clearPending = (): Promise<unknown> =>
  withStore('readwrite', (store) => store.clear());
