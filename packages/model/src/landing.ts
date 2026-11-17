/**
 * The landing planner: a hull, or its sections, brought down from orbit with
 * a descent kit: a ballute (an inflatable drag balloon that takes the heat
 * high up), then chemical rockets for the last of the speed and the landing,
 * onto a pad or into the sea. For the sea, a tow to shore and the tide to
 * beach on.
 *
 * Each section flies the same descent, worked out step by step: a deorbit
 * burn to drop the low point of the orbit into the air, the coast down, the
 * ballute's slow-down (peak deceleration, peak heating on the ballute), its
 * release, the free fall on the hull's own drag, and a rocket burn timed to
 * reach the touchdown speed at the surface. Sections riding a few kilometres
 * apart in orbit reach the deorbit point seconds apart, so they come down in
 * quick succession, landing about as far apart as they rode. The planet's
 * rotation and winds are ignored in the descent itself.
 *
 * Harder entries: aim the orbit's low point lower (below the ground) for a
 * bigger burn and a steeper, faster entry with more deceleration and heat;
 * give the vehicle lift to ease the peak; or leave the ballute off for a pod
 * with a heat shield. With the ship's orbit given, the next burns that bring
 * it down at the site are found (the planet turning beneath).
 */
import { G, G0, M_EARTH } from '@malevo/core'
import { conditionsAt } from './cities'
import type { WorldEnv } from './env'
import type { LandingFile } from './kinds'
import type { WorldData } from './load'

const KNOT = 0.514444

export interface LandingChance {
  burn: number
  touchdown: number
  /** How far from the site the straight-down pass lands, km. */
  miss_km: number
}

export interface LandingEvent {
  /** Seconds before (negative) or after the first touchdown. */
  t: number
  what: string
}

export interface LandingReport {
  body: string
  g: number
  /** Orbital speed and period. */
  orbitSpeed: number
  orbitPeriod: number
  deorbit_ms: number
  section_t: number
  /** Ballute diameter, m. */
  ballute_m: number
  /** Peak deceleration, g. */
  peakDecel_g: number
  /** Peak heating on the ballute, W/m². */
  peakHeat_Wm2: number
  /** Speed when the ballute lets go, m/s. */
  release_ms: number
  /** Rocket velocity change, m/s; propellant and thrust per section. */
  rocket_ms: number
  propellant_t: number
  thrust_MN: number
  burn_s: number
  /** From the deorbit burn to touchdown, s. */
  descent_s: number
  /** How far it travels over the ground from the deorbit burn, km. */
  downrange_km: number
  /** Between the first and last section's touchdowns, s. */
  succession_s: number
  timeline: LandingEvent[]
  /** How steeply it meets the air, degrees below level, and the coast from the burn to the air, s. */
  entryAngle_deg: number
  coast_s: number
  /** What the peak heating is on: the ballute, or the pod's heat shield. */
  heatOn: 'ballute' | 'shield'
  /** With the ship's orbit given: the next burns that bring it down at the site, after the order. */
  chances: LandingChance[] | null
  /** The closest any pass comes in the next two days, if none is close enough. */
  bestPass: LandingChance | null
  tow: { duration_s: number; arrive: number; nextHigh: number | null; dry: number | null } | null
  notes: string[]
}

function bodyOf(
  world: WorldData,
  id: string
): { name: string; mass: number; radius: number; atm: { p: number; H: number | null } | null; rotation_h: number | null } | null {
  const b = world.entities.get(`body/${id}`)?.value as
    | {
        name: string
        mass_mearth: number
        radius_km: number
        atmosphere?: { pressure_atm: number; scaleHeight_km?: number }
        rotation?: { period_h?: number }
      }
    | undefined
  if (!b) return null
  return {
    name: b.name,
    mass: b.mass_mearth * M_EARTH,
    radius: b.radius_km * 1000,
    atm: b.atmosphere && b.atmosphere.pressure_atm > 0 ? { p: b.atmosphere.pressure_atm, H: b.atmosphere.scaleHeight_km ?? null } : null,
    rotation_h: b.rotation?.period_h ?? null
  }
}

export function landingReport(world: WorldData, env: WorldEnv, f: LandingFile): LandingReport | { error: string } {
  const body = bodyOf(world, f.body)
  if (!body) return { error: `There is no body "${f.body}".` }
  const mu = G * body.mass
  const R = body.radius
  const g = mu / (R * R)
  const notes: string[] = []
  const rho0 = body.atm ? 1.225 * body.atm.p : 0
  const H = body.atm ? (body.atm.H !== null ? body.atm.H * 1000 : 8000 * (G0 / g)) : 8000
  const rho = (h: number): number => (rho0 > 0 && h < 40 * H ? rho0 * Math.exp(-h / H) : 0)
  if (!body.atm) notes.push(`${body.name} has no air, so nothing slows the hull but the rockets: expect enormous propellant.`)

  const m0 = (f.mass_t * 1000) / f.sections
  const r0 = R + f.orbit_km * 1000
  const vc = Math.sqrt(mu / r0)
  const period = 2 * Math.PI * Math.sqrt(r0 ** 3 / mu)
  // Drop the low point of the orbit to about six scale heights (around 50 km on an Earth-like world), or where asked:
  // below the ground for a harder, faster entry.
  const entry = f.entry ?? {}
  const hp = entry.perigee_km !== undefined ? Math.max(-0.9 * R, entry.perigee_km * 1000) : Math.min(6 * H, f.orbit_km * 1000 * 0.5)
  if (hp >= f.orbit_km * 1000) return { error: 'The low point to aim for must be below the orbit.' }
  const lift = entry.lift ?? 0
  const pod = entry.noBallute === true
  const rp = R + hp
  const a = (r0 + rp) / 2
  const e = (r0 - rp) / (r0 + rp)
  const vApo = Math.sqrt(mu * (2 / r0 - 1 / a))
  const deorbit = vc - vApo
  // Coast from the burn (apoapsis) to the top of the air (about fifteen scale heights, but below the orbit).
  const he = Math.min(15 * H, f.orbit_km * 1000 * 0.9)
  const re = R + he
  const p = a * (1 - e * e)
  const cosNu = Math.max(-1, Math.min(1, (p / re - 1) / e))
  const nuE = 2 * Math.PI - Math.acos(cosNu)
  const ecc = (nu: number): number => {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2))
    return E < 0 ? E + 2 * Math.PI : E
  }
  const M = (nu: number): number => {
    const E = ecc(nu)
    return E - e * Math.sin(E)
  }
  const n = Math.sqrt(mu / a ** 3)
  const coast = (M(nuE) - Math.PI) / n
  const coastAngle = nuE - Math.PI

  // The descent, step by step, in the orbit's plane: x along the surface's local up at the start.
  const ballArea = m0 / (f.ballute.beta_kg_m2 * 1.4)
  const ballute_m = pod ? 0 : 2 * Math.sqrt(ballArea / Math.PI)
  const rn = pod ? (entry.nose_m ?? 1) : ballute_m / 2
  const vE = Math.sqrt(mu * (2 / re - 1 / a))
  const gammaE = Math.atan((e * Math.sin(nuE)) / (1 + e * Math.cos(nuE)))
  let r = re
  let theta = 0
  let vr = vE * Math.sin(gammaE)
  let vt = vE * Math.cos(gammaE)
  let m = m0
  let t = 0
  let peakDecel = 0
  let peakHeat = 0
  let released = false
  let release_ms = 0
  let ignite: number | null = null
  let tPeakHeat = 0
  let tRelease = 0
  const thrust = f.rockets.thrust_g * G0 * m0
  const ve = f.rockets.exhaust_kms * 1000
  let rocketDv = 0
  const dt = 0.1
  for (let i = 0; i < 2e6; i++) {
    const h = r - R
    const v = Math.hypot(vr, vt)
    const gl = mu / (r * r)
    const beta = !released && !pod ? f.ballute.beta_kg_m2 : f.hullBeta_kg_m2
    const dens = rho(h)
    const drag = (0.5 * dens * v * v) / beta
    if (!released) {
      const q = 1.7415e-4 * Math.sqrt(dens / rn) * v ** 3
      if (q > peakHeat) {
        peakHeat = q
        tPeakHeat = t
      }
      // With a ballute: it lets go here. Without: below here the rockets may light.
      if (h <= f.ballute.release_km * 1000) {
        released = true
        release_ms = v
        tRelease = t
      }
    }
    let thrustAcc = 0
    // The landing curve: the speed from which full thrust, with a fifth held back for margin, stops it
    // exactly at the surface at touchdown speed. Above the curve, fire; below it, fall.
    const net = 0.8 * (thrust / m) - gl
    const curve = net > 0 ? Math.sqrt(f.rockets.touchdown_ms ** 2 + 2 * net * Math.max(0, h)) : Infinity
    if (released && v > curve) {
      if (ignite === null) ignite = t
      thrustAcc = thrust / m
      m -= ((thrustAcc * m) / ve) * dt
      rocketDv += thrustAcc * dt
    }
    const ux = v > 0 ? vr / v : 0
    const uy = v > 0 ? vt / v : 0
    // Lift, held up (square to the velocity, away from the ground) while it sinks, until the rockets light.
    const L = lift > 0 && ignite === null && vr < 0 ? lift * drag : 0
    const decel = Math.hypot(drag, L) + thrustAcc
    if (decel / G0 > peakDecel && ignite === null) peakDecel = decel / G0
    // Polar equations of motion with drag and thrust against the velocity, and lift square to it.
    const ar = -gl + (vt * vt) / r - (drag + thrustAcc) * ux + L * uy
    const at = -(vr * vt) / r - (drag + thrustAcc) * uy - L * ux
    vr += ar * dt
    vt += at * dt
    r += vr * dt
    theta += (vt / r) * dt
    t += dt
    if (r <= R) break
    if (t > 6 * 3600) return { error: 'The descent never reaches the ground (orbit too high, or the kit too gentle).' }
  }
  const burn = ignite !== null ? t - ignite : 0
  const propellant = m0 - m
  const descent = coast + t
  const touchdownSpeed = Math.hypot(vr, vt)
  if (touchdownSpeed > f.rockets.touchdown_ms * 3)
    notes.push(`The rockets can't stop it in time: it reaches the surface at ${touchdownSpeed.toFixed(0)} m/s. Give them more thrust.`)
  if (!pod && peakHeat > 3e5)
    notes.push(
      `Peak heating on the ballute is ${(peakHeat / 1e4).toFixed(0)} W/cm², hotter than fabric takes; a lower mass per area (bigger ballute) is gentler.`
    )
  if (pod && peakHeat > 1e7)
    notes.push(
      `Peak heating on the shield is ${(peakHeat / 1e4).toFixed(0)} W/cm², beyond any ablative shield flown (returns from the Moon saw about 500).`
    )
  if (peakDecel > 25)
    notes.push(`Peak deceleration is ${peakDecel.toFixed(1)} g: past what people survive; lift, or a shallower entry, eases it.`)
  else if (peakDecel > 15)
    notes.push(
      `Peak deceleration is ${peakDecel.toFixed(1)} g: survivable for a crew lying back in fitted couches only briefly, and at real risk.`
    )
  else if (peakDecel > 8)
    notes.push(
      `Peak deceleration is ${peakDecel.toFixed(1)} g: brutal for a crew, but survivable lying back in fitted couches; hard on cargo.`
    )
  const T0 = f.touchdown.t_s
  const spacing = (f.spacing_km ?? 20) * 1000
  const succession = f.sections > 1 ? ((f.sections - 1) * spacing) / vc : 0
  const timeline: LandingEvent[] = [
    {
      t: -descent,
      what: `Deorbit burn, ${deorbit.toFixed(0)} m/s, ${Math.round(((coastAngle + theta) * R) / 1000).toLocaleString('en')} km uprange`
    },
    { t: -descent + coast, what: `Into the top of the air, ${Math.abs((gammaE * 180) / Math.PI).toFixed(1)}° down` },
    {
      t: -descent + coast + tPeakHeat,
      what: `Peak heating on the ${pod ? 'heat shield' : 'ballute'} (${(peakHeat / 1e4).toFixed(1)} W/cm²); the fireball`
    },
    {
      t: -descent + coast + tRelease,
      what: pod
        ? `Down to ${f.ballute.release_km.toFixed(0)} km, ${release_ms.toFixed(0)} m/s`
        : `Ballute lets go at ${f.ballute.release_km.toFixed(0)} km, ${release_ms.toFixed(0)} m/s`
    },
    ...(ignite !== null ? [{ t: -descent + coast + ignite, what: `Rockets light (${(thrust / 1e6).toFixed(0)} MN per section)` }] : []),
    { t: 0, what: f.mode === 'splash' ? 'First section splashes down' : 'Touchdown on the pad' },
    ...(f.sections > 1
      ? [{ t: succession, what: `Last of ${f.sections} sections down, about ${((f.sections - 1) * spacing) / 1000} km along the line` }]
      : [])
  ]
  let tow: LandingReport['tow'] = null
  if (f.mode === 'splash' && f.tow) {
    const duration = (f.tow.offshore_km * 1000) / (f.tow.knots * KNOT)
    const arrive = T0 + succession + duration
    let nextHigh: number | null = null
    let dry: number | null = null
    if (f.city) {
      const c = conditionsAt(world, env, f.city, arrive)
      if (!('error' in c) && c.tide?.nextHigh_s != null) {
        nextHigh = arrive + c.tide.nextHigh_s
        const after = conditionsAt(world, env, f.city, nextHigh + 600)
        const cycle = !('error' in after) && after.tide?.nextHigh_s != null ? after.tide.nextHigh_s + 600 : null
        dry = cycle !== null ? nextHigh + cycle / 2 : null
      } else if (!('error' in c) && !c.tide) notes.push('No tide there: nothing raises one (no moon, and the star is too far).')
    }
    tow = { duration_s: duration, arrive, nextHigh, dry }
    timeline.push({ t: arrive - T0, what: `Tugs have them inshore (${(duration / 3600).toFixed(1)} h of towing)` })
    if (nextHigh !== null) timeline.push({ t: nextHigh - T0, what: 'High water: run them up the beach' })
    if (dry !== null) timeline.push({ t: dry - T0, what: 'Low water: high and dry on the sand' })
  }
  // When a burn from the ship's orbit can bring it down at the site.
  let chances: LandingChance[] | null = null
  let bestPass: LandingChance | null = null
  const downrange = coastAngle + theta
  if (f.track) {
    const city = f.city ? (world.entities.get(`city/${f.city}`)?.value as { lat_deg?: number; lon_deg?: number } | undefined) : undefined
    const site =
      f.site ?? (city?.lat_deg !== undefined && city.lon_deg !== undefined ? { lat_deg: city.lat_deg, lon_deg: city.lon_deg } : null)
    if (!site) notes.push('Say where it comes down (a site, or the city) to find when a burn can reach it.')
    else {
      const D = Math.PI / 180
      const inc = f.track.inclination_deg * D
      const tA = f.track.at.t_s
      const n0 = (2 * Math.PI) / period
      const spin = body.rotation_h ? (2 * Math.PI) / (body.rotation_h * 3600) : 0
      const reach = f.track.reach_km ?? 25 + 400 * lift
      const start = f.track.order?.t_s ?? tA
      const sLat = site.lat_deg * D
      const sLon = site.lon_deg * D
      const missAt = (tb: number): number => {
        const u = f.track!.arg_deg * D + n0 * (tb - tA) + downrange
        const lat = Math.asin(Math.sin(inc) * Math.sin(u))
        const lon = f.track!.node_lon_deg * D + Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) - spin * (tb + descent - tA)
        const c = Math.sin(lat) * Math.sin(sLat) + Math.cos(lat) * Math.cos(sLat) * Math.cos(lon - sLon)
        return (Math.acos(Math.max(-1, Math.min(1, c))) * R) / 1000
      }
      const step = 2
      const found: LandingChance[] = []
      let prev2 = Infinity
      let prev = missAt(start)
      for (let tb = start + step; tb <= start + 2 * 86400 && found.length < 4; tb += step) {
        const cur = missAt(tb)
        if (prev < prev2 && prev <= cur) {
          const pass = { burn: tb - step, touchdown: tb - step + descent, miss_km: prev }
          if (!bestPass || pass.miss_km < bestPass.miss_km) bestPass = pass
          if (pass.miss_km <= reach) found.push(pass)
        }
        prev2 = prev
        prev = cur
      }
      chances = found
      if (found.length) {
        const wait = found[0].burn - start
        notes.push(
          wait < 120
            ? `The ship is in the right place: burn at once and they are down ${Math.round(descent / 60)} min after the order.`
            : `The first chance to burn is ${Math.round(wait / 60)} min after the order; down ${Math.round((wait + descent) / 60)} min after it.`
        )
        if (!found.some((c) => Math.abs(c.touchdown - f.touchdown.t_s) < 300))
          notes.push('The touchdown time set here is not one of the chances from this orbit; pick one, or move the ship.')
      } else if (bestPass)
        notes.push(
          `No pass in the next two days comes within ${Math.round(reach)} km of the site; the closest misses by ${Math.round(bestPass.miss_km)} km. Tilt the orbit to pass over it.`
        )
      if (!body.rotation_h) notes.push(`${body.name} is taken as not turning (no rotation period given), so the chances ignore its spin.`)
    }
  }
  if (body.rotation_h && !f.track)
    notes.push(
      `Her orbit passes over a given spot only about twice a day (the ground track shifts ${((period / 3600 / body.rotation_h) * 360).toFixed(0)}° west each orbit), so touchdown times come in windows.`
    )
  return {
    body: body.name,
    g,
    orbitSpeed: vc,
    orbitPeriod: period,
    deorbit_ms: deorbit,
    section_t: m0 / 1000,
    ballute_m,
    peakDecel_g: peakDecel,
    peakHeat_Wm2: peakHeat,
    release_ms,
    rocket_ms: rocketDv,
    propellant_t: propellant / 1000,
    thrust_MN: thrust / 1e6,
    burn_s: burn,
    descent_s: descent,
    downrange_km: ((coastAngle + theta) * R) / 1000,
    succession_s: succession,
    timeline: timeline.sort((x, y) => x.t - y.t),
    entryAngle_deg: Math.abs((gammaE * 180) / Math.PI),
    coast_s: coast,
    heatOn: pod ? 'shield' : 'ballute',
    chances,
    bestPass,
    tow,
    notes
  }
}

export function newLanding(name: string, body: string, t: number): LandingFile {
  return {
    name,
    body,
    touchdown: { t_s: t },
    mass_t: 10000,
    sections: 1,
    orbit_km: 400,
    ballute: { beta_kg_m2: 100, release_km: 10 },
    hullBeta_kg_m2: 3000,
    rockets: { exhaust_kms: 3, thrust_g: 2, touchdown_ms: 2 },
    mode: 'pad'
  }
}
