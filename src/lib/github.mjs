/**
 * Commits a set of files to GitHub in one commit, from the browser.
 *
 * The Contents API writes one file per request and produces one commit each, so saving a
 * shopping session would leave forty commits behind. The Git Data API costs a few more
 * requests but produces a single commit, which is what makes the history readable.
 *
 * The token is a fine-grained personal access token scoped to this repository with
 * `contents: write` and nothing else. It is never logged, never put in a URL, and cannot
 * reach `.github/workflows/` — that needs a separate permission it does not have.
 */

const API = 'https://api.github.com';

/** The daily price job pushes to the same branch, so a save can always land on a moved head. */
const RETRIES = 3;

/**
 * How long to wait before reading the branch again, per attempt.
 *
 * Retrying immediately does not work, for two reasons that both need real time to pass.
 * GitHub serves `git/ref` with `cache-control: public, max-age=60`, so a retry inside
 * that minute is answered from the browser's cache with the same stale head and rebuilds
 * on it — four attempts in a few milliseconds all failed with the same 422. `cache:
 * no-store` below deals with that; the waits deal with the rest, which is that GitHub's
 * own read replicas take a moment to catch up with a push.
 */
const BACKOFF_MS = [400, 1200, 3000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Said instead of the raw 422, which reads as data loss and is not. */
const BRANCH_KEPT_MOVING =
  `The branch moved during each of ${RETRIES + 1} attempts to save. Nothing was lost — the ` +
  'changes are still queued on this device. Try publishing again in a minute.';

const textEncoder = new TextEncoder();

/** GitHub wants base64, and btoa cannot take multi-byte characters such as card names. */
function toBase64Utf8(text) {
  const bytes = textEncoder.encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/**
 * A request that survives one bad moment on the way to GitHub.
 *
 * The retry loop below only ever caught a branch that moved. A `fetch` that rejects —
 * what a phone does when the signal drops mid-save, and what the screen reports as the
 * browser's bare "Failed to fetch" — came straight back out and failed the publish, on
 * any one of the six or more requests a commit is made of. Nothing was lost, because the
 * queue is kept, but it took a manual retry to get past a blip that had already passed.
 *
 * Retried once: a rejected fetch, a 5xx, and a 429. Never a 4xx that is an answer — a
 * rejected token or a missing repository does not improve by being asked twice.
 */
const NETWORK_RETRY_MS = 700;

async function fetchWithOneRetry(url, init) {
  try {
    const response = await fetch(url, init);
    if (response.status < 500 && response.status !== 429) return response;
  } catch {
    // Kept quiet: if the second attempt fails too, its error says the same thing and is
    // the one that reaches the screen.
  }

  await wait(NETWORK_RETRY_MS);
  return fetch(url, init);
}

function createClient({ token, owner, repo }) {
  return async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchWithOneRetry(`${API}/repos/${owner}/${repo}${path}`, {
      method,
      // Never from the cache. GitHub marks these responses publicly cacheable for a
      // minute, and a commit built on a minute-old head is rejected as not a fast
      // forward — which is exactly the failure this retries out of.
      //
      // `no-store` is the whole fix, and it must stay the whole fix: a `Cache-Control`
      // *header* was added here alongside it and broke publishing outright. That header
      // is not CORS-safelisted, so it turns every call into a preflight, and GitHub does
      // not list it in Access-Control-Allow-Headers — the browser then blocks the request
      // and reports it as "Failed to fetch", which reads as a network problem and is not
      // one. Measured from the live origin: the same URL answers 200 with Accept and
      // X-GitHub-Api-Version, and throws with Cache-Control alone.
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      // The message can quote the request, so it is read but never the token.
      const detail = await response.text();
      throw new GitHubError(`${method} ${path} → ${response.status}: ${detail.slice(0, 200)}`, response.status);
    }

    return response.status === 204 ? null : response.json();
  };
}

/**
 * Writes `files` as one commit.
 *
 * @param {{token: string, owner: string, repo: string, branch?: string}} target
 * @param {{path: string, content: string, encoding?: 'utf8' | 'base64'}[]} files
 *   `base64` content is passed through untouched, for images and anything else whose
 *   bytes would not survive being read as text.
 * @param {string} message
 * @returns {Promise<{sha: string, url: string}>}
 */
export async function commitFiles(target, files, message) {
  if (files.length === 0) throw new Error('Nothing to commit');

  const branch = target.branch ?? 'master';
  const request = createClient(target);

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) await wait(BACKOFF_MS[attempt - 1]);

    const ref = await request(`/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const headCommit = await request(`/git/commits/${head}`);

    const blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await request('/git/blobs', {
          method: 'POST',
          body: {
            content: file.encoding === 'base64' ? file.content : toBase64Utf8(file.content),
            encoding: 'base64',
          },
        });
        return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
      }),
    );

    // base_tree is the head we just read, so files this save does not mention — the
    // price snapshots the nightly job writes, for one — are carried through untouched.
    const tree = await request('/git/trees', {
      method: 'POST',
      body: { base_tree: headCommit.tree.sha, tree: blobs },
    });

    const commit = await request('/git/commits', {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [head] },
    });

    try {
      await request(`/git/refs/heads/${branch}`, {
        method: 'PATCH',
        // Never force: a rejected update means the branch moved, and the fix is to
        // rebuild on top of where it moved to, not to overwrite it.
        body: { sha: commit.sha, force: false },
      });
      return { sha: commit.sha, url: `https://github.com/${target.owner}/${target.repo}/commit/${commit.sha}` };
    } catch (error) {
      const branchMoved = error instanceof GitHubError && (error.status === 422 || error.status === 409);
      if (!branchMoved) throw error;
      // The last attempt reports what happened in words, not as a 422 quoting the API.
      if (attempt === RETRIES) throw new Error(BRANCH_KEPT_MOVING);
    }
  }

  throw new Error(BRANCH_KEPT_MOVING);
}

/**
 * Confirms a token works and can write here, before anything depends on it.
 * Returns the reason it cannot, rather than a bare false, so the screen can say why.
 */
export async function checkToken(target) {
  try {
    const repository = await createClient(target)('');
    if (!repository.permissions?.push) return { ok: false, reason: 'This token cannot write to the repository.' };
    return { ok: true };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      return { ok: false, reason: 'The token was rejected. It may have expired or been revoked.' };
    }
    if (error instanceof GitHubError && error.status === 404) {
      return { ok: false, reason: 'The token cannot see this repository. Check that it is scoped to it.' };
    }
    return { ok: false, reason: error.message };
  }
}

export { GitHubError };
