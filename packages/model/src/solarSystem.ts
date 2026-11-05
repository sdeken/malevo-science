/**
 * The real Solar System, as world files: Sol, its planets, dwarf planets,
 * major moons, the main belt and the Kuiper belt. This is astronomy, not
 * anyone's setting; it is here so every world starts with the place it all
 * starts from, and the author may change or delete any of it.
 *
 * Sources, kept in their published form and converted below:
 * - Planets (and Pluto): JPL "Keplerian elements for approximate positions
 *   of the major planets" (Standish), Table 1, J2000 ecliptic and equinox.
 *   Earth is the Earth–Moon barycentre.
 * - The Moon: mean elements at J2000.
 * - Dwarf planets other than Pluto: osculating elements from the JPL
 *   Small-Body Database, rounded; their positions are approximate.
 * - Orientation and rotation: IAU WGCCRE (Archinal et al. 2018): each body's
 *   north pole (RA, Dec), prime meridian W₀ at J2000 and rotation rate. The
 *   conversion gives each body's tilt to its orbit, the orbital longitude of
 *   its northern spring equinox, and its prime meridian in this app's terms.
 * - Regular moons orbit in their planet's equatorial plane (taken from the
 *   planet's pole). Their sizes, masses and periods are right; where they are
 *   along their orbits at a date is not (only the Moon's is).
 * - Physical values: NASA planetary fact sheets.
 *
 * The system's frame is the J2000 ecliptic, placed in the galaxy, so the
 * elements are used as published and the sky from Earth matches the real one.
 */
import {
  DEG,
  ECLIPTIC_TO_EQUATORIAL,
  EQUATORIAL_TO_ECLIPTIC,
  EQUATORIAL_TO_GALACTIC,
  cross,
  dot,
  fromSpherical,
  mulVec,
  normalize,
  type Vec3
} from '@malevo/core'
import { bodyKind, entityPath, systemKind, type BodyFile, type KindDef, type SystemFile } from './kinds'
import { entitiesOf, type WorldData } from './load'

const M_EARTH_KG = 5.9722e24
const norm360 = (x: number): number => Math.round((((x % 360) + 360) % 360) * 1e5) / 1e5
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4

/** Ecliptic unit vector of an IAU pole given in RA/Dec (degrees). */
const poleEcl = (ra: number, dec: number): Vec3 => mulVec(EQUATORIAL_TO_ECLIPTIC, fromSpherical(ra * DEG, dec * DEG))

/** The orbit plane of the equator of a body with this pole: inclination and node, ecliptic. */
function planeOf(pole: Vec3): { i: number; node: number } {
  const i = Math.acos(Math.max(-1, Math.min(1, pole[2]))) / DEG
  // Normal n = (sin i sin Ω, −sin i cos Ω, cos i).
  const node = Math.atan2(pole[0], -pole[1]) / DEG
  return { i: r4(i), node: norm360(node) }
}

/**
 * Tilt, equinox longitude and prime meridian (this app's rotation fields)
 * from an IAU pole, W₀ and rate, for an orbit of inclination i and node Ω
 * (degrees, ecliptic).
 */
function rotationFrom(
  iau: Iau,
  orbit: { i: number; node: number }
): { tilt_deg: number; equinox_deg: number; meridian_deg: number; period_h: number } {
  const p = poleEcl(iau.ra, iau.dec)
  const N: Vec3 = [Math.cos(orbit.node * DEG), Math.sin(orbit.node * DEG), 0]
  const n: Vec3 = [
    Math.sin(orbit.i * DEG) * Math.sin(orbit.node * DEG),
    -Math.sin(orbit.i * DEG) * Math.cos(orbit.node * DEG),
    Math.cos(orbit.i * DEG)
  ]
  const tilt = Math.acos(Math.max(-1, Math.min(1, dot(p, n))))
  // pole = cos t·n − sin t·(n × e)  ⇒  n × e = (cos t·n − pole) / sin t, and e = (n × e) × n.
  let e: Vec3
  if (Math.sin(tilt) < 1e-6) e = N
  else {
    const f: Vec3 = [
      (Math.cos(tilt) * n[0] - p[0]) / Math.sin(tilt),
      (Math.cos(tilt) * n[1] - p[1]) / Math.sin(tilt),
      (Math.cos(tilt) * n[2] - p[2]) / Math.sin(tilt)
    ]
    e = normalize(cross(f, n))
  }
  const M = cross(n, N)
  const equinox = Math.atan2(dot(e, M), dot(e, N)) / DEG
  // IAU W is measured from Q, the ascending node of the body's equator on Earth's equator, at RA α₀ + 90°.
  const Q = normalize(mulVec(EQUATORIAL_TO_ECLIPTIC, fromSpherical((iau.ra + 90) * DEG, 0)))
  // Our meridian is measured from e (projected into the equator: e is already in it).
  const e1 = normalize([e[0] - p[0] * dot(e, p), e[1] - p[1] * dot(e, p), e[2] - p[2] * dot(e, p)])
  const e2 = cross(p, e1)
  const qAngle = Math.atan2(dot(Q, e2), dot(Q, e1)) / DEG
  return {
    tilt_deg: r4(tilt / DEG),
    equinox_deg: norm360(equinox),
    meridian_deg: norm360(iau.w0 + qAngle),
    period_h: r4((360 / iau.rate) * 24)
  }
}

interface Iau {
  ra: number
  dec: number
  /** Prime meridian at J2000, degrees. */
  w0: number
  /** Degrees per day; negative for retrograde. */
  rate: number
}

/** a (AU), e, I, L, long. perihelion, long. node (degrees): JPL's published form. */
type Jpl = [number, number, number, number, number, number]

function fromJpl([a, e, I, L, peri, node]: Jpl): BodyFile['orbit'] {
  return {
    a_au: a,
    e,
    i_deg: Math.abs(I) < 1e-4 ? 0 : I,
    node_deg: Math.abs(I) < 1e-4 ? 0 : norm360(node),
    peri_deg: norm360(Math.abs(I) < 1e-4 ? peri : peri - node),
    meanAnomaly_deg: norm360(L - peri),
    epoch: { t_s: 0 }
  }
}

interface PlanetRow {
  id: string
  name: string
  cls: BodyFile['class']
  jpl: Jpl
  mass_kg: number
  radius_km: number
  albedo: number
  iau: Iau
  atmosphere?: BodyFile['atmosphere']
}

const PLANETS: PlanetRow[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    cls: 'rocky',
    jpl: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    mass_kg: 3.3011e23,
    radius_km: 2439.7,
    albedo: 0.088,
    iau: { ra: 281.0103, dec: 61.4155, w0: 329.5988, rate: 6.1385108 }
  },
  {
    id: 'venus',
    name: 'Venus',
    cls: 'rocky',
    jpl: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    mass_kg: 4.8675e24,
    radius_km: 6051.8,
    albedo: 0.76,
    iau: { ra: 272.76, dec: 67.16, w0: 160.2, rate: -1.4813688 },
    atmosphere: { pressure_atm: 92, scaleHeight_km: 15.9 }
  },
  {
    id: 'earth',
    name: 'Earth',
    cls: 'ocean',
    jpl: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    mass_kg: 5.9722e24,
    radius_km: 6371,
    albedo: 0.306,
    iau: { ra: 0, dec: 90, w0: 190.147, rate: 360.9856235 },
    atmosphere: { pressure_atm: 1, scaleHeight_km: 8.5 }
  },
  {
    id: 'mars',
    name: 'Mars',
    cls: 'rocky',
    jpl: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    mass_kg: 6.4171e23,
    radius_km: 3389.5,
    albedo: 0.25,
    iau: { ra: 317.68143, dec: 52.8865, w0: 176.63, rate: 350.89198226 },
    atmosphere: { pressure_atm: 0.006, scaleHeight_km: 11.1 }
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    cls: 'gas-giant',
    jpl: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    mass_kg: 1.89819e27,
    radius_km: 69911,
    albedo: 0.343,
    iau: { ra: 268.056595, dec: 64.495303, w0: 284.95, rate: 870.536 }
  },
  {
    id: 'saturn',
    name: 'Saturn',
    cls: 'gas-giant',
    jpl: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    mass_kg: 5.6834e26,
    radius_km: 58232,
    albedo: 0.342,
    iau: { ra: 40.589, dec: 83.537, w0: 38.9, rate: 810.7939024 }
  },
  {
    id: 'uranus',
    name: 'Uranus',
    cls: 'ice-giant',
    jpl: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    mass_kg: 8.681e25,
    radius_km: 25362,
    albedo: 0.3,
    iau: { ra: 257.311, dec: -15.175, w0: 203.81, rate: -501.1600928 }
  },
  {
    id: 'neptune',
    name: 'Neptune',
    cls: 'ice-giant',
    jpl: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    mass_kg: 1.02413e26,
    radius_km: 24622,
    albedo: 0.29,
    iau: { ra: 299.36, dec: 43.46, w0: 249.978, rate: 541.1397757 }
  },
  {
    id: 'pluto',
    name: 'Pluto',
    cls: 'dwarf',
    jpl: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    mass_kg: 1.303e22,
    radius_km: 1188.3,
    albedo: 0.72,
    iau: { ra: 132.993, dec: -6.163, w0: 302.695, rate: 56.3625225 }
  }
]

/** Dwarf planets from the Small-Body Database: a, e, i, Ω, ω, M (approximate at J2000). */
const DWARFS: {
  id: string
  name: string
  el: [number, number, number, number, number, number]
  mass_kg: number
  radius_km: number
  albedo: number
  period_h: number
  iau?: Iau
}[] = [
  {
    id: 'ceres',
    name: 'Ceres',
    el: [2.7675, 0.0785, 10.583, 80.493, 73.923, 6.2],
    mass_kg: 9.3835e20,
    radius_km: 469.7,
    albedo: 0.034,
    period_h: 9.074,
    iau: { ra: 291.418, dec: 66.764, w0: 170.65, rate: 952.1532 }
  },
  {
    id: 'haumea',
    name: 'Haumea',
    el: [43.116, 0.1955, 28.21, 121.9, 239.2, 198.0],
    mass_kg: 4.006e21,
    radius_km: 780,
    albedo: 0.66,
    period_h: 3.9155
  },
  {
    id: 'makemake',
    name: 'Makemake',
    el: [45.43, 0.161, 28.98, 79.6, 294.8, 140.0],
    mass_kg: 3.1e21,
    radius_km: 715,
    albedo: 0.77,
    period_h: 22.83
  },
  {
    id: 'eris',
    name: 'Eris',
    el: [67.86, 0.4359, 44.04, 35.95, 151.64, 197.6],
    mass_kg: 1.6466e22,
    radius_km: 1163,
    albedo: 0.96,
    period_h: 378.9
  }
]

/** Regular moons, in their planet's equatorial plane: a (km), e, mass (kg), radius (km), Bond albedo. */
const MOONS: { parent: string; list: [string, string, number, number, number, number, number][] }[] = [
  {
    parent: 'mars',
    list: [
      ['phobos', 'Phobos', 9376, 0.0151, 1.0659e16, 11.27, 0.07],
      ['deimos', 'Deimos', 23463.2, 0.00033, 1.4762e15, 6.2, 0.068]
    ]
  },
  {
    parent: 'jupiter',
    list: [
      ['io', 'Io', 421700, 0.0041, 8.9319e22, 1821.6, 0.63],
      ['europa', 'Europa', 671034, 0.009, 4.7998e22, 1560.8, 0.67],
      ['ganymede', 'Ganymede', 1070412, 0.0013, 1.4819e23, 2634.1, 0.43],
      ['callisto', 'Callisto', 1882709, 0.0074, 1.0759e23, 2410.3, 0.22]
    ]
  },
  {
    parent: 'saturn',
    list: [
      ['mimas', 'Mimas', 185539, 0.0196, 3.7493e19, 198.2, 0.6],
      ['enceladus', 'Enceladus', 237948, 0.0047, 1.0802e20, 252.1, 0.81],
      ['tethys', 'Tethys', 294619, 0.0001, 6.1745e20, 531.1, 0.73],
      ['dione', 'Dione', 377396, 0.0022, 1.0955e21, 561.4, 0.6],
      ['rhea', 'Rhea', 527108, 0.0012583, 2.3065e21, 763.8, 0.6],
      ['titan', 'Titan', 1221870, 0.0288, 1.3452e23, 2574.7, 0.2],
      ['iapetus', 'Iapetus', 3560820, 0.0286125, 1.8056e21, 734.5, 0.2]
    ]
  },
  {
    parent: 'uranus',
    list: [
      ['miranda', 'Miranda', 129900, 0.0013, 6.4e19, 235.8, 0.2],
      ['ariel', 'Ariel', 190900, 0.0012, 1.251e21, 578.9, 0.23],
      ['umbriel', 'Umbriel', 266000, 0.0039, 1.275e21, 584.7, 0.1],
      ['titania', 'Titania', 436300, 0.0011, 3.4e21, 788.4, 0.17],
      ['oberon', 'Oberon', 583500, 0.0014, 3.076e21, 761.4, 0.14]
    ]
  },
  { parent: 'pluto', list: [['charon', 'Charon', 19591, 0.0002, 1.586e21, 606, 0.25]] }
]

/** The ecliptic in the galaxy: its north pole in galactic coordinates, and where the vernal equinox lies from its node. */
export function eclipticFrame(): NonNullable<SystemFile['frame']> {
  const pole = normalize(mulVec(EQUATORIAL_TO_GALACTIC, mulVec(ECLIPTIC_TO_EQUATORIAL, [0, 0, 1])))
  const l = Math.atan2(pole[1], pole[0]) / DEG
  const b = Math.asin(pole[2]) / DEG
  // The frame's x axis: the ascending node of the ecliptic on the galactic plane; y = pole × x.
  const x = normalize([-pole[1], pole[0], 0])
  const y = cross(pole, x)
  const equinox = mulVec(EQUATORIAL_TO_GALACTIC, [1, 0, 0])
  const zero = Math.atan2(dot(equinox, y), dot(equinox, x)) / DEG
  return { poleL_deg: norm360(l), poleB_deg: r4(b), zero_deg: norm360(zero) }
}

/** The Solar System's files, for a world: Sol and every body. */
export function solarSystem(systemId = 'sol'): { kind: KindDef; id: string; value: unknown }[] {
  const out: { kind: KindDef; id: string; value: unknown }[] = []
  const sys: SystemFile = { name: 'Sol', star: 'hyg.0', frame: eclipticFrame(), port: 'earth' }
  out.push({ kind: systemKind as KindDef, id: systemId, value: sys })
  const poles = new Map<string, Iau>()
  for (const p of PLANETS) {
    poles.set(p.id, p.iau)
    const orbit = fromJpl(p.jpl)
    const rot = rotationFrom(p.iau, { i: orbit.i_deg, node: orbit.node_deg })
    const body: BodyFile = {
      name: p.name,
      system: systemId,
      class: p.cls,
      orbit,
      mass_mearth: Number((p.mass_kg / M_EARTH_KG).toPrecision(6)),
      radius_km: p.radius_km,
      rotation: rot,
      albedo: p.albedo,
      atmosphere: p.atmosphere
    }
    out.push({ kind: bodyKind as KindDef, id: p.id, value: body })
  }
  // The Moon: mean elements at J2000, locked; its pole from the IAU.
  {
    const orbit = { a_km: 384400, e: 0.0549, i_deg: 5.145, node_deg: 125.08, peri_deg: 318.15, meanAnomaly_deg: 135.27, epoch: { t_s: 0 } }
    const rot = rotationFrom({ ra: 269.9949, dec: 66.5392, w0: 38.3213, rate: 13.17635815 }, { i: orbit.i_deg, node: orbit.node_deg })
    out.push({
      kind: bodyKind as KindDef,
      id: 'moon',
      value: {
        name: 'Moon',
        system: systemId,
        parent: 'earth',
        class: 'rocky',
        orbit,
        mass_mearth: Number((7.342e22 / M_EARTH_KG).toPrecision(6)),
        radius_km: 1737.4,
        rotation: { locked: true, tilt_deg: rot.tilt_deg, equinox_deg: rot.equinox_deg },
        albedo: 0.11
      } satisfies BodyFile
    })
  }
  for (const d of DWARFS) {
    const [a, e, i, node, peri, M] = d.el
    const orbit = { a_au: a, e, i_deg: i, node_deg: node, peri_deg: peri, meanAnomaly_deg: M, epoch: { t_s: 0 } }
    const rot = d.iau ? rotationFrom(d.iau, { i, node }) : { tilt_deg: 0, period_h: d.period_h }
    out.push({
      kind: bodyKind as KindDef,
      id: d.id,
      value: {
        name: d.name,
        system: systemId,
        class: 'dwarf',
        orbit,
        mass_mearth: Number((d.mass_kg / M_EARTH_KG).toPrecision(6)),
        radius_km: d.radius_km,
        rotation: rot,
        albedo: d.albedo
      } satisfies BodyFile
    })
  }
  for (const group of MOONS) {
    const pole = poles.get(group.parent)!
    const plane = planeOf(poleEcl(pole.ra, pole.dec))
    // A moon in its planet's equator, locked: its tilt to that plane is about 0.
    for (const [id, nm, a, e, mass, radius, albedo] of group.list)
      out.push({
        kind: bodyKind as KindDef,
        id,
        value: {
          name: nm,
          system: systemId,
          parent: group.parent,
          class: 'rocky',
          orbit: { a_km: a, e, i_deg: plane.i, node_deg: plane.node, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
          mass_mearth: Number((mass / M_EARTH_KG).toPrecision(6)),
          radius_km: radius,
          rotation: { locked: true, tilt_deg: 0 },
          albedo,
          atmosphere: id === 'titan' ? { pressure_atm: 1.45, scaleHeight_km: 21 } : undefined
        } satisfies BodyFile
      })
  }
  // Triton: retrograde, steeply inclined to Neptune's equator (157°); approximate plane.
  out.push({
    kind: bodyKind as KindDef,
    id: 'triton',
    value: {
      name: 'Triton',
      system: systemId,
      parent: 'neptune',
      class: 'rocky',
      orbit: { a_km: 354759, e: 0.000016, i_deg: 130, node_deg: 177.6, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
      mass_mearth: Number((2.139e22 / M_EARTH_KG).toPrecision(6)),
      radius_km: 1353.4,
      rotation: { locked: true, tilt_deg: 0 },
      albedo: 0.76
    } satisfies BodyFile
  })
  // The belts, as belt bodies: a typical member's orbit, and their edges.
  out.push({
    kind: bodyKind as KindDef,
    id: 'main-belt',
    value: {
      name: 'Main belt',
      system: systemId,
      class: 'belt',
      orbit: { a_au: 2.7, e: 0.1, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
      mass_mearth: Number((2.39e21 / M_EARTH_KG).toPrecision(6)),
      radius_km: 1,
      rotation: { period_h: 24, tilt_deg: 0 },
      extent: { inner_au: 2.06, outer_au: 3.27 },
      albedo: 0.1
    } satisfies BodyFile
  })
  out.push({
    kind: bodyKind as KindDef,
    id: 'kuiper-belt',
    value: {
      name: 'Kuiper belt',
      system: systemId,
      class: 'belt',
      orbit: { a_au: 42, e: 0.1, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
      mass_mearth: 0.02,
      radius_km: 1,
      rotation: { period_h: 24, tilt_deg: 0 },
      extent: { inner_au: 30, outer_au: 50 },
      albedo: 0.1
    } satisfies BodyFile
  })
  return out
}

/**
 * The Solar System's files that a world does not have yet, fitted to it: if
 * a system already sits on Sol, the bodies join that system (and it gets the
 * ecliptic frame and Earth as its port if it has none); bodies whose ids are
 * taken are left out.
 */
export function solarSystemFor(world: WorldData): { path: string; kind: KindDef; id: string; value: unknown }[] {
  const existing = entitiesOf(world, systemKind).find((e) => e.value.star === 'hyg.0')
  const systemId = existing?.id ?? (world.entities.has(`${systemKind.kind}/sol`) ? 'sol-system' : 'sol')
  const out: { path: string; kind: KindDef; id: string; value: unknown }[] = []
  const takenBodies = new Set(entitiesOf(world, bodyKind).map((e) => e.id))
  for (const f of solarSystem(systemId)) {
    if (f.kind.kind === systemKind.kind) {
      if (!existing) out.push({ ...f, path: entityPath(f.kind, f.id) })
      else if (!existing.value.frame || !existing.value.port) {
        const v = f.value as SystemFile
        out.push({
          kind: f.kind,
          id: existing.id,
          path: existing.path,
          value: {
            ...existing.value,
            frame: existing.value.frame ?? v.frame,
            port: existing.value.port ?? (takenBodies.has('earth') ? undefined : 'earth')
          }
        })
      }
      continue
    }
    if (takenBodies.has(f.id)) continue
    out.push({ ...f, path: entityPath(f.kind, f.id) })
  }
  return out
}
