import { mulberry32 } from '@malevo/core'
import type { HistoryInput, HistoryStar, PlanInput } from '@malevo/gen'

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

/** A synthetic city plan (nobody's city): a plateau over a flat, with every preset and a service or two. */
export function syntheticPlan(): PlanInput {
  return {
    planId: 'test-city',
    seed: 3,
    defaults: { groundZ: 0, surface: 'mud' },
    ground: [
      {
        id: 'flat',
        poly: [
          [-2000, -2000],
          [2000, -2000],
          [2000, 0],
          [-2000, 0]
        ],
        z: 1,
        surface: 'paved'
      },
      {
        id: 'plateau',
        poly: [
          [-2000, 0],
          [2000, 0],
          [2000, 2000],
          [-2000, 2000]
        ],
        z: 150,
        surface: 'grass'
      }
    ],
    water: [
      {
        id: 'bay',
        poly: [
          [-2000, -2000],
          [2000, -2000],
          [2000, -1500],
          [-2000, -1500]
        ],
        z: 0,
        kind: 'sea'
      }
    ],
    regions: [
      {
        id: 'towers',
        preset: 'buildings',
        poly: [
          [-1500, -1200],
          [0, -1200],
          [0, -200],
          [-1500, -200]
        ],
        params: { block: [80, 80], street: 20, height: { kind: 'peak', at: [-700, -700], radius: 500, min: 20, max: 300, skew: 2 } }
      },
      {
        id: 'cliffside',
        preset: 'cliff',
        poly: [
          [-1800, -100],
          [1800, -100],
          [1800, 100],
          [-1800, 100]
        ]
      },
      {
        id: 'docks',
        preset: 'yards',
        poly: [
          [200, -1400],
          [1800, -1400],
          [1800, -600],
          [200, -600]
        ]
      },
      {
        id: 'suburbs',
        preset: 'scatter',
        poly: [
          [-1800, 300],
          [1800, 300],
          [1800, 1800],
          [-1800, 1800]
        ],
        params: { density: 60 }
      }
    ],
    buildings: [{ id: 'tower-of-note', center: [-700, -700], size: [60, 60], h: 400 }],
    lines: [
      {
        id: 'main-road',
        kind: 'avenue',
        pts: [
          [-1900, -300],
          [1900, -300]
        ]
      },
      {
        id: 'tram',
        kind: 'lightrail',
        pts: [
          [-1900, -250],
          [1900, -250]
        ],
        service: { headway_s: 300, speed_ms: 15, accel_ms2: 1, dwell_s: 30, stopEvery_m: 500, hours: [5, 23] }
      },
      {
        id: 'incline',
        kind: 'funicular',
        pts: [
          [1000, -60, 1],
          [1000, 60, 150]
        ],
        service: { speed_ms: 5, accel_ms2: 0.6, dwell_s: 60 }
      }
    ]
  }
}
