import { describe, expect, it } from 'vitest'
import { DEG, fromLatLon } from '@malevo/core'
import { runGenerator, terrain } from '@malevo/gen'
import {
  newTerrain,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  terrainKind,
  terrainRaster,
  terrainSampler,
  type TerrainFile,
  type WorldFile
} from '@malevo/model'

const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const terrainFile = (body: string, t: TerrainFile): WorldFile => ({ path: `terrains/${body}.json`, text: serializeEntity(terrainKind, t) })
const world = (extra: WorldFile[], replace: (f: WorldFile) => WorldFile = (f) => f) =>
  readWorld([{ path: 'world.json', text: '{"format": 1, "name": "T", "seed": 4}' }, ...templateFiles(), ...sol().map(replace), ...extra])
const earth = (over: Partial<TerrainFile> = {}): WorldFile => terrainFile('earth', { ...newTerrain('earth', 'ocean'), ...over })
const sampler = (w: ReturnType<typeof world>, body = 'earth') => {
  const s = terrainSampler(w, {}, body)
  if ('error' in s) throw new Error(s.error)
  return s
}

describe('terrain', () => {
  it('makes a map with the ocean asked for, ice at the poles and warmth at the equator', () => {
    const w = world([earth()])
    expect(w.issues).toEqual([])
    expect(runChecks(w).filter((i) => i.severity === 'error')).toEqual([])
    const r = terrainRaster(w, {}, 'earth', 180, 90)
    if ('error' in r) throw new Error(r.error)
    expect(Math.abs(r.stats.ocean - 0.75)).toBeLessThan(0.06)
    expect(r.stats.meanTemp!).toBeGreaterThan(275)
    expect(r.stats.meanTemp!).toBeLessThan(300)
    const s = sampler(w)
    expect(['ice', 'sea-ice', 'tundra']).toContain(s.sample(fromLatLon(89 * DEG, 0)).biome)
    expect(s.sample(fromLatLon(0, 0)).t!).toBeGreaterThan(285)
  })

  it('follows the planet: moved outward it is colder, unless its temperature is fixed', () => {
    const out = (f: WorldFile): WorldFile =>
      f.path === 'bodies/earth.json' ? { ...f, text: (f.text ?? '').replace('"a_au": 1.00000261', '"a_au": 1.6') } : f
    const near = terrainRaster(world([earth()]), {}, 'earth', 90, 45)
    const far = terrainRaster(world([earth()], out), {}, 'earth', 90, 45)
    if ('error' in near || 'error' in far) throw new Error('raster')
    expect(far.stats.meanTemp!).toBeLessThan(near.stats.meanTemp! - 30)
    const fixed = terrainRaster(world([earth({ climate: { temperature_K: 288 } })], out), {}, 'earth', 90, 45)
    if ('error' in fixed) throw new Error('raster')
    expect(fixed.stats.meanTemp!).toBeGreaterThan(280)
  })

  it('applies hand shaping drawn in latitude and longitude', () => {
    const plain = sampler(world([earth({ params: { ...newTerrain('earth', 'ocean').params, ocean: 1 } })]))
    const p = fromLatLon(10 * DEG, 20 * DEG)
    expect(plain.height(p)).toBeLessThan(0)
    const shaped = sampler(
      world([
        earth({
          params: { ...newTerrain('earth', 'ocean').params, ocean: 1 },
          shapes: [
            {
              kind: 'land',
              points: [
                [0, 0],
                [0, 40],
                [20, 40],
                [20, 0]
              ]
            },
            {
              kind: 'ridge',
              points: [
                [-30, 0],
                [-30, 40]
              ],
              height_km: 4,
              width_deg: 2
            }
          ]
        })
      ])
    )
    expect(shaped.height(p)).toBeGreaterThan(0)
    // A ridge runs along the great circle between its points, which bows poleward of the 30th parallel: test at its middle.
    const a = fromLatLon(-30 * DEG, 0)
    const b = fromLatLon(-30 * DEG, 40 * DEG)
    const m = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
    const mid = m.map((x) => x / Math.hypot(...m)) as [number, number, number]
    expect(shaped.height(mid) - plain.height(mid)).toBeCloseTo(4, 1)
    expect(shaped.height(fromLatLon(-50 * DEG, 20 * DEG))).toBeCloseTo(plain.height(fromLatLon(-50 * DEG, 20 * DEG)), 6)
  })

  it('reads the same heights as the frozen generator, at any point', () => {
    const s = sampler(world([earth()]))
    const pts = [fromLatLon(0.3, 1.1), fromLatLon(-1.2, -2.5)]
    expect(runGenerator(terrain, { body: 'earth', roll: 0, params: newTerrain('earth', 'ocean').params, points: pts }, 4)).toEqual(
      pts.map((p) => Math.round(s.height(p) * 1e4) / 1e4)
    )
  })

  it('gives a locked world a hot day side and a frozen night side', () => {
    const lockMercury = (f: WorldFile): WorldFile =>
      f.path === 'bodies/mercury.json'
        ? { ...f, text: (f.text ?? '').replace(/"rotation": \{[^}]*\}/, '"rotation": { "locked": true, "tilt_deg": 0 }') }
        : f
    const s = sampler(world([terrainFile('mercury', newTerrain('mercury', 'rocky'))], lockMercury), 'mercury')
    expect(s.sample(fromLatLon(0, 0)).t!).toBeGreaterThan(500)
    expect(s.sample(fromLatLon(0, 180 * DEG)).t!).toBeLessThan(150)
  })
})

describe('giants', () => {
  it('draws cloud bands for a gas giant, banded by latitude, with no surface', async () => {
    const { newBands } = await import('@malevo/model')
    const w = world([terrainFile('jupiter', newBands('jupiter', 'gas-giant'))])
    expect(runChecks(w).filter((i) => i.check === 'terrain')).toEqual([])
    const r = terrainRaster(w, {}, 'jupiter', 64, 32)
    if ('error' in r) throw new Error(r.error)
    expect(r.stats.ocean).toBe(0)
    // Colour changes much more from north to south than from east to west.
    const px = (i: number, j: number) => [...r.rgba.slice((j * 64 + i) * 4, (j * 64 + i) * 4 + 3)]
    let ns = 0
    let ew = 0
    for (let j = 4; j < 28; j++)
      for (let i = 0; i < 63; i++) {
        ew += px(i, j).reduce((s, v, k) => s + Math.abs(v - px(i + 1, j)[k]), 0)
        ns += px(i, j).reduce((s, v, k) => s + Math.abs(v - px(i, j + 1)[k]), 0)
      }
    expect(ns).toBeGreaterThan(ew * 1.5)
    // A surface terrain on a giant is flagged.
    const wrong = world([terrainFile('jupiter', newTerrain('jupiter', 'gas-giant'))])
    expect(
      runChecks(wrong)
        .filter((i) => i.check === 'terrain')
        .map((i) => i.code)
    ).toEqual(['giant-needs-bands'])
  })
})
