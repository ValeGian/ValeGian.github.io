# Reading prices off Cardmarket by hand

**For a Claude session running locally, with a browser.** Valerio runs this when he has
time — not on a schedule. It is safe to skip days; the only thing that matters is not
reading the same card twice in one day.

---

## Why this exists

The daily job gets its figures from TCGdex, and two things are wrong with that:

1. **TCGdex's rolling averages have stopped moving.** `low` and `trend` match Cardmarket
   to the cent and change daily, but `avg30`, `avg7` and `avg1` were identical on 25 of 25
   mature cards across a refresh cycle. `avg30` is what the site prices on. See PLAN.md
   §8.4 for the evidence and the explanations that were ruled out.
2. **TCGdex does not carry every set.** The Japanese 30th Anniversary set (M6a) is not in
   its catalog at all, months after Cardmarket listed it.

Cardmarket has the numbers. It refuses automated clients — Cloudflare serves a challenge
to `curl` and the API cannot even fetch `robots.txt` — and the site's own JavaScript is
blocked by CORS. A real browser loads the pages normally, which is what this uses.

**This is not scraping infrastructure.** It is a person reading pages they are entitled to
read, at human pace, through their own browser. Keep it that way:

- Only load pages for cards that are actually outstanding. `price-todo` says which.
- One page at a time. Do not open pages in parallel or in a loop with no pause.
- If a page returns a Cloudflare challenge, **stop and say so.** Do not retry in a tighter
  loop, do not change the user agent, do not try to get around it.

---

## What the numbers mean

From Cardmarket's price guide, which is regenerated **once a day, early morning CET**:

| Field on the page | Meaning |
|---|---|
| **30-days average price** | mean of *completed sales* over the last 30 days — **this is the one we store** |
| 7-days average price | same, over 7 days |
| 1-day average price | same, over 1 day; often zero-sample on a quiet card |
| Price Trend | Cardmarket's smoothed market estimate, the "official" price on the page |
| From | cheapest listing right now (`low`) |

All of them mix conditions, languages and graded copies. That is why the site labels every
figure "all conditions". A card listed for less than 30 days still shows a 30-day average;
Cardmarket computes it over whatever sales exist, and that is accepted.

---

## Procedure

### 1. Know what day it is

The daily snapshot files are named by **UTC date**, and so is everything here. Late in a
European evening the UTC date is already tomorrow — get the date from the machine rather
than assuming:

```bash
date -u +%F        # the date to use everywhere below
```

### 2. See what is outstanding

```bash
npm run data:decrypt     # needs PERSONAL_PASSWORD_ADMIN; brings .local/ up to date
node scripts/price-todo.mjs
```

It prints two lists:

- **still to read** — cards with a card id whose price is missing, frozen, or a
  hand-checked figure gone stale. These can be priced directly.
- **need identifying first** — cards with no catalog entry at all. These need step 4
  before they can be priced.

A card already read by hand today is not listed. That is the whole guard against doing the
same card twice, so **do not work from a list you saved earlier in the session** — re-run
the script if in doubt.

If both lists are empty, there is nothing to do. Say so and stop.

### 3. Read a price

Find the product page. The URL shape is:

```
https://www.cardmarket.com/en/Pokemon/Products/Singles/<Expansion-Name>/<Card-Name>-<setcode><number>
```

The reliable way to get there is the expansion's singles list with a name search:

```
https://www.cardmarket.com/en/Pokemon/Products/Singles/<Expansion-Name>?searchString=<name>
```

Then **check you are on the right card before recording anything**:

- the number in the page title matches the card you wanted, e.g. `Moltres (105)`
- the expansion in the breadcrumb is the right one — `30th Celebration JP` and
  `30th Celebration` are different sets with different numbering
- the Japanese set is the one whose name ends `JP`

Read the block under "Available items". Record it:

```bash
node scripts/record-manual-price.mjs --card M6a-105 --avg30 10.29 \
  --avg7 10.29 --avg1 9.24 --low 6.99 --trend 9.61 \
  --url https://www.cardmarket.com/en/Pokemon/Products/Singles/30th-Celebration-JP/Moltres-V2-m6a105
```

`--avg30` is required; the rest are optional and worth including, because they cost
nothing now and cannot be recovered later. Use `--dry-run` first if unsure.

This writes into today's snapshot and into `latest.json`, marked `cardmarket/manual`, so
the site and the history always say where the figure came from.

### 3a. Do not harvest with `fetch()`

Loading pages by navigating to them works. Running `fetch()` in a loop from the page does
not: it was tried on 2026-09-20 and Cloudflare started answering with `Just a moment…`
after about a dozen calls. If that happens, **stop for the session and say so.** It clears
on its own; forcing it does not.

A set's card list can be walked a page at a time, and that is cheap. A price has to come
from the product's own page, one navigation each — so reading thirty prices is thirty
page loads, and is worth spreading over more than one sitting.

### 4. Identifying a card with no catalog entry

These are cards added from an English stand-in. **The English set's numbering is not the
Japanese set's**: Cardmarket lists the Japanese Moltres as `m6a 105` and `m6a 006`, where
the English set has its two Moltres at `011` and `130`. There is no offset and no pattern,
so the number has to be read off Cardmarket.

For the 30th Anniversary set this is already done and written down:
**`public/data/set-map-30th.json`** holds the pairs that have been checked card for card.
Use it rather than repeating the work, and **never extrapolate from it** — the offset is
6 across the Pikachu run and is demonstrably not 6 elsewhere in the set.

For a pair that is not in that file:

1. Open the English card to see the artwork: `https://assets.tcgdex.net/en/me/30th/023/high.png`
2. Find the matching card in the Japanese expansion on Cardmarket and compare. **Match on
   the artwork and the attack names, not the species** — the set has thirty Pikachus.
3. On a Cardmarket product page the carousel shows the previous and next products too.
   The product's own image is the one whose `alt` matches its name and which appears
   twice in the markup; the neighbours are marked `lazy`. Picking the wrong one showed a
   Wishiwashi labelled as Pikachu 017.
4. Product ids are **not** a reliable way to guess an image URL. They run in step with the
   card numbers in the low range and drift later in the set.
5. If you cannot tell them apart with confidence, **leave it and say which ones**. A wrong
   number attaches another card's price permanently.

Once the number is known, set it on the item in `.local/`, then re-encrypt:

```bash
# edit .local/wishlists/<owner>.json: set cardId to "M6a-105", number to "105"
npm run validate
PERSONAL_PASSWORD_ADMIN=… PERSONAL_PASSWORD_TOMMY=… PERSONAL_PASSWORD_LOTAD=… npm run data:encrypt
npm run data:watchlist
```

The card id is `<setCode>-<number>` on purpose: when TCGdex finally publishes M6a it will
use the same id, and the card will start being priced automatically with no further work.

### 5. Finish

```bash
npm run validate
npm run build          # only if anything under src/ changed
git add -A && git commit && git push
```

`.local/` is gitignored and must never be committed — the repository is public and its
history is append-only. `scripts/admin-commit.mjs` refuses to run if `.local/` is staged;
if committing by hand, check `git status` first.

---

## What not to do

- **Do not** fetch Cardmarket with `curl`, `fetch` from Node, or any headless browser. It
  will be blocked, and working around the block is out of bounds.
- **Do not** record a figure you did not read on the page for that exact card.
- **Do not** re-read a card already done today. Re-run `price-todo` to check.
- **Do not** guess a Japanese card number from its English twin.
- **Do not** put a hand-read figure into `catalog-overrides.json`. That file is for cards
  TCGdex will never carry, where the price is a standing fact rather than one day's
  reading. A reading for one day goes through `record-manual-price.mjs`.
