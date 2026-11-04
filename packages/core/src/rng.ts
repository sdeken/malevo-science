/**
 * Random streams for procedural generation (docs/PLAN.md §3.2).
 *
 * - `mulberry32` and `hashInts`/`hashString` are bit-for-bit the functions the
 *   prototype generators used (star-gen.js, settle.js, city-gen.js), so data
 *   made by those tools reproduces exactly. Do not "improve" them: every
 *   frozen generator depends on their exact output.
 * - A stream is always keyed, never taken from a shared sequence:
 *   `keyedStream(worldSeed, generator, entityId, purpose)`. Adding, removing
 *   or reordering one entity cannot change the numbers another entity gets.
 */

/** A source of uniform numbers in [0, 1). */
export type Random = () => number

/** mulberry32: a 32-bit seed in, a uniform stream in [0, 1) out. */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mix 32-bit integers into one 32-bit hash (the prototypes' `hash(...v)`; non-integers are truncated). */
export function hashInts(...values: number[]): number {
  let h = 2166136261 >>> 0
  for (const x of values) {
    h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** FNV-1a over UTF-16 code units (the prototypes' `hashStr`). */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** The seed of a keyed stream. Exposed so tools can record it in a locked record. */
export function streamSeed(worldSeed: number, generator: string, entityId: string, purpose = ''): number {
  return hashInts(worldSeed, hashString(generator), hashString(entityId), hashString(purpose))
}

/**
 * The stream for one entity and one purpose within one generator. `generator`
 * is the generator's name without its version, so a new version that keeps
 * the same keys draws the same numbers wherever its logic is unchanged.
 */
export function keyedStream(worldSeed: number, generator: string, entityId: string, purpose = ''): Random {
  return mulberry32(streamSeed(worldSeed, generator, entityId, purpose))
}

// ---- distributions. Each consumes a documented number of draws, which is part of its contract. ----

/** Uniform in [lo, hi). One draw. */
export function uniform(r: Random, lo: number, hi: number): number {
  return lo + (hi - lo) * r()
}

/** Integer in [lo, hi], inclusive. One draw. */
export function intBetween(r: Random, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1))
}

/** True with probability p. One draw. */
export function chance(r: Random, p: number): boolean {
  return r() < p
}

/** One element, uniformly. One draw. */
export function pick<T>(r: Random, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty list')
  return items[Math.floor(r() * items.length)]
}

/**
 * Index chosen with probability proportional to its weight (the prototypes'
 * `pickW`). One draw; returns -1 when no weight is positive.
 */
export function weightedIndex(r: Random, weights: readonly number[]): number {
  let total = 0
  for (const w of weights) total += w
  if (!(total > 0)) return -1
  let u = r() * total
  for (let k = 0; k < weights.length; k++) {
    u -= weights[k]
    if (u <= 0) return k
  }
  return weights.length - 1
}

/**
 * Standard normal deviate, Box–Muller, cosine branch only (the prototypes'
 * `gauss`). Two draws, plus one more each time the first draw is exactly 0.
 */
export function normal(r: Random, mean = 0, sd = 1): number {
  let u = 0
  while (u === 0) u = r()
  const v = r()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Poisson count. Under a mean of 30, Knuth's product method (a variable number
 * of draws); at 30 and above, the rounded normal approximation star-gen.js
 * used (two draws).
 */
export function poisson(r: Random, mean: number): number {
  if (!(mean > 0)) return 0
  if (mean >= 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(r)))
  const limit = Math.exp(-mean)
  let k = 0
  let p = r()
  while (p > limit) {
    k++
    p *= r()
  }
  return k
}

/** A shuffled copy (Fisher–Yates from the end). n − 1 draws. */
export function shuffled<T>(r: Random, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
