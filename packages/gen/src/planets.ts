/**
 * planets@1: a plausible planetary system for a star, to roll and then keep.
 *
 * Each roll is its own keyed stream, `(world seed, "planets", system id,
 * "roll:<n>")`, so rolling again never disturbs another system, and roll n
 * of a system is the same every time. A kept roll becomes locked bodies that
 * record this generator and their seed (docs/PLAN.md §3.1).
 *
 * The recipe, in order (the order of draws is part of the frozen contract):
 * - how many planets: Poisson, with a mean by spectral class;
 * - the first orbit just outside the dust-sublimation edge (0.04·√L AU),
 *   each next one 1.4–2.1 times further out, pushed further if needed to
 *   keep neighbours at least 8 mutual Hill radii apart;
 * - mass and class: inside the snow line (2.7·√L AU), rocky (or, in the
 *   habitable zone, sometimes ocean) worlds of 0.03–8 Earth masses; beyond
 *   it, a class-dependent chance of a gas giant (50–3000) or ice giant
 *   (10–50), otherwise small rocky or dwarf bodies;
 * - radius from mass (Chen & Kipping 2017);
 * - small eccentricities and inclinations (Rayleigh, σ 0.05 and 1.5°);
 * - rotation: tidally locked inside 0.1·∛M AU, otherwise 8–18 h for giants
 *   and 10–200 h for the rest, 5% retrograde; tilts mostly modest.
 */
import { keyedStream, normal, poisson, streamSeed, uniform, type Random } from '@malevo/core'
import { defineGenerator } from './generator'

export interface PlanetsInput {
  /** The system's id: names the stream and prefixes the bodies' ids. */
  system: string
  systemName: string
  star: { mass_msun: number; luminosity_lsun: number; cls: string }
  /** Which roll: 0, 1, 2, … */
  roll: number
}

/** A body file as planets@1 writes it (matches @malevo/model's body schema). */
export interface PlanetFile {
  name: string
  system: string
  class: 'rocky' | 'ocean' | 'ice-giant' | 'gas-giant' | 'dwarf'
  orbit: { a_au: number; e: number; i_deg: number; node_deg: number; peri_deg: number; meanAnomaly_deg: number; epoch: { t_s: number } }
  mass_mearth: number
  radius_km: number
  rotation: { period_h?: number; locked?: true; tilt_deg: number }
  lock: { gen: string; seed: number; inputs: Record<string, string> }
}

const MEAN_COUNT: Record<string, number> = { B: 1, A: 2.5, F: 4.5, G: 5, K: 4.5, M: 3, D: 0.5 }
const GIANT_CHANCE: Record<string, number> = { B: 0.2, A: 0.35, F: 0.4, G: 0.4, K: 0.3, M: 0.12, D: 0.1 }
const M_EARTH_PER_SUN = 332946.0487

const logUniform = (r: Random, lo: number, hi: number): number => Math.exp(uniform(r, Math.log(lo), Math.log(hi)))
const rayleigh = (r: Random, sigma: number): number => sigma * Math.sqrt(-2 * Math.log(1 - r()))

/** Radius in Earth radii from mass in Earth masses (Chen & Kipping 2017, mean relation). */
export function radiusFromMass(m: number): number {
  if (m < 2.04) return 1.008 * m ** 0.279
  if (m < 131.6) return 0.808 * m ** 0.589
  return 17.74 * m ** -0.044
}

const LETTERS = 'bcdefghijk'

export const planets = defineGenerator<PlanetsInput, { bodies: { id: string; value: PlanetFile }[] }>({
  name: 'planets',
  version: 1,
  description: 'A plausible planetary system for a star: roll it, then keep it as locked bodies.',
  frozen: true,
  generate(input, ctx) {
    const purpose = `roll:${input.roll}`
    const r = ctx.stream(input.system, purpose)
    const seed = streamSeed(ctx.worldSeed, 'planets', input.system, purpose)
    const { mass_msun: M, luminosity_lsun: L, cls } = input.star
    const sqrtL = Math.sqrt(Math.max(L, 1e-6))
    const inner = Math.max(0.02, 0.04 * sqrtL)
    const snow = 2.7 * sqrtL
    const hz: [number, number] = [0.95 * sqrtL, 1.67 * sqrtL]
    const outerLimit = 80 * Math.cbrt(M)
    const n = Math.min(LETTERS.length, poisson(r, MEAN_COUNT[cls] ?? 3))
    const bodies: { id: string; value: PlanetFile }[] = []
    let a = inner * uniform(r, 1, 2.5)
    let prev: { a: number; m: number } | null = null
    for (let i = 0; i < n; i++) {
      if (i > 0) a *= uniform(r, 1.4, 2.1)
      // Mass and class.
      const u = r()
      const v = r()
      let mass: number
      let klass: PlanetFile['class']
      if (a > snow) {
        if (u < (GIANT_CHANCE[cls] ?? 0.2)) {
          if (v < 0.6) {
            mass = logUniform(r, 50, 3000)
            klass = 'gas-giant'
          } else {
            mass = logUniform(r, 10, 50)
            klass = 'ice-giant'
          }
        } else {
          mass = logUniform(r, 0.01, 3)
          klass = mass < 0.1 ? 'dwarf' : 'rocky'
        }
      } else {
        mass = logUniform(r, 0.03, 8)
        klass = a > hz[0] && a < hz[1] && v < 0.3 ? 'ocean' : 'rocky'
      }
      // Keep neighbours apart: at least 8 mutual Hill radii.
      if (prev) {
        const mutualHill = (((prev.m + mass) / (3 * M * M_EARTH_PER_SUN)) ** (1 / 3) * (prev.a + a)) / 2
        if (a - prev.a < 8 * mutualHill) a = prev.a + 8 * mutualHill * 1.05
      }
      if (a > outerLimit) break
      const e = Math.min(0.6, rayleigh(r, 0.05))
      const inc = Math.min(10, rayleigh(r, 1.5))
      const node = r() * 360
      const peri = r() * 360
      const meanAnomaly = r() * 360
      const locked = a < 0.1 * Math.cbrt(M)
      const giant = klass === 'gas-giant' || klass === 'ice-giant'
      const spin = giant ? uniform(r, 8, 18) : logUniform(r, 10, 200)
      const retro = r() < 0.05
      const tilt = Math.min(180, Math.abs(normal(r, 0, 20)))
      const letter = LETTERS[bodies.length]
      bodies.push({
        id: `${input.system}-${letter}`,
        value: {
          name: `${input.systemName} ${letter}`,
          system: input.system,
          class: klass,
          orbit: { a_au: a, e, i_deg: inc, node_deg: node, peri_deg: peri, meanAnomaly_deg: meanAnomaly, epoch: { t_s: 0 } },
          mass_mearth: mass,
          radius_km: radiusFromMass(mass) * 6371,
          rotation: locked ? { locked: true, tilt_deg: retro ? 180 - tilt : tilt } : { period_h: retro ? -spin : spin, tilt_deg: tilt },
          lock: { gen: 'planets@1', seed, inputs: {} }
        }
      })
      prev = { a, m: mass }
    }
    return { bodies }
  }
})

/** A stream for planets@1 outside a generator context (for tests and previews). */
export function planetsStream(worldSeed: number, system: string, roll: number): Random {
  return keyedStream(worldSeed, 'planets', system, `roll:${roll}`)
}
