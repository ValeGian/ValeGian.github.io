/**
 * Keeping an unlocked session across a reload.
 *
 * Unlocking used to be the only way in, so every refresh — a pull-to-refresh on a phone,
 * a stray F5, coming back to a tab Chrome had discarded — asked for the password again
 * and spent another 600ms of PBKDF2 to answer it.
 *
 * What is kept is the set of unwrapped file keys, in `sessionStorage`, never the
 * password. Two consequences follow from that choice and both are deliberate:
 *
 * - `sessionStorage` is per-tab and cleared when the tab closes, so closing the tab still
 *   locks the vault. Reloading no longer does.
 * - The keys are readable by any script running on this origin. There is no third-party
 *   script on this site and nothing renders untrusted HTML, but it is a real widening:
 *   an unlocked tab left open on an unattended phone now survives a refresh. Locking
 *   clears the store before reloading, and that is the deliberate way out.
 *
 * Every access is wrapped: `sessionStorage` throws outright in some privacy modes rather
 * than returning null, and a locked vault is a better failure than a blank screen.
 */
import { exportFileKey, importFileKey } from '../../lib/crypto.mjs';

const KEY = 'personal.session';
const TAB_KEY = 'personal.tab';
const BASIS_KEY = 'personal.basis';

/** What survives a reload. Keys are raw AES-256 material, base64, as the keyring holds them. */
export type SavedSession =
  | { role: 'admin' | 'viewer'; keys: Record<string, string> }
  | { role: 'friend'; owner: string; key: string };

export async function saveSession(
  session: { role: 'admin' | 'viewer'; keys: Map<string, CryptoKey> } | { role: 'friend'; owner: string; key: CryptoKey },
): Promise<void> {
  try {
    const saved: SavedSession =
      session.role === 'friend'
        ? { role: 'friend', owner: session.owner, key: await exportFileKey(session.key) }
        : {
            role: session.role,
            keys: Object.fromEntries(
              await Promise.all([...session.keys].map(async ([name, key]) => [name, await exportFileKey(key)])),
            ),
          };

    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage refused. The session still works; it just will not survive a reload.
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSession;
    return saved?.role === 'friend' || saved?.role === 'admin' || saved?.role === 'viewer' ? saved : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TAB_KEY);
    sessionStorage.removeItem(BASIS_KEY);
  } catch {
    // Nothing to do; the tab closing clears it anyway.
  }
}

export type TabName = 'collection' | 'wishlists';

/**
 * Which tab was open, kept for the same reason the keys are.
 *
 * Reloading while reading a wishlist used to land back on the collection, which is the
 * sort of thing that is merely odd on a laptop and genuinely annoying on a phone in a
 * shop, where a reload is how you recover from a bad connection.
 */
export function saveTab(tab: TabName): void {
  try {
    sessionStorage.setItem(TAB_KEY, tab);
  } catch {
    // The tab is a convenience; losing it costs one click.
  }
}

export function loadTab(): TabName | null {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    return saved === 'collection' || saved === 'wishlists' ? saved : null;
  } catch {
    return null;
  }
}

/** Turns the stored base64 back into keys, or gives up and asks for the password again. */
export async function sessionKeys(saved: SavedSession): Promise<Map<string, CryptoKey> | null> {
  try {
    const entries = saved.role === 'friend' ? [[saved.owner, saved.key] as const] : Object.entries(saved.keys);
    const keys = new Map<string, CryptoKey>();
    for (const [name, raw] of entries) keys.set(name, await importFileKey(raw));
    return keys;
  } catch {
    return null;
  }
}

/** Which market figure the reader chose to value on; see money.ts `quote`. */
export function saveBasis(basis: 'avg30' | 'trend'): void {
  try {
    sessionStorage.setItem(BASIS_KEY, basis);
  } catch {
    // A preference, not data; losing it costs one click.
  }
}

export function loadBasis(): 'avg30' | 'trend' | null {
  try {
    const saved = sessionStorage.getItem(BASIS_KEY);
    return saved === 'avg30' || saved === 'trend' ? saved : null;
  } catch {
    return null;
  }
}
