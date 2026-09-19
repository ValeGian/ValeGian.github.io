# valegian.github.io — Rebuild + Personal Collection Tracker

**Status:** All seven phases done. Open items in §12.
**Owner:** Valerio Giannini
**Last updated:** 2026-09-19 (rev 21 — wishlist add flow)

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

Everything kept — exams, transcripts, coursework — but recomposed: degree summary cards,
a real exam table per degree (PDFs stay as downloads), coursework projects grouped by
course instead of one flat list.

Exam data now lives in `src/data/transcripts.json`, extracted from the two PDFs
(§13 rev 11). **The student ID in both PDFs is deliberately not carried over** — it is a
personal identifier with no reason to be on a public page. Note the PDFs themselves are
served publicly at `/resources/…` and do contain it; if that matters, they should be
redacted or moved behind the gate.

Derived figures — weighted averages, credit totals — are **computed in the component,
never stored**, so they cannot drift from the exam rows behind them.

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

### Phase 1 — Repo reset  ✅ **complete**
- [x] Archive Angular app on branch `legacy-angular`
- [x] Strip `src/`, `angular.json`, `karma.conf.js`, `package-lock.json`, `docs/`
- [x] Scaffold Astro 5.18, wire `deploy.yml` to Pages
- [x] Port `resources/me.json` → `src/data/profile.json`; transcripts to `public/resources/`
- [x] Switch Pages `build_type` from `legacy` to `workflow`
- [x] Hello-world deploy green — run 35459651204, https://valegian.github.io/ HTTP 200

### Phase 2 — Design system + public sections  ✅ **complete**
- [x] Type/spacing/colour tokens, light + dark, 360 px-first
- [x] Layout + navigation
- [x] Front page: bio + liteinfer / variantGPT / SpecForge
- [x] Projects section
- [x] University section, recomposed
- [x] 360 px verified with zero horizontal overflow on all three pages; AA contrast on
      both themes; zero client JavaScript shipped

### Phase 3 — Data layer  ✅ **complete**
- [x] Schemas + CI validation: collection, overrides, watchlist
- [x] `migrate-sheet.mjs`: 46 cards, FX verbatim, bootstrap dates, condition NM
- [x] `catalog-overrides.json`: CLK Squirtle, PMCG1-001, PMCG1-014
- [x] `pending` state modelled end to end, with schema tests both ways
- [x] `build-watchlist.mjs` → public `watchlist.json`, 43 cards
- [x] JA↔EN name table generated from PokéAPI, translates 45/45
- [x] Totals reconcile to €1218,97
- [ ] Friend-list schema — deferred to Phase 6, when the wishlist UI defines its shape

### Phase 4 — Price pipeline  ✅ **built**
- [x] `snapshot-prices.mjs` — TCGdex, variant-aware → `latest.json` + `daily/<date>.json`
- [x] `resolve-pending.mjs` — retry, publish the answer, open an issue
- [x] `prices.yml` daily cron at 06:20 UTC, commit only on change; verified end to end
- [x] Liveness alerting: one reusable issue on failure, not one per day
- [x] `build-watchlist.mjs` also emits `pending.json`
- [x] **Calibration automated** — `scripts/calibrate.mjs` runs in the daily job and
      answers the `avg7`/`avg1` question from the snapshots themselves. No manual week.
- [ ] Staleness banner in the UI — needs the UI; moved to Phase 6
- [x] ~~Frankfurter FX cache~~ — **dropped.** The rate is looked up once when a card is
      added and frozen into the purchase record, so there is nothing to cache. A daily
      rates file would have been a rewritten file earning its keep for nobody.

### Phase 5 — Crypto + write path  ✅ **built**
- [x] WebCrypto module: PBKDF2 → AES-GCM wrap/unwrap, keyring
- [x] `encrypt-personal.mjs` — plaintext under `.local/` → `.enc` under `public/data/`
- [x] Unlock screen; roles resolved purely by which file a password opens
- [x] Batched commit client (Git Data API, one commit per save, never forces a ref)
- [x] `scripts/admin-commit.mjs` — laptop break-glass, refuses to run if `.local/` is staged
- [x] Tests: 24 checks, including that a friend password opens exactly one file
- [ ] PAT unlock UI, offline queue, *N unsynced* badge, *Forget token* — these are
      interface, so they move to Phase 6 with the rest of the UI

### Phase 6 — Personal area UI  ◐ **read side done, write side next**
- [x] Collection tab: list, filters, sort, detail, totals
- [x] Trip-spend date-range summary (the date filter drives the figures)
- [x] Wishlists: per-list view, combined shopping view, target vs market
- [x] Friend read-only view + balance + settlements
- [x] Mobile verified at a true 360 px viewport
- [x] Add and delete cards, TCGdex picker, pending path
- [x] PAT unlock, offline queue, batched commits, unpublished-count badge, Forget token
- [x] Mark bought, both behaviours
- [x] Staleness banner
- [ ] Editing an existing card in place (delete-and-re-add works today)
- [ ] Photo upload for pending cards
- [ ] Value-over-time charts — needs more than one day of history

### Phase 7 — Hardening  ✅ **complete**
- [x] `scripts/audit.mjs` — decrypt-and-diff history
- [x] 30 unit tests: P&L, totals, filters, sorting, ledger balance,
      wishlist→collection transition, **friend items never entering collection totals**,
      key stability, watchlist privacy
- [x] README: add a card, recover, rotate the PAT, change a password
- [x] Spreadsheet archived — **to `.local/archive/`, not `data/archive/`**: it holds
      purchase prices, and the append-only rule applies to it too
- [x] CI runs schema, encryption and unit tests on every push
- [ ] Integration test against recorded TCGdex fixtures — the live calls are covered by
      the pipeline running daily; deferred as low value

---

## 12. Still open

0. **Before the Japan trip:** create the fine-grained PAT and confirm one **Publish**
   from the browser. The ref update is the only step never exercised (§13 rev 17).
   Everything else that was outstanding is now automated or answered.
1. **Bio copy** — a few lines for the front page. Deferred by you; needed in Phase 2.
2. *(optional)* Strengthen `cvalgian` with a random suffix (§7.3). Recommended, not a
   blocker.
3. *(optional, later)* JustTCG as a clearly-separate TCGplayer/USD series. Default: no.
4. **Public watchlist, or encrypted with an Actions secret?** It lists which cards are in
   the collection, nothing more. Default: leave it public (§13 rev 13).

---

## 13. Progress log

### 2026-09-19 — rev 21 (wishlist add flow) ✅
- **Search results were ordered by card id**, which put the 1996 sets first — and TCGdex
  has no artwork for those, so the first screenful of any search was blank frames: the
  cards *least* likely to be the one in your hand. Cards with artwork sort first now.
  Result thumbnails also load eagerly; they appear because someone just asked for them,
  and deferring the one thing that distinguishes them defeats the search.
- **The add form asked what a card cost even on a wishlist** — asking about something
  that has not happened. The form takes its shape from the destination now: owned cards
  have a price, a currency and a date; wanted cards have a target in euro and a priority.
  **An empty target is allowed and means something** — wanting a card at any price is a
  real answer.
- **One card onto several lists in one action.** Whose-list is a set of toggles, not a
  single choice, because two people wanting the same card is ordinary. Each list gets its
  own item with its own id, target and outcome; nothing is shared. Verified: one card
  onto two lists queued four writes — both encrypted lists plus the regenerated public
  files — and the watchlist grew to include a card nobody owns yet, so the nightly job
  prices it.

### 2026-09-19 — rev 20 (search and publishing usability) ✅
- **The search box lost focus on every keystroke**, so only the first character landed —
  which is why the search looked broken rather than merely awkward. Cause was the
  wholesale rebuild introduced in rev 16: it replaces the element the caret sits in. The
  rev 16 note weighed that approach in render time and **missed that it discards focus
  and selection**. Rebuilds now restore both by element id.
- **The same rebuild was wiping the add-card form**, whose fields were uncontrolled and
  recreated empty. Typing a price and then letting results arrive cleared the price. The
  form is state-driven now, so a rebuild is lossless by construction.
- **One search box, Cardmarket-shaped**: matches card id, set, number, rarity and both
  names, and treats `S12a-261`, `S12a 261` and `s12a261` alike. Pasting an id into the
  catalog search returns that exact card instead of guessing at names — in a shop the
  code printed on the card is what is in front of you.
- Catalog search is **live and debounced** rather than behind a button, and a slow
  earlier reply can no longer overwrite a newer result.
- **Publishing happens by itself** a couple of seconds after a change. A burst of edits
  becomes one commit; a failure stays queued with the count on screen. The token is still
  asked for once per device.
- 35 tests. 360 px re-verified with the new form open.

### 2026-09-19 — rev 19 (calibration automated, price carry-forward) ✅
- **The calibration week is gone; it is a daily job now.** The question was why `avg30`
  agreed with Cardmarket within 2,3 % while `avg7`/`avg1` were out by up to 33 %. A
  one-day eyeball comparison could never answer that — it cannot separate a thinly traded
  card whose weekly average genuinely swings from a field that is mislabelled or stale.
  **The snapshots answer it without Cardmarket**: if the fields mean what they say, a
  reported `avg7` tracks the mean of the last seven reported `avg1` values. Thirty
  observations instead of one, no access needed to a site that refuses automated clients,
  and it runs on its own. Quiet until eight days of history exist.
  *(It proves internal consistency, not agreement with Cardmarket — that was already
  established by direct comparison and was never in doubt for `avg30`.)*
- It also catches the failure that matters more: **a frozen upstream mirror looks exactly
  like a calm market.** A week of identical `updated` timestamps across most cards fails
  the job.
- **Found a real bug while checking.** Two cards failed a lookup in an earlier run and
  were **dropped from `latest.json` entirely**, so the collection screen reported
  Charizard V and Latios as having no price while Cardmarket listed both. The two files
  now answer different questions: `daily/<date>.json` holds only what was observed,
  because a gap in the record is a real gap; `latest.json` holds the best price currently
  known and carries a reading forward, visible as old rather than missing. Tested.
- **Hand-checked prices**: cannot be refreshed automatically, but going stale unnoticed
  can be prevented — anything not re-read in 90 days opens an issue with the links.
- Master's final grade set to **110/110 cum laude**. The weighted average is no longer
  shown for a degree whose record is incomplete: six of thirteen exams is not that
  degree's average, and the final grade stands on its own.
- 33 tests.

### 2026-09-19 — rev 18 (hardening) ✅
- **30 unit tests** on Node's built-in runner, which strips types itself — no dependency,
  no configuration. CI runs them with the schema and encryption tests.
- **Two real defects found by writing them.**
  1. The money layer returned unrounded floats: `252.58 − 140` came back as
     `112.58000000000001`. The display formatter hid it; sorts and comparisons do not go
     through a formatter. Money is now exact to the cent where it is *produced*.
  2. **`encrypt-personal.mjs` issued a fresh file key on every run.** Git keeps every
     revision forever, so each was left readable only by the keyring that existed when it
     was written — and `audit.mjs` could not walk the history at all, silently reporting
     each unreadable revision as an empty first one. Keys are now kept across rewrites,
     the audit reports unreadable revisions honestly, and two tests pin it from both
     sides. **One revision written before the fix stays unreadable**, which the tool now
     says out loud.
- **The mutation layer no longer reaches into storage.** Mutations return the files that
  would be written and the caller persists them — the right dependency direction, and
  what makes the ownership rules testable without a browser.
- Those rules are asserted from both sides: a friend's card never reaches the collection,
  my own card moves and keeps `acquiredFrom`, and a friend's spending stays out of my
  totals with both lists full.
- The watchlist tests assert what the published files must **not** contain — no owner, no
  price paid, no target, no notes.
- One test fixture bug of my own: `value: over.value ?? 20` turned an explicitly unpriced
  row back into a priced one, so the sort test failed against correct code. Worth
  recording because the same `??`-on-null mistake would be easy to repeat in the app.

### 2026-09-19 — rev 17 (the write path) ✅
- **Saving never needs the password.** `resealPayload` replaces an envelope's contents
  while keeping its wrapping untouched, so a write uses the file key held since the
  unlock. Nothing keeps a password in memory to write, and the keyring still opens the
  file because its key did not change.
- **The queue survives a reload without storing a secret.** Changes are kept on the
  device as ciphertext for the personal files and already-public JSON for the derived
  ones. Verified: add a card, reload, unlock — the card and the queue are both still
  there. That is what a shop basement with no signal needs.
- The queued copy wins over what GitHub serves, because it has not been published yet.
  Publishing from a second device while changes are queued here is a real conflict, and
  the count and banner put it in front of a person rather than resolving it quietly.
  **Discard** exists for a queue that should not be published.
- **Search translates before it queries.** TCGdex holds Japanese cards under Japanese
  names; "Mega Rayquaza" is mapped through the species table and searched as レックウザ.
  Each word is tried, which is what makes a query that is not itself a species work.
- **Verified the commit flow against the real repository without moving the branch**:
  created blobs, tree and commit objects, then checked the resulting tree — **98 files
  including the nightly price snapshots survive a browser save through `base_tree`**.
  Unreferenced objects are collected, so nothing landed. The one step not exercised is
  the final ref update, which needs a token this machine should not put in a browser.
- End-to-end in the browser: added a card (46 → 47, €1218,97 → €1506,53 paid, FX fetched
  for the purchase date), reloaded, unlocked, found it still queued, deleted it, and the
  figures returned exactly to €1218,97 / €2657,71 / +118 %.
- `watchlist.json` and `pending.json` are now derived by **one shared module** used by
  both the script and the browser — publishing from a laptop and from a phone must not
  produce different files.

  **Left for later:** editing a card in place (delete-and-re-add works today), photo
  upload for pending cards, and value-over-time charts, which need more than one day of
  history.

### 2026-09-19 — rev 16 (collection and wishlist screens) ◐
- **No framework.** Preact was installed and removed within the hour: it broke the build
  on Astro 5.18 with an unresolved `astro:preact:opts`. Written instead in plain
  TypeScript with a ~50-line DOM helper and a store that rebuilds the view on change. At
  a few hundred rows a full rebuild is imperceptible, and it removes every bug that comes
  from patching the DOM by hand. **Deviation from nothing in the plan** — the plan never
  named a framework — but worth recording as a decision rather than an accident.
- **Collection**: search across English *and* Japanese names, filters for set, date
  range, gainers, losers and cards awaiting the catalog, seven sort keys, detail panel.
- **Unpriced cards are never counted as zero.** They are excluded from the value total
  and reported separately — absent and worthless are different things, and averaging them
  together would quietly understate the collection.
- Every price shown carries its source and the timestamp it was read. Two of the sources
  are different markets and a third was checked by hand, so a bare number is not enough.
- **Wishlists**: combined shopping page or per-person blocks, target beside live `avg30`
  with an under/over marker. Balances are computed from the purchases behind them, never
  stored. Friends' cards never enter the collection totals.
- **Found and fixed while building:** the watchlist covered only owned cards, so a wanted
  card had no market price and the target comparison had nothing to compare against;
  the footer printed `GitHub , LinkedIn ,` because JSX newlines became text nodes; the
  heading read "Collection" while the Wishlists tab was open; the combine toggle showed
  for friends, who have one list.
- **The earlier mobile test method was wrong.** Constraining `documentElement` to 360 px
  leaves `vw` units and media queries resolving against the real viewport, so it reported
  overflow that did not exist and would have hidden overflow that did. Re-tested in a
  360 px **iframe**, which has its own viewport: all four pages clean, zero overflow.
  The Phase 2 result was re-verified the same way.
- Thumbnails degrade quietly — TCGdex lists `M6-113` with no artwork today, so a missing
  image and a failed one both end as the same empty frame.

  **What is left of Phase 6**, and it is the part that matters before Japan: add, delete
  and edit cards, the TCGdex picker, the pending path, photo upload, and the write path
  itself — PAT unlock, offline queue, batched commits, *N unsynced* badge. Charts wait
  on more than one day of history.

### 2026-09-19 — rev 15 (vault encrypted and published) ✅
- **The collection is now ciphertext in a public repository**, and opening it needs a
  password. Verified before publishing: no field name, card name, amount, exchange rate
  or password appears anywhere in the five `.enc` files.
- **Envelope format**: `password --PBKDF2(600k)--> wrapping key --unwraps--> AES-256-GCM
  file key --decrypts--> payload`. The indirection is what lets one file be opened by two
  passwords — its owner's and the admin keyring's — and makes a password change a
  re-wrap rather than a re-encryption.
- A wrong password fails on the GCM authentication tag, so there is no separate check to
  get wrong, and callers get `null` rather than an error that would reveal how close a
  guess was.
- **24 encryption tests**, run two ways: against the real vault locally, and in `--self`
  mode against a vault the test builds itself, so **CI proves the isolation property
  without ever holding a secret**. They assert that Tommy's password opens `tommy.enc`
  and none of the other four, that a flipped byte or replaced salt is detected, that the
  same payload never encrypts identically twice, and that the round trip is lossless.
- **Measured before choosing the unlock order.** One PBKDF2 derivation 194 ms, four in
  sequence 642 ms, **four concurrently 804 ms** — parallelising is *slower*, because
  WebCrypto serialises PBKDF2 and only adds overhead. So attempts run in order with the
  keyring first: admin costs one derivation, a friend up to three. Expect roughly four
  times those figures on the S10.
- Verified in a real browser: admin unlocks in **675 ms** and reads 46 cards; `tommy`
  opens only Tommy's list; a wrong password opens nothing and says nothing useful.
- **Batched commit client** built on the Git Data API rather than Contents, because
  Contents writes one commit per file and a shopping session would leave forty behind. It
  never forces a ref — a rejected update means the nightly price job moved the branch, so
  it rebuilds on top of it.
- `admin-commit.mjs` refuses to run if anything under `.local/` has been staged. Git
  history cannot be un-published.
- Public pages still ship **zero JavaScript**; only `/personal` loads any.

  **Reminder, unchanged from §7.3:** `cvalgian` is eight lowercase letters derived from
  your handle. Strong against a generic attacker at 600k iterations, weak against a
  wordlist built from your name. The exposure is read-only and offline — a guess can read
  the vault, never write to it. Changing it is one command: `npm run data:encrypt` with a
  new password, then `npm run admin:commit`.

### 2026-09-19 — rev 14 (price pipeline live) ✅
- **First reading taken.** 46 cards priced — 43 from TCGdex, 3 from the manual overrides.
  Sum of `avg30` **€2657,71** against **€1218,97** paid, **+118 %**. The series starts
  here and grows one reading a day.
- **History is stored only in immutable files.** `prices/daily/<date>.json` is written
  once and never touched; `latest.json` is a small rewritten pointer. Measured the
  alternative before choosing: one rolling history file costs roughly a hundred times
  more, because git keeps a version per commit — **~1,2 GB a year at 500 cards against
  20 MB** for daily files. Longer ranges will be served by monthly rollups.
- **A partial day is refused, not written.** If more than a fifth of watched cards lose
  their price the job exits non-zero. A partial day looks exactly like a market crash in
  a chart and cannot be told apart from one afterwards.
- **`resolve-pending.mjs` verified against both sides of the Japan case**: `M6-113`
  resolves, `M6a-045` (30th Celebration JP) does not, because TCGdex still has not
  published that set. The job cannot promote a card itself — it holds no key — so it
  publishes the answer and opens an issue.
- **Chained the deploy.** A push made with `GITHUB_TOKEN` does not trigger other
  workflows, so the nightly commit would never have reached the site. `deploy.yml` now
  also runs on `workflow_run` after Prices. Verified: dispatch → snapshot → commit as
  `github-actions[bot]` → deploy → `/data/prices/latest.json` served live.
- Every daily file is validated, not just the newest — a bad snapshot is permanent.
- Fixed on the first real run: `resolutions.json` was being rewritten with only a fresh
  timestamp on quiet days, producing a daily commit line that said nothing.
- **Dropped the FX rates cache.** The rate is looked up once at purchase and frozen into
  the record, so there was nothing for a cached file to do.
- **Open: the calibration week (2026-09-20 → 26).** `npm run data:spot-check` prints
  every field next to a Cardmarket link. `avg30` agreed within 2,3 % and `low` to the
  cent, but `avg7` and `avg1` were out by up to 33 %. Neither appears anywhere in the
  site until seven readings explain why.

### 2026-09-19 — rev 13 (Phase 3 complete) ✅
- **Nothing personal is committed, and `.local/` is gitignored.** The repository is
  public and git history is append-only, so a plaintext commit of purchase prices would
  stay readable forever — including after Phase 5 encrypts the served copies. Migration
  input and output both live under `.local/`.
- **Schemas** (JSON Schema 2020-12) for collection, overrides and watchlist, with
  `additionalProperties: false` throughout. Requirements depend on state: a TCGdex card
  carries its cached display fields, an override-sourced card carries none, a pending
  card must carry its hint. `scripts/test-schemas.mjs` checks 12 rules from both sides.
- **Import reconciles to €1218,97.** Every row verified to equal `amount × rate` to the
  cent. The sheet's own total reads €1218,94 because it sums before rounding; the import
  sums per-row cent values, which is what a ledger should hold. Both are correct, they
  answer different questions — recorded here so the 3-cent gap is never re-investigated.
- Three rows resolved via a fixup table that keeps the reasoning beside the mapping.
- **Variant-aware**: a `variantId` is stored only when that variant is the one Cardmarket
  prices. The two 1996 cards have two unpriced variants each, so storing either id would
  have been meaningless — they fall through to manual overrides instead.
- **Manual prices captured** from Cardmarket for the three unpriced cards. Worth noting
  what they showed: the 1996 Charmander is **from €0,45 but avg30 €12,32**, and Bulbasaur
  **from €0,34 but avg30 €5,30**. That spread is the §4.3 NM caveat made concrete — on
  vintage, "From" is a damaged copy and nowhere near what an NM card is worth.
- **Name table** from PokéAPI in one GraphQL query (1025 species, 35 KB), plus form
  prefixes, owner prefixes and suffixes in `src/lib/card-name.mjs`. Translates 45/45 of
  the collection, including メガレックウザex → Mega Rayquaza ex and Nのレシラム → N's
  Reshiram.
- Added retry with exponential backoff to the TCGdex client after a 503 during the first
  import run. The daily job must not lose a day of history to one blip.
- `data.yml` runs the schema tests and validation on every push and pull request.

  **One decision to re-confirm (§12.4):** `watchlist.json` is public and lists the 43 card
  ids. It carries no owner, no price paid and no target — but since the collection is
  mine, the card list is effectively mine too. That was accepted in rev 7 in exchange for
  the daily job never needing a key. If you would rather close it, the job can read an
  encrypted watchlist with the key in GitHub Actions secrets, which are private and
  server-side. Say so and it changes in Phase 4.

### 2026-09-19 — rev 12 (Phase 2 deployed) ✅
- **Design direction.** The subject is inference work, so the site is built like an
  instrument rather than a brochure: precise, tabular where numbers matter, quiet
  everywhere else. **Spectral** carries prose and display; **IBM Plex Sans** carries the
  interface and every figure, with tabular lining numerals so marks, credits and years
  line up. Both self-hosted via `@fontsource`, so the site makes **no third-party
  requests**.
- **One repeating structure: the ruled row.** Rules delimit rows of an index or a record
  and are drawn nowhere else, so they encode structure instead of decorating. No cards,
  no shadows, no gradients, no pills.
- **One accent, ultramarine** (`#2d3a8c` / `#8b97e8` dark), used for links, the current
  nav item and *cum laude* marks. **Deviation from rev 3's per-section accent plan:**
  sections are told apart by density and structure instead, which is more disciplined and
  leaves the second accent free for the gated Personal area.
- Built `tokens.css`, `base.css`, `BaseLayout`, `SiteHeader`, `SiteFooter`, `RuledIndex`,
  `IndexRow`, `Particulars`, `ExamRecord`, and the three pages.
- **University page**: each degree prints its summary figures and every exam on record.
  **Averages are computed from the exam rows at render time, never stored**, so a figure
  cannot disagree with the table beneath it. The master's record displays its own
  incompleteness rather than hiding it.
- Fixed while reviewing: projects sorted on creation date while displaying last-activity
  year, so the year column read 2026 / 2025 / 2026 — now sorted on the value shown; stray
  spaces before the commas in the footer link list; the display heading was held on one
  line by a non-breaking space and overflowed 360 px.
- **Removed one thing on purpose**: the closing paragraph on the home page repeated what
  the navigation and the new particulars sidebar already said.
- Verified: 360 px with zero horizontal overflow on all three pages; AA contrast both
  themes (muted 5,8:1 light / 6,8:1 dark, accent 9,1:1 / 6,8:1); skip link; visible focus
  rings; reduced motion respected; no client JavaScript.
- Deploy run 35460968445 succeeded. `/`, `/projects`, `/university` all HTTP 200.
- **Still placeholder**: `identity.bio` is my draft (§12.1), and the seven master's marks
  plus the graduation grade are still missing (§13 rev 11).

### 2026-09-19 — rev 11 (transcripts extracted, profile filled)
- **Extracted both transcripts into `src/data/transcripts.json`.** No PDF library was
  available and none was installed; wrote a ~60-line extractor that inflates the content
  streams and reads the text operators directly.
- **Bachelor — complete.** 22 rows, 177 ECTS, weighted average **28,07/30** (≈ 102,9/110)
  excluding the final exam. Two *30 cum laude*: Programming Laboratory and Cloud & Green
  Computing. The transcript totals 177 rather than the expected 180 ECTS; the likeliest
  explanation is an unmarked English-proficiency credit that these exports omit, recorded
  as unconfirmed rather than invented.
- **Master — incomplete, and this matters.** The PDF is a study-plan snapshot dated
  **2021-11-17**, not a final transcript. It records **6 passed exams (51 ECTS, weighted
  average 28,94/30)** and lists the other 7 as *"Currently Attending"* or *"Will attend"*.
  The degree finished in 2023, so **marks for Internet of Things, Computational
  Intelligence and Deep Learning, Multimedia Information Retrieval and Computer Vision,
  Process Mining and Intelligence, Symbolic and Evolutionary AI, Human Language
  Technologies and the Final Examination are not in the repository.** Stored under
  `unrecorded` with credits but no marks. Needed from you, along with the graduation mark.
  *(The 13 rows sum to exactly 120 ECTS, which confirms nothing was lost in extraction.)*
- **Student ID omitted** from the extracted data. Flagged that the PDFs themselves are
  served publicly and still contain it.
- Master's `endYear` set to **2023**.
- **LinkedIn has no About section** — the profile is a top card only, so there was no bio
  to copy. Took what is there: headline *"AI Tech Lead @ Translated | Ex SDE Intern @
  Amazon Luxembourg"*, location Livorno, pronouns he/him. Added an `experience` array with
  Translated and Amazon Luxembourg, **dates left null** rather than guessed. Drafted a
  three-sentence bio from those facts plus this repository, flagged
  `bioStatus: "draft"` with its source recorded — to be replaced with your own words.
- Build and `astro check` still clean.

### 2026-09-19 — rev 10 (Phase 1 deployed) ✅
- Switched Pages `build_type` from `legacy` to `workflow`, then pushed both branches.
  Order mattered: the commit deletes `docs/`, which the legacy config was serving.
- `legacy-angular` pushed as a new remote branch; `master` fast-forwarded
  `cdc4519..1368826`.
- Deploy run **35459651204 succeeded**. https://valegian.github.io/ returns HTTP 200 with
  the new page, and `/resources/bachelor-transcript.pdf` still resolves — the transcript
  URLs survived the move into `public/`.
- Incidental fix: the clone was on an HTTPS remote with no credential helper, so pushes
  failed with *"could not read Username"*. Switched `origin` to SSH, which matches the
  `gh` config already on this machine.
- **Phase 1 closed. Next: Phase 2** — design system and the real public sections. Needs
  the bio copy (§12.1).

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
