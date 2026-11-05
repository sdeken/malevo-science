/**
 * Cities and "conditions at a time" (docs/PLAN.md §7.7).
 *
 * A city sits at a latitude and longitude on a body. Its population is given
 * at dates and grows steadily between them. For any instant, the conditions
 * there are worked out from the shared model: where the star stands and so
 * the local solar time, the season and the day's length and twilights, the
 * tide raised by the moons and the star, who holds the place, and (for a port)
 * the ships in port and on their way, from the route network's own numbers.
 */
import { DAY, DEG, M_SUN, daylightFraction, type Vec3 } from '@malevo/core'
import type { WorldEnv } from './env'
import { historyAt, systemHistory } from './cultures'
import { whenResolver, worldCalendars, type WhenResolver } from './events'
import { bodyKind, cityKind, entityKey, physicsKind, type BodyFile, type CityFile, type KindDef, type PhysicsSettings } from './kinds'
import { entitiesOf, type WorldData } from './load'
import { bodySpin, skyScene, type SkyScene } from './sky'
import { systemInfo, type SystemInfo } from './systems'
import { travelSettings } from './kinds'

// ---- population ----

export interface PopulationPoint {
  t: number
  people: number
}

/** People at instant t: none before the first point, steady growth by the same factor each year between points, level after the last. */
export function populationAt(points: readonly PopulationPoint[], t: number): number {
  const p = [...points].sort((a, b) => a.t - b.t)
  if (!p.length || t < p[0].t) return 0
  for (let i = 1; i < p.length; i++) {
    if (t > p[i].t) continue
    const a = p[i - 1]
    const b = p[i]
    const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
    if (a.people > 0 && b.people > 0) return a.people * Math.pow(b.people / a.people, f)
    return a.people + (b.people - a.people) * f
  }
  return p[p.length - 1].people
}

export interface CityInfo {
  id: string
  file: CityFile
  founded: number | null
  population: (PopulationPoint & { index: number })[]
  errors: string[]
}

export function cityInfo(world: WorldData, resolver: WhenResolver, id: string): CityInfo | null {
  const e = world.entities.get(entityKey(cityKind as KindDef, id))
  if (!e || e.value === undefined) return null
  const file = e.value as CityFile
  const errors: string[] = []
  const founded = file.founded ? resolver.resolve(file.founded) : null
  if (founded) errors.push(...founded.errors)
  const population: CityInfo['population'] = []
  ;(file.population ?? []).forEach((p, index) => {
    const r = resolver.resolve(p.from)
    errors.push(...r.errors)
    if (r.time) population.push({ index, t: r.time.t, people: p.people })
  })
  population.sort((a, b) => a.t - b.t)
  return { id, file, founded: founded?.time?.t ?? null, population, errors }
}

export function cityInfos(world: WorldData, env: WorldEnv = {}): CityInfo[] {
  const resolver = whenResolver(world, worldCalendars(world, env))
  return entitiesOf(world, cityKind)
    .map((e) => cityInfo(world, resolver, e.id))
    .filter((c): c is CityInfo => c !== null)
}

// ---- conditions ----

export interface Conditions {
  t: number
  /** Local solar time, in local hours (a solar day is 24 of them); null where the star never moves (a locked body). */
  localHours: number | null
  /** Length of the local hour, standard seconds. */
  localHour_s: number | null
  sun: { alt: number; az: number }
  season: { name: string; hemisphere: 'north' | 'south'; declination: number; seasons: boolean }
  /** Hours of daylight and of each twilight, local hours; and sunrise/sunset in local solar time. */
  daylight: {
    day: number | null
    civil: number | null
    nautical: number | null
    astronomical: number | null
    sunrise: number | null
    sunset: number | null
    polar: 'day' | 'night' | null
  }
  tide: {
    /** The body raising most of the tide. */
    main: string | null
    trend: 'rising' | 'falling' | 'slack'
    /** Where between this cycle's low (0) and high (1) the water stands. */
    level: number
    /** Next high water, s from now. */
    nextHigh_s: number | null
    /** 1 when star and moon pull together (springs), 0 when at right angles (neaps). */
    spring: number | null
  } | null
  polity: string | null
  population: number
  port: {
    arriving: { route: string; neighbour: string; perDay: number; underway: number }[]
    leaving: { route: string; neighbour: string; perDay: number; underway: number }[]
    /** Ships alongside: each one through or ending here spends the stopover in port. */
    inPort: number
  } | null
  errors: string[]
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** The tidal height (arbitrary units) at the observer from every other body. */
function tideHeight(
  sys: SystemInfo,
  bodyId: string,
  scene: SkyScene,
  starMass: number
): { h: number; parts: { id: string; k: number; dir: Vec3 }[] } {
  const parts: { id: string; k: number; dir: Vec3 }[] = []
  const add = (id: string, mass: number, rel: Vec3): void => {
    const d = Math.hypot(rel[0], rel[1], rel[2])
    if (d <= 0) return
    parts.push({ id, k: mass / d ** 3, dir: [rel[0] / d, rel[1] / d, rel[2] / d] })
  }
  add('star', starMass, [-scene.observer[0], -scene.observer[1], -scene.observer[2]])
  for (const b of sys.bodies) {
    if (b.id === bodyId || b.cls === 'belt') continue
    const p = scene.bodies.find((x) => x.id === b.id)
    if (p) add(b.id, b.mass, [p.dir[0] * p.distance, p.dir[1] * p.distance, p.dir[2] * p.distance])
  }
  const up = scene.frame.up
  const h = parts.reduce((s, x) => s + x.k * (3 * dot(x.dir, up) ** 2 - 1) * 0.5, 0)
  return { h, parts }
}

export function conditionsAt(world: WorldData, env: WorldEnv, cityId: string, t: number): Conditions | { error: string } {
  const resolver = whenResolver(world, worldCalendars(world, env))
  const city = cityInfo(world, resolver, cityId)
  if (!city) return { error: `There is no city "${cityId}".` }
  const vp = { body: city.file.body, lat_deg: city.file.lat_deg, lon_deg: city.file.lon_deg, elevation_m: city.file.elevation_m }
  const scene = skyScene(world, env, vp, t)
  if ('error' in scene) return scene
  const bodyFile = world.entities.get(`${bodyKind.kind}/${city.file.body}`)?.value as BodyFile
  const sys = systemInfo(world, env, bodyFile.system)!
  const b = sys.bodies.find((x) => x.id === city.file.body)!
  const spin = bodySpin(b)!
  const pole = spin.pole
  const s = scene.sun.dir
  const up = scene.frame.up
  const lat = city.file.lat_deg * DEG

  // Local solar time: the star's hour angle about the pole.
  let localHours: number | null = null
  if (b.solarDay !== null && Number.isFinite(b.solarDay) && b.rotation !== null) {
    const se = unit(sub(s, [pole[0] * dot(s, pole), pole[1] * dot(s, pole), pole[2] * dot(s, pole)]))
    const ue = unit(sub(up, [pole[0] * dot(up, pole), pole[1] * dot(up, pole), pole[2] * dot(up, pole)]))
    const theta = Math.atan2(dot(cross(ue, se), pole), dot(ue, se))
    // The star moves west when the body spins faster than it goes round (a prograde solar day); local hours run with it.
    const westward = 1 / b.rotation - 1 / (b.year ?? Infinity) > 0
    const H = westward ? -theta : theta
    localHours = (((12 + (H / (2 * Math.PI)) * 24) % 24) + 24) % 24
  }
  const localHour_s = b.solarDay !== null && Number.isFinite(b.solarDay) ? Math.abs(b.solarDay) / 24 : null

  const local = [dot(s, scene.frame.east), dot(s, scene.frame.north), dot(s, up)]
  const sun = { alt: Math.asin(Math.max(-1, Math.min(1, local[2]))), az: (Math.atan2(local[0], local[1]) + 2 * Math.PI) % (2 * Math.PI) }

  // Season, from the star's declination and whether it is climbing.
  const dec = Math.asin(Math.max(-1, Math.min(1, dot(s, pole))))
  const yearLen = b.year ?? 365.25 * DAY
  const later = skyScene(world, env, vp, t + yearLen / 200)
  const dec2 = 'error' in later ? dec : Math.asin(Math.max(-1, Math.min(1, dot(later.sun.dir, pole))))
  const rising = dec2 >= dec
  const north = lat >= 0
  const seasons = Math.min(b.tilt, Math.PI - b.tilt) > 2 * DEG
  const nSeason = dec >= 0 ? (rising ? 'spring' : 'summer') : rising ? 'winter' : 'autumn'
  const opposite: Record<string, string> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }
  const season = {
    name: seasons ? (north ? nSeason : opposite[nSeason]) : 'no real seasons',
    hemisphere: north ? ('north' as const) : ('south' as const),
    declination: dec,
    seasons
  }

  // Daylight and twilights, in local hours.
  const air = Boolean(b.file.atmosphere && b.file.atmosphere.pressure_atm > 0.001)
  const frac = (alt: number): number => daylightFraction(lat, dec, alt)
  const day = frac(air ? -0.833 * DEG : 0)
  const daylight: Conditions['daylight'] =
    localHours === null
      ? { day: null, civil: null, nautical: null, astronomical: null, sunrise: null, sunset: null, polar: null }
      : {
          day: day * 24,
          civil: (frac(-6 * DEG) - day) * 24,
          nautical: (frac(-12 * DEG) - frac(-6 * DEG)) * 24,
          astronomical: (frac(-18 * DEG) - frac(-12 * DEG)) * 24,
          sunrise: day > 0 && day < 1 ? 12 - day * 12 : null,
          sunset: day > 0 && day < 1 ? 12 + day * 12 : null,
          polar: day >= 1 ? 'day' : day <= 0 ? 'night' : null
        }

  // Tides: sample the coming day to find this cycle's range and the next high water.
  const starMass = (sys.star?.physics.mass ?? 1) * M_SUN
  const now = tideHeight(sys, b.id, scene, starMass)
  let tide: Conditions['tide'] = null
  if (now.parts.length) {
    const span = Math.min(Math.abs(b.solarDay ?? DAY), 2 * DAY) * 1.1
    const n = 48
    const hs: number[] = []
    for (let k = 0; k <= n; k++) {
      const sc = k === 0 ? scene : skyScene(world, env, vp, t + (span * k) / n)
      hs.push('error' in sc ? now.h : tideHeight(sys, b.id, sc, starMass).h)
    }
    const lo = Math.min(...hs)
    const hi = Math.max(...hs)
    let nextHigh: number | null = null
    for (let k = 1; k < n; k++)
      if (hs[k] >= hs[k - 1] && hs[k] >= hs[k + 1] && hs[k] > hs[0]) {
        nextHigh = (span * k) / n
        break
      }
    const main = [...now.parts].sort((x, y) => y.k - x.k)[0]
    const moon = [...now.parts].filter((x) => x.id !== 'star').sort((x, y) => y.k - x.k)[0]
    const star = now.parts.find((x) => x.id === 'star')
    tide = {
      main: main?.id ?? null,
      trend: hi - lo < 1e-30 ? 'slack' : hs[1] > hs[0] ? 'rising' : 'falling',
      level: hi > lo ? (hs[0] - lo) / (hi - lo) : 0.5,
      nextHigh_s: nextHigh,
      spring: moon && star ? dot(moon.dir, star.dir) ** 2 : null
    }
  }

  // Who holds it.
  const hist = historyAt(systemHistory(sys.file, resolver), t)
  const polity = city.file.polity ?? hist?.polity ?? null

  // The port, from the route network's own numbers.
  let port: Conditions['port'] = null
  if (city.file.port === 'main') {
    const physics = entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined
    const stopover = physics ? travelSettings(physics).stopover : DAY
    const arriving = scene.routes
      .filter((r) => r.kind === 'in')
      .map((r) => ({ route: r.route, neighbour: r.neighbour, perDay: r.perDay, underway: r.shown }))
    const leaving = scene.routes
      .filter((r) => r.kind === 'out')
      .map((r) => ({ route: r.route, neighbour: r.neighbour, perDay: r.perDay, underway: r.shown }))
    const inPerDay = arriving.reduce((x, r) => x + r.perDay, 0)
    port = { arriving, leaving, inPort: (inPerDay * stopover) / DAY }
  }

  return {
    t,
    localHours,
    localHour_s,
    sun,
    season,
    daylight,
    tide,
    polity,
    population: populationAt(city.population, t),
    port,
    errors: city.errors
  }
}
