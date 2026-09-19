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

function createClient({ token, owner, repo }) {
  return async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
      method,
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
 * @param {{path: string, content: string}[]} files
 * @param {string} message
 * @returns {Promise<{sha: string, url: string}>}
 */
export async function commitFiles(target, files, message) {
  if (files.length === 0) throw new Error('Nothing to commit');

  const branch = target.branch ?? 'master';
  const request = createClient(target);

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const ref = await request(`/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const headCommit = await request(`/git/commits/${head}`);

    const blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await request('/git/blobs', {
          method: 'POST',
          body: { content: toBase64Utf8(file.content), encoding: 'base64' },
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
      if (!branchMoved || attempt === RETRIES) throw error;
    }
  }

  throw new Error(`The branch kept moving; gave up after ${RETRIES + 1} attempts`);
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
