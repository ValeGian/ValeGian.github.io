# valegian.github.io — Rebuild + Personal Collection Tracker

**Status:** Phase 1 built locally, awaiting push approval (§13 rev 9)
**Owner:** Valerio Giannini
**Last updated:** 2026-09-19 (rev 9 — Phase 1 built locally)

This file is both the plan and the progress log. Section 13 is the running log —
append to it, never rewrite history. Checkboxes in §11 are the source of truth for
"what is next".

---

## 1. Goal

Replace the abandoned Angular 12 site with a coherent multi-section personal site, and
add a password-gated **Personal** area holding a Pokémon collection tracker and
wishlists — mine, plus one each for Tommy and Lotad, who I shop for in Japan and who can
check their list and what they owe me.

Scope for v1: **Japanese-language, ungraded, Near Mint single cards.** Graded slabs,
sealed product and Western cards are out of scope but must not be designed out.

Constraints: zero cost with **zero risk of ever being billed**, no database to
administer, **no server of any kind**, minimum ongoing maintenance, works on a Galaxy
S10 in a Japanese card shop with no signal.

---

## 2. Settled decisions

| # | Decision |
|---|---|
| 1 | Stay on **GitHub Pages**, keep `valegian.github.io`. Buy a domain later if ever. |
| 2 | **TCGdex** is the only catalog/price source. No API key anywhere. |
| 3 | Headline market value is Cardmarket **`avg30`**, verified against Cardmarket's own site. |
| 4 | **Astro** static site; the repo is the database. |
| 5 | Personal data **encrypted client-side** (WebCrypto, AES-256-GCM). |
| 6 | **I am the only writer.** Friends are read-only. **No server.** |
| 7 | My writes: **fine-grained PAT held in the browser**, repo-scoped, `contents: write`. |
| 8 | Admin password `cvalgian`; friends unlock with their own names. |
| 9 | Front page shows liteinfer, variantGPT and the SpecForge fork. |

### 2.1 Why rev 7 deleted a whole platform

Revisions 4–6 carried a Cloudflare Worker. It existed for exactly one reason: **GitHub
tokens have no per-path scope**, so *"Tommy may write `wishlists/tommy.enc` and nothing
else"* is inexpressible, and letting friends edit their own lists therefore needed an
authorisation layer that GitHub does not provide.

**Making friends read-only removes the requirement, not just the symptom.** With one
writer — me, the repo owner — authorisation is already solved by GitHub itself, and a
PAT is simply GitHub recognising me as myself.

What that deletes, permanently: the Cloudflare account, the Worker source, `wrangler`,
the Worker secret and its yearly rotation, the path allowlist, server-side rate
limiting, the `authProof`/HKDF split, 409 retry handling, CORS configuration, and the
break-glass script that existed to cover the Worker failing. **The entire Phase 5 of rev
6 disappears.**

What it costs: friends cannot add cards themselves — they tell me, I add it. Accepted as
a manual step; no tooling is being built for it.

---

## 3. Site map

```
/                       Front page — current bio + most recent projects
/projects               All projects, personal and academic
/university             Full academic history, recomposed
/personal        🔒     Unlock with a password. What you see depends on which one:
   ├── cvalgian         → Collection tab + all three wishlists + combined shopping view
   ├── tommy            → Tommy's list only, read-only
   └── lotad            → Lotad's list only, read-only
```

### 3.1 Front page

Bio as **AI Tech Lead / AI Inference Engineer**, plus recent non-university work:

| Project | What it is |
|---|---|
| **[liteinfer](https://github.com/ValeGian/liteinfer)** | Lightweight, hackable LLM inference engine built from scratch — paged KV cache, prefix caching, tensor parallelism, `torch.compile`, CUDA graphs. On PyPI. Main project. |
| **[variantGPT](https://github.com/ValeGian/variantGPT)** | GPT-2 with interchangeable attention: MHA, MQA, GQA, sliding-window, linear, sparse (BigBird), MLA (DeepSeek-V2). |
| **[SpecForge](https://github.com/ValeGian/SpecForge)** | Fork of `sgl-project/SpecForge` — speculative decoding training. Shown as an open-source contribution. |

✅ **Done 2026-09-19:** both repo descriptions were empty and are now set (§13).

### 3.2 University section

Everything kept — exams, transcripts, thesis, coursework — but recomposed: degree
summary cards, a real transcript table (PDFs stay as downloads), coursework grouped by
course instead of one flat list.

---

## 4. Data sources

### 4.1 TCGdex — the only source v1 needs

`https://api.tcgdex.net/v2/ja/...` — free, **no API key, no account, no billing
relationship of any kind**, `Access-Control-Allow-Origin: *`.

184 Japanese sets, using the **exact set IDs already in the spreadsheet** (capitalised,
zero-padded). Per card: Japanese name, rarity, official image, dex id, and
`pricing.cardmarket` (`low`, `avg`, `trend`, `avg1`, `avg7`, `avg30`, `idProduct`,
`updated`), refreshed daily.

**Match on variant, not just card.** `variants_detailed[]` carries a separate
`idProduct` and price block per printing (normal / holo / reverse). Picking the card and
ignoring the variant silently values the wrong product.

### 4.2 Price accuracy — verified against Cardmarket's own website

Checked in a real browser (Cardmarket 403s plain HTTP clients), 2026-09-19, against a
TCGdex snapshot stamped 2026-09-18 22:54 UTC:

| Card | Field | Cardmarket web | TCGdex | Δ |
|---|---|---|---|---|
| Giratina VSTAR s12a 261 | `low` | 142,50 € | 148 € | 3,9 % |
| | **`avg30`** | 258,62 € | 252,58 € | **2,3 %** |
| | `avg7` | 307,78 € | 241,53 € | 27 % ⚠ |
| Charizard ex sv2a 201 | `low` | 240,00 € | 240 € | **exact** |
| | **`avg30`** | 397,08 € | 399,08 € | **0,5 %** |
| | `avg1` | 250,00 € | 375 € | 33 % ⚠ |

1. TCGdex genuinely relays Cardmarket.
2. **`avg30` is the headline value.** Most stable, best agreement.
3. `avg1` / `avg7` hidden until the Phase 4 calibration week validates them.
4. **`low` is never presented as a value** — cheapest listing in *any* condition, damaged
   included. Confirmed by cross-checking tcggo's `lowest_near_mint` on the same product
   IDs: higher on every card above €3.

### 4.3 Near Mint — what it changes

**No query change.** TCGdex exposes no condition parameter and no free source has
condition-filtered *sold* averages for Japanese singles.

`avg30` is a **condition-blended** average of completed sales. Japanese singles sell
overwhelmingly NM, so on modern cards it tracks NM closely and if anything understates
it. The gap widens on the 1996 cards, where played copies are a large share of sales —
those are manual overrides anyway. `condition: "NM"` is recorded per card regardless: it
costs nothing and it is what you need the day you sell. UI label is honest: *"Cardmarket
30-day average, all conditions"*.

### 4.4 Historical prices

The Cardmarket/EUR series starts when the pipeline goes live and grows daily. Each
snapshot stores `avg7`/`avg30` alongside the spot value, so day one already has a 30-day
trailing view.

JustTCG was dropped on correctness grounds: its history is **TCGplayer/USD**, and
splicing that onto a Cardmarket/EUR series fabricates a step change at the join. A wrong
history is worse than a short one.

### 4.5 Rejected

| Source | Verdict | Reason (verified) |
|---|---|---|
| tcggo / RapidAPI | ❌ | Your key tested: Japanese catalog needs ULTRA, you're on BASIC. Useful once — it exposed the `low` vs `lowest_near_mint` distinction. |
| PriceCharting | ❌ | Paid; *"Historic prices and historic sales are not supported."* eBay/US/USD. |
| Cardmarket official API | ❌ | Approved professional sellers only. |
| pokemontcg.io / Scrydex | ❌ | English sets only. |

### 4.6 FX

`api.frankfurter.dev` — free, no key, CORS `*`, ECB rates, historical dates. Used for
**new** yen purchases. Your existing `0,006169` figures are the rates you actually paid
at and are kept verbatim.

---

## 5. Cost, and whether the repo can grow forever

### 5.1 €0, structurally

**No payment method exists anywhere in the stack, and after rev 7 there is not even a
second account:**

| Component | Account | Billing possible |
|---|---|---|
| TCGdex | none — no key, no signup | no such thing as a bill |
| Frankfurter FX | none | no |
| GitHub Pages + Actions | yours, existing | free; **unlimited Actions minutes on public repos** |
| Repo as database | — | free |

| Collection size | API calls/day | Actions runtime/day | Cost |
|---|---|---|---|
| 46 (today) | ~46 | ~15 s | €0 |
| 500 | ~500 | ~2 min | €0 |
| 2 000 | ~2 000 | ~8,5 min | €0 |

### 5.2 The repo cannot grow infinitely — the real limits

| Limit | Value | Kind |
|---|---|---|
| Repository size | < 1 GB recommended, < 5 GB strongly | soft — warning email past 5 GB |
| **Published Pages site** | **1 GB** | **hard** |
| Single file | 100 MiB | hard |
| Pages bandwidth | 100 GB/month | soft |

Git history is append-only, so deleting a file never shrinks the repo.

| Collection size | Repo growth/year | Years to the 5 GB warning |
|---|---|---|
| 46 | 0,7 MB | ~7 000 |
| 500 | 7,5 MB | ~660 |
| 2 000 | 30 MB | ~165 |

Finite, irrelevant in any human timeframe. Levers if it ever mattered: downsample
history older than 12 months to weekly, move archived years to a Release asset, or reset
history on an orphan branch. Not scheduled work — written down so the answer exists.

**One rule this does force: card images are never committed.** They are hot-linked from
`assets.tcgdex.net`. Photos of pending cards are the exception, resized to ≤ 200 KB.

---

## 6. Architecture

```
valegian.github.io/
├── src/                            Astro site
│   ├── pages/
│   │   ├── index.astro             bio + recent projects
│   │   ├── projects/  university/
│   │   └── personal/               🔒 gated island
│   └── components/ layouts/ styles/
├── public/                         ← copied verbatim into the build output
│   ├── favicon.ico
│   ├── resources/                  degree transcripts (PDF)
│   └── data/                       ← everything fetched at runtime
│       ├── watchlist.json          cardIds to price. No owners, no prices, no targets.
│       ├── prices/latest.json
│       ├── prices/daily/2026-09-19.json
│       ├── fx/rates.json
│       ├── catalog-overrides.json
│       ├── photos/
│       └── personal/               ← ciphertext. I write all of it.
│           ├── keyring.enc         every file key, wrapped under `cvalgian`
│           ├── collection.enc
│           ├── valerio.enc         my wishlist
│           ├── tommy.enc           Tommy's list + purchases + settlements
│           └── lotad.enc
├── scripts/                        snapshot-prices · resolve-pending · build-watchlist
│                                   migrate-sheet · audit · admin-commit
└── .github/workflows/              deploy.yml · prices.yml
```

**Data lives under `public/`, split by when it is read.** Build-time content
(`profile.json`) sits in `src/data/` and is imported; anything the browser or the daily
Action fetches at runtime sits in `public/data/` and is served verbatim at `/data/…`.
That means the price job writes straight to the path the site serves, with no copy step
and no build indirection. *(Deviation from rev 7, which put these at the repo root;
adopted in Phase 1 because Astro already serves `public/` unmodified.)*

**Why the plaintext vs `personal/` split matters.** The price pipeline only needs to know
*which cards to price*. `watchlist.json` is the union of every cardId across the
collection and all wishlists, with no owner, no price paid and no target. So the daily
Action never touches personal data and **never needs a decryption key**.

**One file per person, not two.** Rev 6 split each friend into a writable wishlist and a
read-only ledger, so the server could enforce "friends can't touch bought cards" at the
path level. With friends read-only that enforcement has no job to do, so the split is
deleted and each friend is a single file holding their wanted cards, their purchases and
their settlements.

### 6.1 Collection item

```json
{
  "id": "itm_0001",
  "status": "resolved",
  "cardId": "S12a-261", "variantId": "jr7oetx1mqug9",
  "setId": "S12a", "number": "261",
  "nameJa": "ギラティナVSTAR", "nameEn": "Giratina VSTAR",
  "condition": "NM", "isGraded": false, "quantity": 1,
  "purchase": {
    "date": "2026-10-01", "dateIsBootstrap": true,
    "amount": 140, "currency": "EUR",
    "amountEur": 140.0, "fxRate": 1.0, "fxSource": "user-recorded"
  },
  "acquiredFrom": null, "notes": ""
}
```

`amountEur` and `fxRate` are **frozen at purchase time and never recomputed.**

### 6.2 Friend file

```json
{
  "owner": "Tommy",
  "items": [
    {
      "id": "wish_0007",
      "status": "wanted",
      "cardId": "M6-113",
      "nameJa": "メガレックウザex", "nameEn": "Mega Rayquaza ex",
      "setId": "M6", "number": "113",
      "targetPriceEur": 400,
      "priority": "high",
      "notes": "only if well centred, no back whitening",
      "addedAt": "2026-09-20"
    },
    {
      "id": "wish_0003",
      "status": "bought",
      "cardId": "SV2a-201",
      "boughtAt": "2026-10-14",
      "targetPriceEur": 350,
      "purchase": { "amount": 52000, "currency": "JPY",
                    "amountEur": 287.6, "fxRate": 0.00553, "fxSource": "frankfurter" },
      "notes": "Akihabara, Hareruya2"
    }
  ],
  "settlements": [ { "date": "2026-11-02", "amountEur": 150, "note": "cash" } ]
}
```

`targetPriceEur` is the friend's own number, relayed by them, never market-derived. The
UI shows it next to the live `avg30` with an *under / over target* marker.

`owes = Σ(bought items' amountEur) − Σ(settlements)`, **computed, never stored**, so it
cannot drift from the purchases behind it.

**My own list behaves differently on purchase:** a bought item becomes a collection item
and leaves `valerio.enc`, with `acquiredFrom` preserving the link. A friend's item stays
in their file, flips to `bought`, and feeds their balance. Friends' cards must never
touch my portfolio totals — that is a unit test in Phase 7.

### 6.3 Pending cards — for the Japan trip

`status: "pending"` is a first-class state. Add a card the catalog has never heard of by
typing what you know, plus a photo:

```json
{
  "id": "itm_0192", "status": "pending",
  "hint": { "setName": "30th Celebration", "setCode": "M6a", "number": "045",
            "nameJa": "ピカチュウ" },
  "photoUrl": "data/photos/itm_0192.jpg",
  "purchase": { "date": "2026-10-14", "amount": 1200, "currency": "JPY",
                "amountEur": 6.64, "fxRate": 0.00553, "fxSource": "frankfurter" },
  "pendingSince": "2026-10-14"
}
```

The daily job re-queries TCGdex by set code + number + name and promotes on a hit.
Surfaced as a **"Pending catalog data (N)"** panel with days-waiting, a GitHub Issue
updated on each resolution, and a flag past 60 days.

Purchase price, quantity, photo and trip-spend totals all work while pending. Market
value shows *"awaiting data"* — never €0, which would silently drag down totals.

**Measured lag (2026-09-19):** 30th Celebration released worldwide 2026-09-16, JP code
**M6a**. TCGdex Japanese `M6a`: **absent (404)**. TCGdex English `30th`: catalogued on
release day, 158 cards, **no prices**. Previous JP set `M6` ストームエメラルダ
(2026-07-31): complete and fully priced. **A set bought on release day in Japan will sit
pending for weeks.** That is the case this design exists for.

---

## 7. Security

Three roles, but only one of them writes.

### 7.1 Encryption is the access control

The repo is public, so every personal file is ciphertext. With no server, the password
is not a curtain over plaintext — **it is the decryption key**, and it is the only thing
standing between a stranger and the data. That is what makes a "friend account" mean
something without any account system, signup, or email.

- Each file has a random **AES-256-GCM** key `K_file`.
- `K_file` is wrapped under `PBKDF2-SHA256(password, per-file salt, 600 000 iterations)`.
- `keyring.enc` holds every `K_file` wrapped under `cvalgian`, so my password opens
  everything — collection, all three lists, the combined shopping view.
- A friend's password opens exactly one file.

No key, proof or password ever leaves the browser: there is nowhere to send it.
Rev 6's `authProof`/HKDF split existed solely to keep the Worker from being able to
decrypt; with no Worker, it is deleted.

Changing a password re-wraps that file's `K_file` and nothing else.

### 7.2 My write path

A **fine-grained PAT**, scoped to this one repository, `contents: write` and nothing
else, pasted once into the admin screen and held in `localStorage`. Writes go through the
GitHub Contents API. Chosen over editing JSON on a laptop because adding cards happens in
a shop in Japan, on a phone.

**Residual risk, stated plainly.** `localStorage` is readable by any script running on
the origin, so an XSS bug on my own site could exfiltrate the token. The site has no
user-generated content and no third-party scripts, which is where XSS normally comes
from, but the risk is not zero. What bounds it: the token writes one public repo whose
contents are already public, and `contents: write` **cannot touch `.github/workflows/`**
— that needs a separate permission it will not have. The worst outcome is commits I
revert and a token I rotate. No money, no private data, no other repo reachable.

**Mitigations, all Phase 5:** one-year expiry with a calendar reminder; an explicit
*Forget token on this device* button; the token never written to a file, URL or log;
writes batched so a shopping session is one commit rather than forty; a visible
*N unsynced* badge so a failed flush cannot pass unnoticed.

### 7.3 Honest assessment of `cvalgian`

Eight lowercase letters derived from your handle. Against a generic attacker with
PBKDF2 at 600 k iterations this is expensive — roughly 2×10¹¹ candidates, hundreds of
GPU-years. Against someone who knows you and builds a wordlist of *your-name variants*,
it is a small search space.

The exposure is **read-only and offline**: the ciphertext is public and can be attacked
forever. What is behind it is card purchase prices and a small IOU ledger. Note that with
rev 7 the password no longer authorises any write — it only decrypts — so a guess cannot
change anything, only read.

Proportionate, and `cvalgian` is fine. If you want free margin, append three or four
random characters — `cvalgian-7q2f` — which moves it out of any plausible name wordlist
at no usability cost. Your call; not a blocker.

Friends' passwords being their own first names means their lists are protected against
casual discovery only. For a card wishlist and a small balance that is the right level —
just don't put anything else in there.

### 7.4 Audit log — still worth having

Git stores every revision forever, but `.enc` files diff as opaque blobs, so GitHub's
diff view is useless on them. `scripts/audit.mjs` (~40 lines) walks `git log` for a file,
decrypts each revision with the keyring, and prints a **semantic diff** — items added,
removed, fields changed, old value → new value, with timestamps.

With one writer its job changes from catching other people to catching *me*: a mis-tap
that overwrote a purchase price, or a stale offline queue that flushed an old copy of a
list. Combined with `git revert`, that is a complete recovery story. Phase 7.

---

## 8. Feature spec

### 8.1 Collection tab — admin only

| # | Feature | Detail |
|---|---|---|
| 1 | **Add card** | Name search (JA or EN) → live TCGdex results with thumbnails → pick printing **and variant** → fields auto-fill → enter price + currency → FX for that date → commit. Unknown card → `pending`. |
| 2 | **Delete card** | One tap, confirm. Git history is the undo. |
| 3 | **Search + filter** | Free text (JA+EN), set, series, rarity, condition, **purchase-date range**, paid range, value range, P&L range, gainers/losers, pending-only. Client-side. |
| 4 | **Card detail** | Image, `avg30`, value chart, paid price, absolute and % P&L, plus **source + `updated` timestamp on every price**. |
| 5 | **Collection totals** | Invested, current value, P&L, value-over-time chart, best/worst performers, per-set breakdown. |
| 6 | **Trip spend** | The date-range filter drives a persistent summary bar — *cards bought, total spent, current value, P&L* for the window. Presets: *Japan trip*, *this month*, *this year*, *all time*. |

### 8.2 Wishlists

| # | Feature | Who | Detail |
|---|---|---|---|
| 7 | **Own list** | friend, read-only | One list. Wanted cards show target price beside live `avg30` with an *under / over target* marker. Bought cards sit inline, greyed, badged `✓ bought €287,60`. |
| 8 | **Balance** | friend, read-only | Running **total owed** at the top; every purchase and every settlement itemised below it. No surprises, no need to ask. |
| 9 | **Combined shopping view** | admin | **Every wanted card across all three lists on one flat page**, owner badge per row, sorted by priority then set. Filters: owner, set, under-target-only, priority. Built for walking a shop without switching tabs. |
| 10 | **Manage any list** | admin | Add, edit, delete, reprioritise items on my list and both friends' lists. |
| 11 | **Mark bought** | admin | One tap → price in ¥ or € → FX applied → *my* item moves to the collection; a *friend's* item flips to `bought` in place and lands in their balance. |
| 12 | **Settlements** | admin | Record a repayment against a friend's balance. |

### 8.3 What read-only friends cost

Every wishlist change comes through me: they message me a card, I add it with the same
picker I use for my own (feature 10). Accepted as a manual step — no importer, no paste
format, no public search page. If it ever becomes tedious, a bulk importer is ~50 lines
and can be added then.

---

## 9. Mobile — designed for a Galaxy S10 in a shop

The S10 is **360 × 760 CSS px**. That is the design target, not an afterthought.

- **No tables on mobile.** The collection is a list of cards — thumbnail, name, paid,
  current value, P&L delta. Tables appear at ≥ 768 px.
- **Shopping mode is the phone's primary view.** Large rows, 44 px minimum touch targets,
  target price and market price side by side, owner badge, one prominent *Bought* button.
  No hover-only affordances anywhere.
- **Thumb-reachable actions** in a bottom bar, not a top-right corner.
- **Filters in a bottom sheet**, with active filters as removable chips.
- **Works offline.** Data cached in IndexedDB; the app opens and is fully usable with no
  signal; writes queue and flush on reconnect behind an explicit *N unsynced* badge.
  Japanese shop basements have no signal.
- **Currency entry defaults to ¥** while the trip date range is active.
- **Charts are touch-first** — tap for a readout, no hover tooltips, collapse to
  sparklines below 400 px.
- Thumbnails lazy-loaded from `assets.tcgdex.net`; full art only on the detail view.
- Friends' read-only view is the same layout minus every edit affordance — not a
  disabled-looking version of the admin UI.

---

## 10. Migration

### 10.1 The 3 unmatched cards — all resolved, no photos needed

**`CLK` #1 Squirtle.** Cardmarket lists it as *Squirtle (CLK 001)* in "Pokémon Card Game
Classic: Blastoise & Suicune ex Deck" — **avg30 €19,53** against the ¥650 (€4,01) paid.
Your `CLK` code came straight from Cardmarket. TCGdex has no Classic-deck sets in any
language → `catalog-overrides.json`, price refreshed by hand, `source: manual`.

**The two "Expansion Pack" cards — solved.**

> **1996 Japanese cards print the National Pokédex number, not a collector number.** Your
> Charmander reads **No.004** because Charmander is dex #4. It is the 14th card in the set.

| Your row | Real card | localId | dexId |
|---|---|---|---|
| Bulbasaur #1 | `PMCG1-001` フシギダネ | 001 | **1** ✔ |
| Charmander #4 | `PMCG1-014` ヒトカゲ | **014** | **4** ✔ |
| *(control)* | `PMCG1-004` ビードル | 004 | 13 — Weedle, not yours |

Both from 拡張パック (1996-10-20). TCGdex carries no Cardmarket prices for this set →
manual overrides. Cardmarket has them under expansion "Expansion Pack" (from €0,34 and
€0,50) and **does not number that set at all**, which is why no lookup could have
matched. This is also where the NM caveat in §4.3 matters most.

### 10.2 Settled inputs

- **FX**: `0,006169` figures kept verbatim, `fxSource: "user-recorded"`.
- **Purchase dates**: existing cards get the bootstrap date, flagged
  `dateIsBootstrap: true` so charts never imply unmeasured history.
- **Condition**: all NM.
- **Bio**: AI Tech Lead / AI Inference Engineer.

### 10.3 Other sheet defects

Name drift between tabs and `Set Id = "-"` on two rows both disappear once `cardId` is the
key. The `Market Values` tab (`—` everywhere, `#ERROR!` total) is replaced.

### 10.4 Japanese ↔ English names

From **PokéAPI** `/pokemon-species/{id}` (`ja-Hrkt` + `en`, verified リザードン ↔
Charizard) plus a suffix map (`ex / V / VSTAR / VMAX / …`). Generated at build time into a
static lookup, never fetched at runtime.

---

## 11. Phases

### Phase 1 — Repo reset  ✅ local, awaiting push
- [x] Archive Angular app on branch `legacy-angular`
- [x] Strip `src/`, `angular.json`, `karma.conf.js`, `package-lock.json`, `docs/`
- [x] Scaffold Astro 5.18, wire `deploy.yml` to Pages
- [x] Port `resources/me.json` → `src/data/profile.json`; transcripts to `public/resources/`
- [ ] **Blocked on two approvals:** push to `master`, and switch the Pages source from
      `legacy` (master `/docs`) to `workflow`. Both must happen together — see §13 rev 9.
- [ ] Hello-world deploy green

### Phase 2 — Design system + public sections
- [ ] Type/spacing/colour tokens, light + dark, 360 px-first
- [ ] Layout + navigation
- [ ] Front page: bio + liteinfer / variantGPT / SpecForge
- [ ] Projects section
- [ ] University section, recomposed
- [ ] Lighthouse ≥ 95 on all, verified at 360 px

### Phase 3 — Data layer
- [ ] Schemas + CI validation: collection, friend files, overrides
- [ ] `migrate-sheet.mjs`: 46 cards, FX verbatim, bootstrap dates, condition NM
- [ ] `catalog-overrides.json`: CLK Squirtle, PMCG1-001, PMCG1-014
- [ ] `pending` state modelled end to end
- [ ] `build-watchlist.mjs` → public `watchlist.json`
- [ ] JA↔EN name table generated at build
- [ ] Totals reconcile to €1218,97

### Phase 4 — Price pipeline
- [ ] `snapshot-prices.mjs` — TCGdex, variant-aware → `latest.json` + `daily/<date>.json`
- [ ] `resolve-pending.mjs` — retry, promote, open issue
- [ ] `prices.yml` daily cron, commit only on change
- [ ] **Calibration week**: daily snapshots vs 3 manual Cardmarket spot-checks; confirm
      `avg7`/`avg1` semantics before either is surfaced
- [ ] Frankfurter FX for new purchases
- [ ] Liveness + staleness alerting

### Phase 5 — Crypto + write path
- [ ] WebCrypto module: PBKDF2 → AES-GCM wrap/unwrap, keyring
- [ ] `encrypt-personal.mjs` — one-shot migration of plaintext data to `.enc`
- [ ] Unlock screen; three roles resolved purely by which file a password opens
- [ ] PAT admin unlock, Contents API writes, offline queue, batched commits,
      *N unsynced* badge, *Forget token*
- [ ] `scripts/admin-commit.mjs` — laptop fallback if the browser path ever fails
- [ ] Tests: a friend password opens exactly one file and nothing else

### Phase 6 — Personal area UI
- [ ] Collection tab: list/table, filters, detail, charts, totals
- [ ] Trip-spend date-range summary
- [ ] Wishlists: per-list view, combined shopping view, both mark-bought behaviours
- [ ] Friend read-only view + balance + settlements display
- [ ] Add/delete/edit + TCGdex picker + pending path + photo upload
- [ ] Mobile pass on a real 360 px viewport

### Phase 7 — Hardening
- [ ] `scripts/audit.mjs` — decrypt-and-diff history (§7.4)
- [ ] Unit tests: FX, P&L, balance arithmetic, wishlist→collection transition,
      **friend items never entering collection totals**, pending promotion, schema
      validation
- [ ] Integration test against recorded TCGdex fixtures
- [ ] README: add a card, recover, rotate the PAT, restore from backup, reset a password
- [ ] Retire the spreadsheet (final CSV into `data/archive/`)

---

## 12. Still open

1. **Bio copy** — a few lines for the front page. Deferred by you; needed in Phase 2.
2. *(optional)* Strengthen `cvalgian` with a random suffix (§7.3). Recommended, not a
   blocker.
3. *(optional, later)* JustTCG as a clearly-separate TCGplayer/USD series. Default: no.

---

## 13. Progress log

### 2026-09-19 — rev 9 (Phase 1 built locally)
- Angular app archived on branch `legacy-angular` at `cdc4519`, the last 2022 commit.
- Stripped Angular: `src/app`, `angular.json`, `karma.conf.js`, the old lockfile,
  `.browserslistrc`, the split tsconfigs, and the committed `docs/` build output.
- Scaffolded **Astro 5.18.2** on Node 22: `package.json`, `astro.config.mjs` (site set,
  no `base` since this is a user-level Pages site), strict tsconfig with `@layouts`,
  `@components` and `@data` aliases, a minimal `BaseLayout.astro` and a placeholder
  `index.astro`. `npm run build` and `npx astro check` both clean, 0 errors.
- Ported `resources/me.json` → `src/data/profile.json`, restructured into
  identity / links / education / experience / skills / projects. 13 projects, the three
  current ones flagged `featured`. Transcripts moved to `public/resources/`, served at
  the paths `profile.json` references. The old favicon was recovered from git into
  `public/`.
- **Left blank rather than invented:** `identity.bio` (flagged
  `bioStatus: "placeholder"`), `education[0].endYear` for the master's, and `experience`
  entirely. Also noted: `me.json` held **no exam or transcript data** — the university
  material in the repo is only the two PDFs plus the university-tagged projects, so
  "keep all university material" currently means exactly that. If you want a real exam
  table in the CV section, that data has to come from you.
- Adjusted the data layout (§6): runtime-fetched files go in `public/data/`, build-time
  content in `src/data/`. Astro serves `public/` verbatim, so the price job writes
  straight to the served path with no copy step.
- Committed locally as `bd375c5`. **Not pushed.**

  **Two approvals needed, and they must happen together.** Pages is currently
  `build_type: legacy`, serving `master` `/docs` — the directory this commit deletes.
  Pushing without switching Pages to `workflow` would take valegian.github.io down until
  the setting changes. The switch is
  `gh api -X PUT repos/ValeGian/ValeGian.github.io/pages -f build_type=workflow`, or the
  Pages settings page.

### 2026-09-19 — rev 8 (bulk importer dropped)
- **Removed the bulk-paste importer, its paste format, and the public card search page**
  added in rev 7. Friends message me a card, I add it with the picker I already use for
  my own. Rev 7 invented tooling for a friction the owner is happy to absorb manually;
  removing it cuts two Phase deliverables and a whole public page. Noted in §8.3 that a
  bulk importer is ~50 lines if it ever becomes tedious.

### 2026-09-19 — rev 7 (read-only friends; server dropped)
- **Friends become read-only, and the Cloudflare Worker is deleted.** The Worker existed
  only because GitHub tokens have no per-path scope, which made autonomous friend edits
  impossible to authorise on a static site. Removing the edit requirement removes the
  requirement itself rather than working around it.
- Deleted permanently: Cloudflare account, Worker source, `wrangler`, Worker secret and
  its yearly rotation, path allowlist, server-side rate limiting, `authProof`/HKDF split,
  409 retry handling, CORS config, and the break-glass script that existed to cover the
  Worker failing. **The whole of rev 6's Phase 5 is gone.**
- **Friend files merged from two into one.** The wishlist/ledger split existed so a
  server could enforce "friends can't touch bought cards" at the path level; with no
  writes to enforce, it has no job. One file per person now holds wanted cards,
  purchases and settlements.
- **Crypto simplified**: the password is now purely a decryption key, since there is
  nowhere to send a proof. A guessed password can read, never write.
- Back to a **browser-held fine-grained PAT** for my own writes (rev 3's design), now the
  only credential in the system. Noted that `contents: write` cannot reach
  `.github/workflows/`, which bounds the worst case further.
- **Added the bulk-paste importer** (§8.3) plus a *Copy request line* button on a public
  card search — the one real cost of read-only friends is that wishlist changes come
  through me, and this turns forty messages into one paste.
- Audit log kept, with its purpose restated: with one writer it exists to catch my own
  mistakes, not other people's.

### 2026-09-19 — rev 6 (audit log analysed)
- Audit log adopted: git stores every revision, but `.enc` diffs are opaque, so
  `scripts/audit.mjs` decrypts each revision and prints a semantic diff.
- Established that it could **not** substitute for the Worker: a log records changes, it
  does not create the ability to make them, and the shared-PAT alternative destroys
  attribution because the Contents API lets the caller set the commit author and defaults
  it to the token owner. *(Superseded by rev 7, which removes the question.)*

### 2026-09-19 — rev 5 (clarifications)
- Corrected an overstatement in rev 4: *writing* never needed a server — I own the repo.
  What friends needed was **per-path authorisation**, which GitHub cannot express.
- Adopted UI-level locking as the presentation: one list, bought cards greyed and locked
  inline, no visible split.

### 2026-09-19 — rev 4 (friend write access, Worker API, encryption)
- Set both GitHub repo descriptions, which were empty:
  - `liteinfer` → *"A lightweight, hackable LLM inference engine built from scratch —
    paged KV cache, prefix caching, tensor parallelism, torch.compile and CUDA graphs,
    each isolated and benchmarkable."*
  - `variantGPT` → *"Research framework for training GPT-2 with interchangeable attention
    mechanisms — MHA, MQA, GQA, sliding-window, linear, sparse (BigBird) and MLA
    (DeepSeek-V2) — compared under identical conditions."*
- Designed client-side encryption: per-file AES-256-GCM key, PBKDF2 600 k, admin keyring.
- Settled: staying on `valegian.github.io`; SpecForge shown on the front page.

### 2026-09-19 — rev 3 (Personal section, wishlists, ledgers)
- **Resolved the last two orphan cards without a photo.** 1996 Japanese cards print the
  National Pokédex number: "Charmander #4" is `PMCG1-014` (dexId 4), "Bulbasaur #1" is
  `PMCG1-001`. `PMCG1-004` is Weedle, dexId 13.
- **Near Mint**: no query change possible; `avg30` is condition-blended, close to NM on
  modern cards, looser on the 1996 ones.
- **Repo growth**: not infinite — 1 GB recommended / 5 GB warning / **1 GB hard cap on
  the published Pages site**. At 500 cards the warning is ~660 years out. Card images are
  never committed.
- **Domain**: free on Pages, registration is not (~€10–15/yr). RDAP-checked;
  `valeriogiannini.com`, `valeriogiannini.dev`, `valegian.dev`, `valegian.com`,
  `vgiannini.dev`, `giannini.dev` all available. Decision: stay put, buy later.
- Designed the Personal area, trip-spend summary, and the 360 × 760 mobile approach.

### 2026-09-19 — rev 2 (price verification, zero-key architecture)
- Verified TCGdex against Cardmarket's own website in a real browser. `low` matched
  exactly once, `avg30` within 0,5–2,3 % twice, `avg1`/`avg7` diverged up to 33 %
  → **headline changed from `trend` to `avg30`**, volatile fields gated.
- Cross-checked tcggo on shared product IDs: identical on €0,02 commons, higher above €3,
  because it reports `lowest_near_mint` while `low` includes damaged copies.
- **Dropped JustTCG from v1** — TCGplayer/USD history spliced onto a Cardmarket/EUR series
  would fabricate a step change.
- Identified the CLK Squirtle on Cardmarket (avg30 €19,53 vs €4,01 paid).
- Measured Japan-trip lag: JP `M6a` absent, EN `30th` catalogued but unpriced, `M6`
  complete and priced. Designed the `pending` state around it.

### 2026-09-19 — rev 1 (initial research)
- Read the spreadsheet via public CSV export — **no auth required, anyone with the link
  can read it**; restrict sharing if unintended.
- Cloned the repo. Angular 12, last commit 2022-10-08, content in `resources/me.json`.
- Evaluated 9 candidate data sources with live calls. Confirmed the RapidAPI BASIC plan is
  blocked from the Japanese catalog (`required_plan: ULTRA`).
- Matched 43/46 rows to TCGdex with EUR prices.
- Baseline: paid **€1218,97**, current value **€2620,56** on `avg30`, **+115 %**.
- Compared GitHub Pages / Cloudflare / Netlify / Vercel → staying on Pages.
