import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { mainSequenceStar } from '@malevo/core'
import { readWorld, routeWorld, runChecks, skyStars, systemInfo, templateFiles, type WorldEnv, type WorldFile } from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const planet = (system: string): WorldFile =>
  json(`bodies/${system}-b.json`, {
    name: 'B',
    system,
    class: 'rocky',
    orbit: { a_au: 0.8, e: 0.02, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
    mass_mearth: 1,
    radius_km: 6371,
    rotation: { period_h: 26, tilt_deg: 20 }
  })
const world = (sys: object, id = 'far') =>
  readWorld([
    { path: 'world.json', text: '{"format": 1, "name": "D", "seed": 3}' },
    ...templateFiles(),
    json(`systems/${id}.json`, { name: 'Far', ...sys }),
    planet(id)
  ])

describe('typical main-sequence stars', () => {
  it('reads spectral types and gives the Sun for G2V', () => {
    const g2 = mainSequenceStar('G2V')!
    expect(g2.physics.mass).toBeCloseTo(1, 2)
    expect(g2.physics.luminosity).toBeCloseTo(1, 1)
    expect(g2.physics.teff).toBe(5772)
    const k1 = mainSequenceStar('K1')!
    expect(k1.physics.mass!).toBeLessThan(0.9)
    expect(k1.physics.luminosity).toBeLessThan(0.6)
    expect(mainSequenceStar('M4.5V')!.physics.mass!).toBeLessThan(0.3)
    expect(mainSequenceStar('G2III')).toBe(null)
  })
})

describe('a detached system', () => {
  it('works out its bodies from its own star, with no place among the stars', () => {
    const w = world({ spect: 'K1V' })
    expect(w.issues).toEqual([])
    const info = systemInfo(w, env, 'far')!
    expect(info.star!.placement).toBe('detached')
    expect(info.star!.physics.mass!).toBeLessThan(0.9)
    const b = info.bodies[0]
    expect(b.error).toBe(null)
    expect(b.period! / 86400).toBeGreaterThan(250)
    expect(b.insolation!).toBeGreaterThan(0)
    // No sky but its own, no routes to it.
    expect(skyStars(w, env, 'far')!.ids).toEqual([])
    expect(routeWorld(w, env).node('system:far').pos).toBe(null)
    expect(runChecks(w, env).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('needs a spectral type without a star', () => {
    const w = world({})
    expect(runChecks(w, env).some((i) => i.severity === 'error' && /spectral type/.test(i.message))).toBe(true)
  })

  it('borrows a stand-in’s place (and sky) while keeping its own star', () => {
    const w = world({ spect: 'K1V', star: 'hip.70890', provisional: true })
    const info = systemInfo(w, env, 'far')!
    expect(info.star!.placement).toBe('stand-in')
    // Its own K1 star, not Proxima's M dwarf.
    expect(info.star!.physics.mass!).toBeGreaterThan(0.7)
    expect(skyStars(w, env, 'far')!.ids.length).toBeGreaterThan(100)
    expect(routeWorld(w, env).node('system:far').pos).not.toBe(null)
  })
})
