import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { addBuiltins, readWorld, runChecks, templateFiles, type WorldEnv, type WorldFile } from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const orbit = (a_au: number, e = 0.01) => ({ a_au, e, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } })
const planet = (id: string, cls: string, a: number, mass_mearth: number, radius_km: number, extra: object = {}) =>
  json(`bodies/${id}.json`, {
    name: id,
    system: 'altaris',
    class: cls,
    orbit: orbit(a),
    mass_mearth,
    radius_km,
    rotation: { period_h: 24, tilt_deg: 20 },
    ...extra
  })
const world = (bodies: WorldFile[]) =>
  addBuiltins(
    readWorld([
      { path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' },
      ...templateFiles(),
      json('systems/altaris.json', { name: 'Altaris', spect: 'K1V' }),
      ...bodies
    ])
  )
const issues = (bodies: WorldFile[]) =>
  runChecks(world(bodies), env)
    .filter((i) => i.check === 'systems' && i.path?.startsWith('bodies/') && !i.path.includes('/earth') && i.code !== 'no-catalogue')
    .map((i) => `${i.code} ${i.path}`)

describe('whether a system is like real ones', () => {
  it('lets the real Solar System pass', () => {
    const w = addBuiltins(readWorld([{ path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' }, ...templateFiles()]))
    const sol = runChecks(w, env).filter((i) => i.check === 'systems')
    expect(sol).toEqual([])
    expect(w.entities.has('body/jupiter')).toBe(true)
  })

  it('lets an Earth analogue with a giant at the edge of the collapse pass', () => {
    expect(
      issues([
        planet('home', 'ocean', 0.6, 1, 6371),
        planet('giant', 'gas-giant', 2.5, 318, 69911, { rotation: { period_h: 10, tilt_deg: 3 } })
      ])
    ).toEqual([])
  })

  it('says when neighbours are too close, or packed too tight to last', () => {
    expect(issues([planet('a', 'rocky', 0.6, 1, 6371), planet('b', 'gas-giant', 0.68, 318, 69911)])).toContain('too-close bodies/b.json')
    expect(issues([planet('a', 'rocky', 0.6, 1, 6371), planet('b', 'rocky', 0.65, 1, 6371)])).toContain('tightly-packed bodies/b.json')
    // An eccentric giant swinging close to the inner planet.
    expect(issues([planet('a', 'rocky', 0.6, 1, 6371), planet('b', 'gas-giant', 1.6, 318, 69911, { orbit: orbit(1.6, 0.5) })])).toContain(
      'too-close bodies/b.json'
    )
  })

  it('says when a density is unlike the kind of planet, or a rocky planet is too big to be bare rock', () => {
    expect(issues([planet('a', 'rocky', 0.6, 1, 12000)])).toContain('implausible-density bodies/a.json')
    expect(issues([planet('a', 'gas-giant', 2.5, 318, 20000)])).toContain('implausible-density bodies/a.json')
    expect(issues([planet('a', 'rocky', 0.6, 8, 12500)])).toContain('radius-valley bodies/a.json')
  })

  it('says when tides would have stopped a spin long ago', () => {
    expect(issues([planet('a', 'rocky', 0.05, 1, 6371)])).toContain('tidally-locked bodies/a.json')
    expect(issues([planet('a', 'rocky', 0.05, 1, 6371, { rotation: { locked: true, tilt_deg: 0 } })])).not.toContain(
      'tidally-locked bodies/a.json'
    )
    expect(issues([planet('a', 'rocky', 0.6, 1, 6371)])).not.toContain('tidally-locked bodies/a.json')
  })
})
