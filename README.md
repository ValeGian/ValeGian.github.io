# valegian.github.io

Personal site of Valerio Giannini, and a private tracker for a Japanese Pokémon card
collection. Built with [Astro](https://astro.build), published to GitHub Pages by GitHub
Actions.

There is no server and no database. Card data and daily market-price snapshots are plain
JSON files in this repository; the personal files are encrypted in the browser before
they are committed. See [`PLAN.md`](./PLAN.md) for the architecture, the data sources and
the decisions behind them — it doubles as the progress log.

## Running it

```bash
npm install
npm run dev        # local dev server
npm run build      # static build into dist/
npm run check      # type-check
npm test           # unit tests
npm run validate   # every data file against its schema
```

Requires Node 20 or newer.

## Layout

| Path | Contents |
|---|---|
| `src/pages/` | routes |
| `src/personal/` | the gated collection app |
| `src/lib/` | crypto, catalog names, watchlist derivation — shared by the site and the scripts |
| `src/data/profile.json`, `transcripts.json` | CV content, read at build time |
| `public/data/` | everything fetched at runtime, including the encrypted personal files |
| `scripts/` | data pipeline and maintenance |
| `schemas/` | JSON Schema for every data file |
| `.local/` | **gitignored.** Plaintext working copies. Never commit anything from here. |

## The one rule

`.local/` holds the collection in the clear. **This repository is public and git history
is append-only**, so anything committed from there is readable forever — including after
the served copies are encrypted. `scripts/admin-commit.mjs` refuses to run if `.local/`
has been staged; do not work around it.

## Adding a card

Normally from the site: open `/personal`, unlock, **Add a card**, search, pick the
printing, enter what it cost. Changes queue on the device and publish when you tap
**Publish**, which works offline and survives closing the browser — the queue is
ciphertext, so no secret is stored to make that work.

From a laptop instead:

```bash
# edit .local/collection.json by hand, then
PERSONAL_PASSWORD_ADMIN=… npm run admin:commit
```

That re-encrypts, rebuilds the derived public files, runs the tests, and commits.

## Publishing from the browser

The first **Publish** asks for a GitHub token. Create a **fine-grained** personal access
token:

- **Repository access:** only `ValeGian/ValeGian.github.io`
- **Permissions:** `Contents: Read and write`, nothing else
- **Expiry:** a year

Nothing more is needed, and `Contents` alone cannot modify `.github/workflows/`. The
token is kept in this browser only; **Forget token** removes it. If a device is lost,
revoke the token on GitHub — that is the whole remedy, because the token can only write
to a repository that is already public.

## Changing a password

```bash
PERSONAL_PASSWORD_ADMIN=<new password> npm run data:encrypt
PERSONAL_PASSWORD_ADMIN=<new password> npm run admin:commit
```

The file keys are deliberately kept across rewrites, so the new password still opens
every revision already in git history. Losing the admin password means losing the data:
there is no recovery path, by design. Keep `.local/` backed up somewhere you trust.

## Recovering

| Problem | Fix |
|---|---|
| A bad edit was published | `git revert` the commit. Every version is in history. |
| What changed, and when? | `PERSONAL_PASSWORD_ADMIN=… npm run audit` — decrypts each revision and prints a readable diff. |
| Prices stopped updating | Check the repository's issues; the daily job opens one on failure. Missing days cannot be backfilled. |
| A card shows no price | Either it is awaiting a catalog entry, or Cardmarket does not list it — see `public/data/catalog-overrides.json`. |
| The vault will not open | The password is the key; there is no reset. Restore `.local/` and re-run `npm run data:encrypt`. |

## Scheduled work

| Workflow | When | What |
|---|---|---|
| `prices.yml` | daily, 06:20 UTC | Snapshots prices, retries cards awaiting the catalog, commits. |
| `deploy.yml` | on push, and after `prices.yml` | Builds and publishes. |
| `data.yml` | on push and pull request | Schema, encryption and unit tests. |

The previous Angular version of this site is preserved on the `legacy-angular` branch.
