// elo.js — small, dependency-free pairwise ranking engine.
//
// Reusable for anything you want ranked by head-to-head votes ("which is
// worse / better / funnier?"). Works in browsers and Node (ES module).
//
// Design choices:
//  - The vote LOG is the source of truth, not the ratings. Ratings are
//    derived by replaying the log, so you can change K, re-weight, or
//    discard spam votes later without losing anything.
//  - Plain Elo depends on vote order (the last votes count more). For a
//    crowd poll that's a bug, not a feature, so `replay` can average over
//    several random orderings ("shuffled Elo") to wash that out.
//  - `nextPair` picks pairs that teach us the most: items with few votes
//    first, then pairs whose ratings are close (an uncertain match-up).

export const DEFAULTS = Object.freeze({
  initial: 1500,
  k: 32,          // base step size
  kMin: 12,       // step size once an item has many games
  kDecayGames: 30, // games over which K shrinks from k to kMin
  scale: 400,     // rating gap for 10:1 expected odds
});

/** Probability that a rating `ra` beats `rb`. */
export function expected(ra, rb, scale = DEFAULTS.scale) {
  return 1 / (1 + 10 ** ((rb - ra) / scale));
}

/** K for an item that has played `games` games: shrinks as evidence grows. */
export function kFor(games, opts = DEFAULTS) {
  const t = Math.min(1, games / opts.kDecayGames);
  return opts.k + (opts.kMin - opts.k) * t;
}

export class EloPool {
  constructor(ids = [], opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.items = new Map();
    ids.forEach((id) => this.add(id));
  }

  add(id) {
    if (!this.items.has(id)) {
      this.items.set(id, { id, rating: this.opts.initial, games: 0, wins: 0, losses: 0, draws: 0 });
    }
    return this.items.get(id);
  }

  get(id) {
    return this.items.get(id);
  }

  /**
   * Record one comparison. `outcome` is 1 if `a` won, 0 if `b` won, 0.5 for a tie.
   * Unknown ids are added on the fly.
   */
  record(a, b, outcome = 1) {
    if (a === b) return;
    const A = this.add(a);
    const B = this.add(b);
    const ea = expected(A.rating, B.rating, this.opts.scale);
    const ka = kFor(A.games, this.opts);
    const kb = kFor(B.games, this.opts);
    A.rating += ka * (outcome - ea);
    B.rating += kb * ((1 - outcome) - (1 - ea));
    A.games++; B.games++;
    if (outcome === 1) { A.wins++; B.losses++; }
    else if (outcome === 0) { B.wins++; A.losses++; }
    else { A.draws++; B.draws++; }
  }

  /** Items sorted best-first. */
  ranking() {
    return [...this.items.values()].sort((x, y) => y.rating - x.rating);
  }

  top(n = 25) {
    return this.ranking().slice(0, n);
  }

  /**
   * Choose the next pair to show. Favors under-sampled items, then close
   * ratings. `recent` is a list of "a|b" keys to avoid repeating.
   */
  nextPair({ rng = Math.random, recent = [] } = {}) {
    const all = [...this.items.values()];
    if (all.length < 2) return null;
    const avoid = new Set(recent);
    const minGames = Math.min(...all.map((x) => x.games));
    // Anchor: a random item among the least-played (plus a little slack).
    const pool = all.filter((x) => x.games <= minGames + 1);
    const anchor = pool[Math.floor(rng() * pool.length)];
    // Opponent: weight by closeness in rating, penalize recent repeats.
    const weights = all.map((x) => {
      if (x.id === anchor.id) return 0;
      const key = pairKey(anchor.id, x.id);
      const closeness = expected(anchor.rating, x.rating, this.opts.scale);
      const uncertainty = 1 - Math.abs(closeness - 0.5) * 2; // 1 = coin flip
      const fresh = 1 / (1 + x.games);
      return (avoid.has(key) ? 0.05 : 1) * (0.2 + uncertainty) * (0.5 + fresh);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    for (let i = 0; i < all.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) return rng() < 0.5 ? [anchor.id, all[i].id] : [all[i].id, anchor.id];
    }
    const fallback = all.find((x) => x.id !== anchor.id);
    return [anchor.id, fallback.id];
  }

  toJSON() {
    return { opts: this.opts, items: [...this.items.values()] };
  }

  static fromJSON(data) {
    const pool = new EloPool([], data.opts);
    data.items.forEach((it) => pool.items.set(it.id, { ...it }));
    return pool;
  }
}

/** Order-independent key for a pair. */
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Rebuild ratings from a vote log.
 * votes: [{ a, b, outcome }]  (outcome: 1 = a wins, 0 = b wins, 0.5 = tie)
 * shuffles: 0 → replay in given order; n > 0 → average of n random orderings.
 * Returns an EloPool whose ratings are the (averaged) result.
 */
export function replay(ids, votes, { shuffles = 0, seed = 1, ...opts } = {}) {
  if (!shuffles) {
    const pool = new EloPool(ids, opts);
    votes.forEach((v) => pool.record(v.a, v.b, v.outcome));
    return pool;
  }
  const rng = mulberry32(seed);
  const sums = new Map();
  let last;
  for (let s = 0; s < shuffles; s++) {
    const order = votes.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    last = new EloPool(ids, opts);
    order.forEach((v) => last.record(v.a, v.b, v.outcome));
    last.items.forEach((it, id) => sums.set(id, (sums.get(id) || 0) + it.rating));
  }
  last.items.forEach((it, id) => { it.rating = sums.get(id) / shuffles; });
  return last;
}

/** Tiny seeded PRNG so shuffled replays are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
