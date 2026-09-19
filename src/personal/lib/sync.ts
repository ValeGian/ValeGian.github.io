/**
 * Publishing changes to GitHub.
 *
 * The token is a fine-grained personal access token scoped to this repository with
 * `contents: write` and nothing else. It lives in localStorage, which any script on this
 * origin could read — the site has no user content and no third-party scripts, but the
 * risk is not zero. What bounds it: the repository is public already, the token cannot
 * reach `.github/workflows/`, and the worst outcome is commits to revert and a token to
 * rotate. "Forget token" removes it from this device.
 */
import { checkToken, commitFiles } from '../../lib/github.mjs';
import { clearPending, listPending, savePending, type PendingWrite } from './local.ts';

const TOKEN_KEY = 'valegian.personal.token';
const TARGET = { owner: 'ValeGian', repo: 'ValeGian.github.io', branch: 'master' };

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const forgetToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Private browsing refuses storage; there is nothing to forget in that case. */
  }
};

export async function rememberToken(token: string): Promise<{ ok: boolean; reason?: string }> {
  const result = await checkToken({ ...TARGET, token });
  if (!result.ok) return result;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return { ok: false, reason: 'This browser refused to store the token.' };
  }
  return { ok: true };
}

export { listPending, savePending, clearPending as discardPending };

export interface PublishResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

/** Publishes every queued file as one commit, then clears the queue. */
export async function publish(summary: string): Promise<PublishResult> {
  const token = getToken();
  if (!token) return { ok: false, reason: 'No token on this device yet.' };

  const pending = await listPending();
  if (pending.length === 0) return { ok: false, reason: 'Nothing to publish.' };

  try {
    const commit = await commitFiles(
      { ...TARGET, token },
      pending.map((write: PendingWrite) => ({ path: write.path, content: write.content })),
      summary,
    );
    await clearPending();
    return { ok: true, url: commit.url };
  } catch (error) {
    // The queue is deliberately left intact: a failed publish must not lose the work.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
