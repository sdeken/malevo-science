import { mulberry32 } from '@malevo/core'
import type { HistoryInput, HistoryStar } from '@malevo/gen'

/** A synthetic star field (nobody's setting): `n` stars in a slab around the origin. */
export function syntheticStars(n: number, size: number, seed = 5): HistoryStar[] {
  const r = mulberry32(seed)
  const classes = ['M', 'M', 'M', 'M', 'M', 'K', 'K', 'G', 'F', 'A', 'D']
  const stars: HistoryStar[] = [{ id: 's0', pos: [0, 0, 0], cls: 'G', name: 'Home' }]
  for (let k = 1; k < n; k++)
    stars.push({
      id: `s${k}`,
      pos: [(r() - 0.5) * size, (r() - 0.5) * size, (r() - 0.5) * size * 0.3],
      cls: classes[Math.floor(r() * classes.length)],
      name: null
    })
  return stars
}

export function syntheticInput(stars: HistoryStar[], over: Partial<HistoryInput> = {}): HistoryInput {
  return {
    stars,
    origin: 's0',
    originCulture: 'first',
    palettes: { first: 4, belief: 1 },
    legLimit: 15,
    nebulae: [],
    years: { slow: 300, foam: 650, end: 1000, polities: 850 },
    step: 10,
    slow: { reach: 20, colonies: 5 },
    growth: { total: 120, maxRadius: 110, outward: 7, legs: 2 },
    culture: { enclave: 0.1, split: 0.3, splitDistance: 50, blend: 0.03 },
    enclaves: [{ culture: 'belief', from: 700 }],
    polities: [
      { key: 'north', share: 0.3, capital: null, unify: 0.05 },
      { key: 'south', share: 0.3, capital: null, unify: 0 }
    ],
    fixed: [],
    ...over
  }
}
