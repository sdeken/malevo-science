import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEG, JULIAN_YEAR } from '@malevo/core'
import {
  conditionsAt,
  newTerrain,
  populationAt,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  terrainKind,
  type Conditions,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const world = (extra: WorldFile[]) =>
  readWorld([{ path: 'world.json', text: '{"format": 1, "name": "C", "seed": 2}' }, ...templateFiles(), ...sol(), ...extra])
const city = (id: string, lat: number, lon: number, more: object = {}) =>
  json(`cities/${id}.json`, { name: id, body: 'earth', lat_deg: lat, lon_deg: lon, ...more })
const cond = (w: ReturnType<typeof world>, id: string, t = 0): Conditions => {
  const c = conditionsAt(w, env, id, t)
  if ('error' in c) throw new Error(c.error)
  return c
}

describe('population', () => {
  it('grows by the same factor each year between dates, and is none before the first', () => {
    const pts = [
      { t: 0, people: 1000 },
      { t: 10 * JULIAN_YEAR, people: 100_000 }
    ]
    expect(populationAt(pts, -1)).toBe(0)
    expect(populationAt(pts, 5 * JULIAN_YEAR)).toBeCloseTo(10_000, 6)
    expect(populationAt(pts, 50 * JULIAN_YEAR)).toBe(100_000)
  })
})

describe('conditions at a time', () => {
  it('gives Greenwich at J2000.0 its noon, its short winter day and the Moon’s tide', () => {
    const w = world([city('greenwich', 51.4769, 0, { population: [{ from: { at: { t_s: -10 * JULIAN_YEAR } }, people: 8e6 }] })])
    const c = cond(w, 'greenwich')
    // 12:00 at Greenwich, less the equation of time (about 3 minutes in early January).
    expect(c.localHours!).toBeGreaterThan(11.8)
    expect(c.localHours!).toBeLessThan(12.1)
    expect(c.season).toMatchObject({ name: 'winter', hemisphere: 'north', seasons: true })
    expect(c.daylight.day!).toBeGreaterThan(7.6)
    expect(c.daylight.day!).toBeLessThan(8.3)
    expect(c.daylight.sunrise!).toBeCloseTo(12 - c.daylight.day! / 2, 6)
    expect(c.sun.alt / DEG).toBeCloseTo(15.5, 0)
    // The Moon raises about twice the Sun's tide.
    expect(c.tide?.main).toBe('moon')
    expect(c.tide!.level).toBeGreaterThanOrEqual(0)
    expect(c.tide!.level).toBeLessThanOrEqual(1)
    expect(c.population).toBe(8e6)
    // Six hours on, it is evening; the equator has about twelve hours of day.
    expect(cond(w, 'greenwich', 6 * 3600).localHours!).toBeCloseTo(c.localHours! + 6, 1)
    const eq = cond(world([city('quito', 0, -78.5)]), 'quito')
    expect(eq.daylight.day!).toBeCloseTo(12.1, 0)
  })

  it('is summer in the south while winter in the north, and polar night at the pole', () => {
    expect(cond(world([city('south', -34, 18.4)]), 'south').season.name).toBe('summer')
    expect(cond(world([city('pole', 89, 0)]), 'pole').daylight.polar).toBe('night')
  })

  it('flags a city under the sea', () => {
    const w = world([
      {
        path: 'terrains/earth.json',
        text: serializeEntity(terrainKind, {
          ...newTerrain('earth', 'ocean'),
          params: { ...newTerrain('earth', 'ocean').params, ocean: 1 }
        })
      },
      city('atlantis', 0, -30)
    ])
    expect(
      runChecks(w, env)
        .filter((i) => i.check === 'cities')
        .map((i) => i.code)
    ).toEqual(['under-water'])
  })
})
