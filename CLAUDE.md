# valegian.github.io

Personal site and Pokémon card collection tracker. Astro, static, GitHub Pages. No server
and no database: the personal area is encrypted JSON in this public repository, decrypted
in the browser with a password.

## Read these first

- **`PLAN.md`** — the plan and the running log. §12 has what is still open, §13 is the
  progress log, newest first. Append to it; never rewrite history.
- **`PRICES-BY-HAND.md`** — the procedure for reading prices off Cardmarket in a browser,
  for cards TCGdex cannot price. **Follow it exactly when asked to fetch or update
  prices by hand.** Start with `npm run price:todo`.

## Things that are easy to get wrong

- **`.local/` holds plaintext and is gitignored.** The repository is public and its
  history is append-only, so one careless commit would be readable forever. Run
  `npm run data:decrypt` before editing it and `npm run data:encrypt` after.
- **A card id is `<setId>-<number>`**, and the number is the one printed on that card.
  A Japanese set does not share its numbering with the English release of the same cards
  — see PLAN.md §8.3. Never derive one from the other.
- **Encrypt before building.** `npm run build` copies `public/` into `dist/`, so building
  first leaves stale ciphertext in the output.
- **Do not fetch Cardmarket from a script.** Cloudflare blocks non-browser clients, and
  getting around that is out of bounds. See PRICES-BY-HAND.md.
- **A market link is harvested, never derived from a name.** `public/data/market.json`
  holds what was read off the two sites; anything missing falls back to a search scoped to
  the Japanese expansion and the card's number. A guessed product URL lands on the English
  printing sooner or later, which is the same trap as guessing a card number.

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `check` | Astro |
| `npm test` | unit tests (Node's runner, TypeScript stripped, no dependencies) |
| `npm run validate` | every data file against its schema |
| `npm run test:crypto` | encryption properties, against the real files |
| `npm run data:decrypt` / `data:encrypt` | plaintext in `.local/` ↔ ciphertext in `public/data/personal/` |
| `npm run data:watchlist` | rebuild the public watchlist and retry queue |
| `npm run data:snapshot` | take today's prices |
| `npm run price:todo` | what needs a price read by hand |
| `npm run price:record` | record one such reading |
| `npm run links:resolve` | find each card's page on PriceCharting |
| `npm run links:check` | open every harvested link and confirm it is that card |
| `npm run audit` | semantic diff of an encrypted file across git history |
