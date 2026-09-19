# valegian.github.io

Personal site of Valerio Giannini — built with [Astro](https://astro.build), deployed to
GitHub Pages by GitHub Actions.

It also hosts a private, password-gated Pokémon card collection tracker. The repository
itself is the database: card data and daily market-price snapshots are plain JSON files,
personal data is encrypted client-side before it is committed.

See [`PLAN.md`](./PLAN.md) for the architecture, the data sources and the phase-by-phase
plan. `PLAN.md` doubles as the progress log.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # static build into dist/
npm run preview  # serve the built output
npm run check    # type-check .astro files
```

Requires Node 20 or newer.

## Layout

| Path | Contents |
|---|---|
| `src/pages/` | routes |
| `src/layouts/`, `src/components/` | shared markup |
| `src/data/profile.json` | personal details, education and projects — read at build time |
| `public/` | files served verbatim, including the transcripts under `/resources/` |
| `.github/workflows/deploy.yml` | build and publish on every push to `master` |

The previous Angular 12 version of this site is preserved on the `legacy-angular` branch.
