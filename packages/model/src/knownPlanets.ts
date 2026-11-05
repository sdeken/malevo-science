/**
 * Planets found around real stars, as world files. Like the Solar System,
 * this is astronomy, not anyone's setting: a system made on one of these
 * stars starts with its confirmed planets, and the author may change or
 * delete any of them.
 *
 * What the measurements give and what they leave open:
 * - Radial-velocity planets have a period, a semi-major axis and a minimum
 *   mass (m sin i). The inclination is unknown, so the orbits are put in the
 *   system's plane and the masses are the minimum masses.
 * - Radii are not measured. They are estimated from the masses (a rocky
 *   M^0.27 law, a volatile-rich one above about two Earth masses).
 * - Where each planet is along its orbit at a date is not taken from the
 *   published ephemerides: the mean anomalies are placeholders.
 * - Close-in planets of red dwarfs are taken as tidally locked.
 *
 * Candidates that later work disputes are listed but added only on request.
 */
import { bodyKind, entityPath, systemKind, type BodyFile, type KindDef } from './kinds'
import { entitiesOf, type WorldData } from './load'

export interface KnownPlanet {
  /** Body id in the world. */
  id: string
  name: string
  cls: BodyFile['class']
  a_au: number
  period_d: number
  e: number
  /** Minimum mass, Earth masses. */
  msini_mearth: number
  radius_km: number
  locked: boolean
  /** Rotation period, hours, when not locked (a placeholder: unmeasured). */
  period_h?: number
  /** Disputed or unconfirmed: added only when asked for. */
  candidate?: boolean
  note: string
}

export interface KnownSystem {
  star: string
  name: string
  sources: string
  planets: KnownPlanet[]
}

const R_EARTH_KM = 6371
const rockyRadius = (m: number): number => Math.round(R_EARTH_KM * Math.pow(m, 0.27))

export const KNOWN_SYSTEMS: readonly KnownSystem[] = [
  {
    star: 'hip.70890',
    name: 'Proxima Centauri',
    sources:
      'Anglada-Escudé et al. 2016 (b); Faria et al. 2022, ESPRESSO (b, d); Damasso et al. 2020 (candidate c, questioned by later work)',
    planets: [
      {
        id: 'proxima-d',
        name: 'Proxima d',
        cls: 'rocky',
        a_au: 0.02885,
        period_d: 5.122,
        e: 0,
        msini_mearth: 0.26,
        radius_km: rockyRadius(0.26),
        locked: true,
        note: 'Confirmed. Inside the habitable zone’s inner edge: too hot for liquid water.'
      },
      {
        id: 'proxima-b',
        name: 'Proxima b',
        cls: 'rocky',
        a_au: 0.04857,
        period_d: 11.1868,
        e: 0.02,
        msini_mearth: 1.07,
        radius_km: rockyRadius(1.07),
        locked: true,
        note: 'Confirmed. In the habitable zone; whether it keeps an atmosphere under its star’s flares is unknown.'
      },
      {
        id: 'proxima-c',
        name: 'Proxima c',
        cls: 'ice-giant',
        a_au: 1.489,
        period_d: 1928,
        e: 0.04,
        msini_mearth: 7,
        radius_km: 16000,
        locked: false,
        period_h: 17,
        candidate: true,
        note: 'Candidate from radial velocities; later data has not confirmed it, and it may not exist.'
      }
    ]
  }
]

export function knownSystemOf(starId: string | null | undefined): KnownSystem | null {
  return KNOWN_SYSTEMS.find((k) => k.star === starId) ?? null
}

/**
 * The known planets of a system's star that the world does not have yet, as
 * files (bodies whose ids are taken are left out). Candidates only when asked.
 */
export function knownPlanetsFor(
  world: WorldData,
  systemId: string,
  opts: { candidates?: boolean } = {}
): { path: string; kind: KindDef; id: string; value: unknown }[] {
  const sys = entitiesOf(world, systemKind).find((e) => e.id === systemId)
  const known = knownSystemOf(sys?.value.star)
  if (!sys || !known) return []
  const taken = new Set(entitiesOf(world, bodyKind).map((e) => e.id))
  return known.planets
    .filter((p) => !taken.has(p.id) && (opts.candidates || !p.candidate))
    .map((p, k) => {
      const body: BodyFile = {
        name: p.name,
        system: systemId,
        class: p.cls,
        orbit: { a_au: p.a_au, e: p.e, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: (k * 137) % 360, epoch: { t_s: 0 } },
        mass_mearth: p.msini_mearth,
        radius_km: p.radius_km,
        rotation: p.locked ? { locked: true, tilt_deg: 0 } : { period_h: p.period_h ?? 17, tilt_deg: 0 }
      }
      return { path: entityPath(bodyKind as KindDef, p.id), kind: bodyKind as KindDef, id: p.id, value: body }
    })
}
