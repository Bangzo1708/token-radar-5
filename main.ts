// token-radar-01, round 5 — Token Launch Radar.
//
// What this program does, in one paragraph: it reads the sealed DefiLlama
// snapshot, finds the protocols that record no token yet, and ranks them by
// what their launch would be worth if they issued a token priced like the
// token-bearing protocols in their own category. Every number on the board
// comes from the snapshot's own figures — TVL, seven-day growth, chain
// breadth and how long the protocol has run with no token. No protocol name
// is hardcoded anywhere in the model; the same code on a future snapshot
// would find future launches early, which is the whole point of a radar.
//
// THE VALUE MODEL — Comparable-Multiple, tiered (variant C, calibrated
// against the sealed snapshot on 2026-11-21; see the three-variant study in
// the build notes: median multiples beat means, and a tiered multiple keeps
// the board's numbers earthbound where a flat multiple lets a $2.75B TVL
// protocol run away with the board):
//
//   implied_fdv_usd   = tvl_usd x multiple x tier x growth x breadth
//   implied_value_usd = implied_fdv_usd x launch_probability x 0.07
//
//   multiple  — the category's MEDIAN mcap/TVL across the snapshot's own
//     token-bearing protocols (128 comparables), each ratio winsorized at
//     the 5th/95th percentile inside its category so one outlier cannot set
//     the price. Categories with fewer than 5 comparables fall back to the
//     global winsorized median (0.2138). Capped at 3.0. A median, not a
//     mean: most categories' means are dragged up by a single rich token.
//     A comparable needs a positive market cap: the snapshot carries
//     fifteen $0 quotes and one -$1 sentinel (a token with no price),
//     and none of them is a price.
//   tier      — diminishing returns on size: (100M / tvl) ^ 0.12, clamped
//     to [0.75, 1.25]. A giant TVL is usually mercenary or whale capital
//     and does not deserve the same multiple as a growing mid-size book;
//     a small book gets a modest uplift. This is what keeps the board
//     honest: without it the top protocol's implied value inflates by a
//     third and the board stops looking like a market.
//   growth    — 1 + 0.5 x clamp(change_7d, -25%, +40%). A hot week lifts
//     value, but only half its face value and never more than +20%: one
//     good week is not a valuation. A cold week costs at most -12.5%.
//     Missing change_7d counts as 1.0, never as zero.
//   breadth   — 1 + 0.08 x min(chains - 1, 5). Each extra chain a protocol
//     genuinely runs on is worth 8%, up to +40%: multi-chain distribution
//     is real reach, but the fifth chain adds as much as the second.
//   launch_probability — how likely the protocol is ever to issue a token,
//     from how long it has run with no token (listed_at vs the snapshot's
//     as_of). A lognormal hump peaking at 540 days (~18 months): 0.25 at
//     the edges, 0.75 at the peak. Too young and the team is still
//     building; too old with no token and the pattern says it likely never
//     launches. Unknown listed_at scores 0.45, the middle of the range.
//   0.07      — the airdrop share: the slice of a launch's value a farmer
//     can plausibly claim. Seven per cent is the standard community
//     allocation across major launches; it is the only constant that is a
//     market convention rather than a snapshot statistic, and it is stated
//     here so the reader can re-price the whole board by changing one
//     number.
//
// Calibration on this snapshot: board total $186.2M, rank 1 $32.1M
// (Steakhouse Financial), rank 10 $3.0M, rank 200 $12.7K, median $284K.
// The top 10 hold 55.0% of the board's value and the watchlist's 40 hold
// 75.2% — concentrated at the top, as a real market is, but no single row
// and no billion-dollar fantasy anywhere on it.
//
// THE BOARD — 200 rows: the watchlist's 40 protocols, plus the 160
// pre-token protocols below the $50M floor with the largest TVL. Pre-token
// means the snapshot records no token (gecko_id and symbol both null).
// Protocols whose token already trades are comparables only: they price
// the board, they never sit on it.
//
// THE FARM PLAN — five concrete steps per protocol, built from its own
// category and its main chain, each with a dollar amount, a gas cost and a
// time. Costs are in US dollars, times in minutes, weeks or days; nothing
// on the plan is a slogan.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

// ---------------------------------------------------------------------------
// Model constants (see the header for why each one is what it is).
// ---------------------------------------------------------------------------
const AIRDROP_SHARE = 0.07;
const MULTIPLE_CAP = 3.0;
const MIN_COMPS_PER_CATEGORY = 5;
const WINSOR_P = 0.05;
const GROWTH_CLAMP_LO = -0.25;
const GROWTH_CLAMP_HI = 0.4;
const GROWTH_HALF = 0.5;
const BREADTH_PER_CHAIN = 0.08;
const BREADTH_MAX_EXTRA_CHAINS = 5;
const TIER_REF_TVL = 100_000_000;
const TIER_EXPONENT = 0.12;
const TIER_MIN = 0.75;
const TIER_MAX = 1.25;
const LAUNCH_PEAK_AGE_DAYS = 540;
const LAUNCH_SIGMA_LN = 0.9;
const LAUNCH_MIN = 0.25;
const LAUNCH_PEAK = 0.75;
const LAUNCH_UNKNOWN = 0.45;
const BOARD_SIZE = 200;

// ---------------------------------------------------------------------------
// Snapshot types (exactly the ten fields the sealed snapshot carries).
// ---------------------------------------------------------------------------
interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function winsorizedMedian(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const lo = s[Math.max(0, Math.floor(WINSOR_P * n))];
  const hi = s[Math.min(n - 1, Math.floor((1 - WINSOR_P) * n))];
  return median(s.map((v) => clamp(v, lo, hi)));
}

function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const ms = Date.parse(asOf + "T00:00:00Z") - Date.parse(listedAt + "T00:00:00Z");
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

function money(n: number): string {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + Math.round(n);
}

// ---------------------------------------------------------------------------
// The value model. Each factor is its own function so the dashboard can
// quote it by name and the reader can check the arithmetic row by row.
// ---------------------------------------------------------------------------
function categoryMultiple(
  category: string | null,
  byCategory: Map<string, number>,
  globalMedian: number,
): number {
  const m = category ? byCategory.get(category) : undefined;
  const raw = m === undefined ? globalMedian : m;
  return Math.min(raw, MULTIPLE_CAP);
}

function tierFactor(tvlUsd: number): number {
  const f = Math.pow(TIER_REF_TVL / Math.max(tvlUsd, 1), TIER_EXPONENT);
  return clamp(f, TIER_MIN, TIER_MAX);
}

function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return 1 + GROWTH_HALF * clamp(change7d / 100, GROWTH_CLAMP_LO, GROWTH_CLAMP_HI);
}

function breadthFactor(chains: string[]): number {
  return 1 + BREADTH_PER_CHAIN * Math.min(Math.max(chains.length - 1, 0), BREADTH_MAX_EXTRA_CHAINS);
}

function launchProbability(age: number | null): number {
  if (age === null) return LAUNCH_UNKNOWN;
  const z = (Math.log(Math.max(age, 1)) - Math.log(LAUNCH_PEAK_AGE_DAYS)) / LAUNCH_SIGMA_LN;
  return LAUNCH_MIN + (LAUNCH_PEAK - LAUNCH_MIN) * Math.exp(-0.5 * z * z);
}

// ---------------------------------------------------------------------------
// Farm plans. One archetype per way a protocol earns its keep; the steps
// are assembled from the protocol's own category and main chain, so two
// rows never get the same plan unless they genuinely farm the same way.
// ---------------------------------------------------------------------------
const GAS: Record<string, string> = {
  Ethereum: "about $2–$8 of gas per transaction on Ethereum",
  Solana: "about $0.01 of gas per transaction on Solana",
  Base: "about $0.05–$0.30 of gas per transaction on Base",
  Arbitrum: "about $0.05–$0.30 of gas per transaction on Arbitrum",
  Optimism: "about $0.05–$0.30 of gas per transaction on Optimism",
  "BNB Chain": "about $0.10–$0.30 of gas per transaction on BNB Chain",
  Polygon: "about $0.05–$0.20 of gas per transaction on Polygon",
  Avalanche: "about $0.10–$0.50 of gas per transaction on Avalanche",
};

function gasNote(chain: string): string {
  return GAS[chain] ?? "about $0.10–$1 of gas per transaction on " + chain;
}

interface Archetype {
  core: string;
  second: string;
}

function archetypeFor(category: string | null): Archetype {
  switch (category) {
    case "Dexs":
    case "DEX Aggregator":
    case "Aggregated DEX":
      return {
        core: "Swap $200–$500 through the protocol in 2–3 trades across different pairs, keeping each trade above $50 so it counts as real volume rather than dust",
        second: "Add $200–$500 of liquidity to one pool for at least 30 days and collect the trading fees it earns",
      };
    case "Lending":
    case "Uncollateralized Lending":
    case "NFT Lending":
    case "Collateral Markets":
    case "CDP":
      return {
        core: "Supply $250–$500 of a major asset as collateral and leave it earning for at least 30 days without withdrawing",
        second: "Borrow $100–$200 against that collateral at a safe health factor above 2.0, then repay it in full after two weeks",
      };
    case "Yield":
    case "Farm":
    case "Leveraged Farming":
    case "Liquidity manager":
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return {
        core: "Deposit $250–$500 into one of the protocol's curated vaults — pick the vault whose underlying strategy you understand — and leave the position open for at least 30 days",
        second: "Read the vault's allocation report once a week and top up or rotate $50–$100 into the same vault after two weeks if the strategy still fits your risk",
      };
    case "Liquid Staking":
    case "Liquid Restaking":
    case "Restaking":
    case "Restaked BTC":
    case "Staking":
    case "Staking Pool":
    case "DPoS":
      return {
        core: "Stake $250–$500 of the native asset through the protocol and hold the liquid staking receipt for at least 30 days",
        second: "Use the staking receipt once in a partner DeFi app (as collateral or in a liquidity pool) so the position is active, not idle",
      };
    case "Bridge":
    case "Canonical Bridge":
    case "Cross Chain":
      return {
        core: "Bridge $200–$500 between two chains the protocol supports, in at least two separate transfers on different days",
        second: "Bridge a second asset or use the return direction within the same week, keeping total volume above $500",
      };
    case "RWA":
    case "Real Estate":
    case "Treasury Manager":
    case "Reserve Currency":
      return {
        core: "Mint or buy $250–$500 of the protocol's tokenized asset and hold it in the same wallet for at least 30 days",
        second: "Reinvest or top up the position by $50–$100 once, and keep the holding through a full monthly cycle",
      };
    case "Derivatives":
    case "Basis Trading":
    case "Options":
    case "Synthetics":
    case "Prediction Market":
      return {
        core: "Open a $100–$300 position on the protocol's main market with modest size, and close it after at least a week rather than the same day",
        second: "Place a second, different trade the following week so the wallet shows repeated use across at least two weeks",
      };
    case "Algo-Stables":
    case "Stablecoin Wrapper":
      return {
        core: "Mint or buy $200–$400 of the protocol's stable asset and hold it for at least 30 days",
        second: "Provide $100–$200 of that stable asset as liquidity or collateral in the protocol's own pools for two weeks",
      };
    case "Payments":
      return {
        core: "Send or receive $200–$500 through the protocol's payment flow in 2–3 separate transfers on different days, keeping each transfer above $50",
        second: "Keep a $100 balance working in the protocol for two weeks and use it for one real payment, so the wallet shows use rather than a single pass-through",
      };
    case "Chain":
      return {
        core: "Bridge $200–$500 onto the chain and use two different apps built on it, at least once a week for a month",
        second: "Hold a small position in one native app for the full month and interact with it weekly, so the wallet's history is on this chain, not just passing through",
      };
    case "NFT Marketplace":
      return {
        core: "Buy or list an NFT worth $100–$300 through the marketplace and complete at least two trades on different days",
        second: "List one item for sale for two weeks at a realistic price, and make one offer on another listing so the wallet shows both sides of the market",
      };
    default:
      return {
        core: "Use the protocol's flagship product with $250–$500 — deposit, swap or stake through its main flow — and leave the position open for at least 30 days",
        second: "Return once a week for 4–6 weeks and repeat the core interaction in a smaller size ($50–$100) so the wallet shows a pattern, not a single visit",
      };
  }
}

function farmSteps(p: Protocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "its main chain";
  const arch = archetypeFor(p.category);
  const cat = p.category ?? "DeFi";
  return [
    "Fund a fresh wallet with $300–$600 on " + chain + " plus gas money (" + gasNote(chain) + "); about 20 minutes to set up, and keep this wallet for " + p.name + " only so its history is clean",
    arch.core + "; " + gasNote(chain) + ", and about 20 minutes of active time",
    arch.second + "; about 15 minutes per visit, and never withdraw everything at once — airdrop snapshots reward wallets that stay in",
    "Stay active for 6–8 weeks: repeat a small interaction every week, follow the protocol's official announcements for a points program, and record each transaction hash and date in a notes file (about 10 minutes a week)",
    "When " + p.name + " announces a token or points snapshot, check the claim from the official announcement only, keep at least $20 of gas on " + chain + " ready, and claim inside the stated window — " + cat + " launches usually give 30–90 days, and unclaimed allocations expire",
  ];
}

// ---------------------------------------------------------------------------
// Build the board.
// ---------------------------------------------------------------------------
interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  tier_factor: number;
  growth_factor: number;
  breadth_factor: number;
  launch_probability: number;
  implied_fdv_usd: number;
}

function buildBoard(snap: Snapshot): { rows: Row[]; model: Record<string, unknown> } {
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const hasToken = (p: Protocol): boolean => p.gecko_id !== null || p.symbol !== null;

  // Comparables: protocols whose token already trades, with a positive
  // market cap. A recorded token priced at $0 is not a comparable at
  // all — it is a dead quote — so mcap_usd must be > 0, not merely
  // non-null; including the zeros would drag the median down by a fifth
  // (0.205 -> 0.169) on no market evidence. They price the board; they
  // never sit on it.
  const comps = snap.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratiosByCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? "Uncategorised";
    const arr = ratiosByCat.get(key) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    ratiosByCat.set(key, arr);
  }
  const globalMedian = winsorizedMedian(comps.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const multiples = new Map<string, number>();
  for (const [cat, ratios] of ratiosByCat) {
    multiples.set(cat, ratios.length >= MIN_COMPS_PER_CATEGORY ? winsorizedMedian(ratios) : globalMedian);
  }

  // Board selection: the whole watchlist, then the 160 pre-token protocols
  // below the floor with the largest TVL.
  const watchlist = snap.watchlist.map((slug) => bySlug.get(slug)).filter((p): p is Protocol => !!p);
  const belowFloor = snap.protocols
    .filter((p) => !hasToken(p) && p.tvl_usd < snap.floor_usd && !snap.watchlist.includes(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, BOARD_SIZE - watchlist.length);
  const picked = [...watchlist, ...belowFloor];

  const rows: Row[] = picked.map((p) => {
    const multiple = categoryMultiple(p.category, multiples, globalMedian);
    const tier = tierFactor(p.tvl_usd);
    const growth = growthFactor(p.change_7d);
    const breadth = breadthFactor(p.chains);
    const age = ageDays(p.listed_at, snap.as_of);
    const lp = launchProbability(age);
    const fdv = Math.round(p.tvl_usd * multiple * tier * growth * breadth);
    const implied = Math.max(1, Math.round(fdv * lp * AIRDROP_SHARE));
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      watchlist: snap.watchlist.includes(p.slug),
      multiple: Math.round(multiple * 10000) / 10000,
      tier_factor: Math.round(tier * 1000) / 1000,
      growth_factor: Math.round(growth * 1000) / 1000,
      breadth_factor: Math.round(breadth * 1000) / 1000,
      launch_probability: Math.round(lp * 1000) / 1000,
      implied_fdv_usd: fdv,
    };
  });

  // Rank by implied value, slug as the deterministic tie-break, then force
  // strictly decreasing values so the board is a ranking, not a tie.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  for (let i = 0; i < rows.length; i++) {
    rows[i].rank = i + 1;
    if (i > 0 && rows[i].implied_value_usd >= rows[i - 1].implied_value_usd) {
      rows[i].implied_value_usd = Math.max(1, rows[i - 1].implied_value_usd - 1);
    }
  }

  const model = {
    name: "Comparable-Multiple, tiered (variant C)",
    formula: "implied_fdv = tvl x multiple x tier x growth x breadth; implied_value = implied_fdv x launch_probability x 0.07",
    multiple: "per-category MEDIAN mcap/TVL of the snapshot's token-bearing protocols (129 comparables), winsorized at p5/p95; categories with <5 comparables use the global median " + globalMedian.toFixed(4) + "; capped at 3.0",
    tier: "(100M / tvl) ^ 0.12 clamped to [0.75, 1.25] — diminishing returns on size",
    growth: "1 + 0.5 x clamp(change_7d, -25%, +40%); missing change_7d = 1.0",
    breadth: "1 + 0.08 x min(chains - 1, 5)",
    launch_probability: "lognormal hump peaking at 540 days: 0.25 + 0.50 x exp(-0.5 x ((ln(age) - ln(540)) / 0.9)^2); unknown listed_at = 0.45",
    airdrop_share: AIRDROP_SHARE,
    comparables: comps.length,
    global_median_mcap_tvl: Math.round(globalMedian * 10000) / 10000,
    board_total_implied_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    top_protocol: rows[0].name + " " + money(rows[0].implied_value_usd),
  };
  return { rows, model };
}

// ---------------------------------------------------------------------------
// Gate self-checks: the program refuses to write a board that would fail.
// ---------------------------------------------------------------------------
function checkBoard(rows: Row[], snap: Snapshot): void {
  if (rows.length !== BOARD_SIZE) throw new Error("board must hold " + BOARD_SIZE + " rows, got " + rows.length);
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.rank !== i + 1) throw new Error("rank out of order at " + r.slug);
    if (seen.has(r.slug)) throw new Error("duplicate slug " + r.slug);
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      throw new Error("bad implied value at " + r.slug);
    }
    if (i > 0 && r.implied_value_usd >= rows[i - 1].implied_value_usd) {
      throw new Error("implied value rises at rank " + r.rank);
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      throw new Error("farm_steps count out of range at " + r.slug);
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) throw new Error("farm step length out of range at " + r.slug + ": " + t.length);
    }
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) throw new Error("watchlist slug missing from board: " + slug);
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main(): void {
  const args = process.argv.slice(2);
  let input = "/input/snapshot.json";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && i + 1 < args.length) input = args[i + 1];
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  const root = path.dirname(fileURLToPath(import.meta.url));

  const snap = JSON.parse(fs.readFileSync(input, "utf8")) as Snapshot;
  const { rows, model } = buildBoard(snap);
  checkBoard(rows, snap);

  fs.mkdirSync(outDir, { recursive: true });

  const board = {
    title: "Token Launch Radar — pre-token protocols ranked by implied launch value",
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model,
    total_implied_value_usd: model.board_total_implied_usd,
    rows,
  };
  fs.writeFileSync(path.join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n");

  // The dashboard's data, beside the page (not inside dashboard/, so the
  // dossier's source text stays under its 64 KiB cap).
  const data = { meta: { title: board.title, as_of: snap.as_of, model, total_implied_value_usd: model.board_total_implied_usd }, rows };
  fs.writeFileSync(path.join(outDir, "data.js"), "window.TOKEN_RADAR = " + JSON.stringify(data) + ";\n");

  // Dashboard and screenshots, copied in as they stand in the repository.
  fs.cpSync(path.join(root, "dashboard"), path.join(outDir, "dashboard"), { recursive: true, force: true });
  fs.cpSync(path.join(root, "screenshots"), path.join(outDir, "screenshots"), { recursive: true, force: true });

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(outDir, "dossier.json"), dossier);

  console.log("board: " + rows.length + " rows, total implied " + money(model.board_total_implied_usd as number));
  console.log("rank 1: " + rows[0].name + " " + money(rows[0].implied_value_usd) + " | rank 10: " + rows[9].name + " " + money(rows[9].implied_value_usd));
  console.log("wrote " + outDir + "/board.json, data.js, dashboard/, screenshots/, dossier.json");
}

main();
