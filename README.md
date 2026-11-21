# token-radar-5

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bangzo1708/token-radar-5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bangzo1708/token-radar-5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — Build the best token launch radar. Entry for the [make.fun bounty token-radar-01](https://make.fun/bounty/token-radar-01): it reads a sealed DefiLlama snapshot, finds the protocols that record no token yet, and ranks 200 of them by what their launch would be worth — plus a concrete five-step farm plan per protocol, with dollar amounts, gas costs and times. A static dashboard (`dashboard/`) renders the board with filters; `screenshots/` shows it in action.

## The model — Comparable-Multiple calibration (variant C)

Every number on the board comes from the snapshot's own figures — TVL, seven-day growth, chain breadth and how long the protocol has run with no token. No protocol name is hardcoded anywhere; the same code on a future snapshot finds future launches early, which is the whole point of a radar.

```
implied_fdv_usd   = tvl_usd x multiple x tier x growth x breadth
implied_value_usd = implied_fdv_usd x launch_probability x 0.07
```

- **multiple** — the category's **median** mcap/TVL across the snapshot's own token-bearing protocols (128 comparables), each ratio winsorized at the 5th/95th percentile inside its category so one outlier cannot set the price. Categories with fewer than 5 comparables fall back to the global winsorized median (0.2138). Capped at 3.0. A median, not a mean: most categories' means are dragged up by a single rich token.
- **tier** — diminishing returns on size: `(100M / tvl) ^ 0.12`, clamped to [0.75, 1.25]. A giant TVL is usually mercenary or whale capital and does not deserve the same multiple as a growing mid-size book.
- **growth** — `1 + 0.5 x clamp(change_7d, -25%, +40%)`. A hot week lifts value, but only half its face value and never more than +20%.
- **breadth** — `1 + 0.08 x min(chains - 1, 5)`. Each extra chain a protocol genuinely runs on is worth 8%, up to +40%.
- **launch_probability** — how likely the protocol is ever to issue a token, from how long it has run with no token: a lognormal hump peaking at 540 days (~18 months), 0.25 at the edges, 0.75 at the peak. Unknown `listed_at` scores 0.45.
- **0.07** — the airdrop share: the slice of a launch's value a farmer can plausibly claim. Seven per cent is the standard community allocation across major launches.

Calibration on the sealed snapshot (2026-11-21): board total $186.2M, rank 1 $32.1M (Steakhouse Financial), rank 10 $3.0M, rank 200 $12.7K, median $284K. The top 10 hold 55.0% of the board's value and the watchlist's 40 hold 75.2% — concentrated at the top, as a real market is, but no single row and no billion-dollar fantasy anywhere on it.

## Run it

```sh
node main.ts --input /input/snapshot.json
```

Requires Node.js 22.6+ (runs TypeScript natively, no build step). The snapshot is a JSON file with `as_of`, `source`, `floor_usd` and a `protocols` array (slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol). Output goes to `out/` (`board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`); set `MAKEFUN_OUTPUT_DIR` to change it. Open `out/dashboard/index.html` to browse the board.

Owner: **Bangzo1708** · referral_code: **dkj7ja9h**

---

<sub>Entered on [make.fun](https://make.fun/?ref=dkj7ja9h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
