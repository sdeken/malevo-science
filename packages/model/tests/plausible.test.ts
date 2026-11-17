import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { addBuiltins, readWorld, runChecks, templateFiles, type WorldEnv, type WorldFile } from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'
import { mainSequenceStar } from '@malevo/core'
import { planets2, runGenerator } from '@malevo/gen'

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

describe('planets@2 makes systems that pass', () => {
  const roll = (
    spect: string,
    seed: number,
    n: number,
    existing: { name: string; a_au: number; e: number; mass_mearth: number }[] = []
  ) => {
    const star = mainSequenceStar(spect)!
    return runGenerator(
      planets2,
      {
        system: 'altaris',
        systemName: 'Altaris',
        star: { mass_msun: star.physics.mass!, luminosity_lsun: star.physics.luminosity, cls: star.cls },
        roll: n,
        existing
      },
      seed
    ).bodies.map((b) => json(`bodies/${b.id}.json`, b.value))
  }
  const sysFile = (spect: string): WorldFile => json('systems/altaris.json', { name: 'Altaris', spect })
  const check = (spect: string, bodies: WorldFile[]) =>
    runChecks(
      addBuiltins(
        readWorld([{ path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' }, ...templateFiles(), sysFile(spect), ...bodies])
      ),
      env
    )
      .filter((i) => i.check === 'systems' && i.path?.startsWith('bodies/altaris') && i.code !== 'no-catalogue')
      .map((i) => `${i.code} ${i.path}: ${i.message}`)

  it('with no warnings or notes, around every kind of star', () => {
    let planets = 0
    for (const spect of ['A0V', 'F5V', 'G2V', 'K1V', 'M0V', 'M4.5V'])
      for (const seed of [1, 7, 42])
        for (let n = 0; n < 6; n++) {
          const bodies = roll(spect, seed, n)
          planets += bodies.length
          expect(check(spect, bodies), `${spect} seed ${seed} roll ${n}`).toEqual([])
        }
    expect(planets).toBeGreaterThan(150)
  })

  it('around planets the system already has, skipping their letters', () => {
    const own = [
      { name: 'Altaris b', a_au: 0.05, e: 0.1, mass_mearth: 1.1 },
      { name: 'Altaris d', a_au: 0.3, e: 0.05, mass_mearth: 8 }
    ]
    const files = own.map((p, k) =>
      json(`bodies/altaris-own-${k}.json`, {
        name: p.name,
        system: 'altaris',
        class: 'rocky',
        orbit: orbit(p.a_au, p.e),
        mass_mearth: p.mass_mearth,
        radius_km: k ? 9000 : 6600,
        rotation: { locked: true, tilt_deg: 0 }
      })
    )
    for (let n = 0; n < 12; n++) {
      const bodies = roll('M4.5V', 3, n, own)
      expect(bodies.some((b) => / [bd]"/.test(b.text ?? ''))).toBe(false)
      const found = check('M4.5V', [...files, ...bodies]).filter((i) => !i.includes('altaris-own-'))
      expect(found, `roll ${n}`).toEqual([])
    }
  })
})
