/**
 * Fusion-torch (sublight) travel and brightness, ported from the prototype
 * travel-times and torchlight tools. SI throughout.
 */
import { AU, L_SUN } from './units'

/** Δv from the rocket equation. */
export function deltaV(exhaustSpeed: number, massRatio: number): number {
  return exhaustSpeed * Math.log(massRatio)
}

/** Constant acceleration from rest, flip at the midpoint, arrive at rest. */
export function flipAndBurnTime(distance: number, accel: number): number {
  return 2 * Math.sqrt(distance / accel)
}

/** Constant acceleration from rest the whole way (no braking). */
export function burnAllTheWayTime(distance: number, accel: number): number {
  return Math.sqrt((2 * distance) / accel)
}

export interface TorchTrip {
  /** Trip time, s. */
  time: number
  /** Peak speed, m/s. */
  peakSpeed: number
  /** What capped the peak speed. */
  limit: 'flip halfway' | 'burning all the way' | 'speed limit' | 'tanks'
  /** Fraction of the starting mass burned as propellant. */
  propellantUsed: number
}

export interface TorchParams {
  /** Acceleration while burning, m/s². */
  accel: number
  exhaustSpeed: number
  /** Propellant as a fraction of starting mass, 0–1. */
  propellantFraction: number
  /** Optional speed cap, m/s (0 or absent: none). */
  speedCap?: number
  /** Arrive at rest (flip and brake) rather than fly by. */
  stop: boolean
}

/** A torch trip limited by acceleration, tanks and an optional speed cap (the prototype's torch()). */
export function torchTrip(distance: number, p: TorchParams): TorchTrip {
  const a = p.accel
  const dvMax = p.exhaustSpeed * Math.log(1 / (1 - p.propellantFraction))
  const cap = p.speedCap && p.speedCap > 0 ? p.speedCap : Infinity
  let vPeak: number
  let t: number
  let limit: TorchTrip['limit']
  if (p.stop) {
    const vFlip = Math.sqrt(a * distance)
    const vCan = Math.min(dvMax / 2, cap)
    if (vFlip <= vCan) {
      vPeak = vFlip
      t = 2 * Math.sqrt(distance / a)
      limit = 'flip halfway'
    } else {
      vPeak = vCan
      const ta = vPeak / a
      const da = (vPeak * vPeak) / (2 * a)
      t = 2 * ta + (distance - 2 * da) / vPeak
      limit = cap < dvMax / 2 ? 'speed limit' : 'tanks'
    }
  } else {
    const vEnd = Math.sqrt(2 * a * distance)
    const vCan = Math.min(dvMax, cap)
    if (vEnd <= vCan) {
      vPeak = vEnd
      t = Math.sqrt((2 * distance) / a)
      limit = 'burning all the way'
    } else {
      vPeak = vCan
      const ta = vPeak / a
      const da = (vPeak * vPeak) / (2 * a)
      t = ta + (distance - da) / vPeak
      limit = cap < dvMax ? 'speed limit' : 'tanks'
    }
  }
  const dvUsed = vPeak * (p.stop ? 2 : 1)
  return { time: t, peakSpeed: vPeak, limit, propellantUsed: 1 - Math.exp(-dvUsed / p.exhaustSpeed) }
}

/** Kinetic power in the exhaust of a ship of mass m accelerating at a: ½·m·a·vₑ, W. */
export function jetPower(mass: number, accel: number, exhaustSpeed: number): number {
  return 0.5 * mass * accel * exhaustSpeed
}

/** Apparent magnitude of a source radiating `luminosity` W (in the visible) at distance d (the prototype's magL). */
export function apparentMagnitude(luminosity: number, distance: number): number {
  return -26.74 - 2.5 * Math.log10(luminosity / L_SUN) + 5 * Math.log10(distance / AU)
}

// ---- a particular ship: thrust-limited burns, tanks, coasting ----

/** Energy released per kilogram of fusion fuel burned (deuterium–helium-3, all of it turned to use), J/kg. */
export const FUSION_ENERGY = 3.5e14

export interface Engine {
  /** Exhaust speed, m/s. */
  exhaust: number
  /** Total thrust at full power, N. */
  thrust: number
  /** The most acceleration the crew will take, m/s² (thrust is throttled to it). */
  maxAccel: number
}

export interface BurnStep {
  time: number
  distance: number
}

export interface Burn {
  /** Speeding up from rest. */
  accel: BurnStep
  /** At the peak speed, engine off. */
  coast: BurnStep
  /** Slowing to rest. */
  decel: BurnStep
  peakSpeed: number
  /** Propellant used, kg. */
  propellant: number
  /** Mass at the end, kg. */
  massEnd: number
}

/**
 * A change of speed of `dv` from `v0` (up when dv > 0, down when dv < 0)
 * starting at mass m0: acceleration is thrust / mass, capped at maxAccel,
 * and mass falls by the rocket equation as it goes.
 */
export function speedChange(m0: number, v0: number, dv: number, e: Engine, steps = 200): BurnStep & { massEnd: number } {
  const n = Math.max(1, steps)
  const h = Math.abs(dv) / n
  const sign = dv >= 0 ? 1 : -1
  let m = m0
  let v = v0
  let time = 0
  let distance = 0
  for (let k = 0; k < n; k++) {
    const a = Math.min(e.thrust / m, e.maxAccel)
    const dt = h / a
    const vNext = v + sign * h
    distance += ((v + vNext) / 2) * dt
    time += dt
    v = vNext
    m *= Math.exp(-h / e.exhaust)
  }
  return { time, distance, massEnd: m }
}

/**
 * Rest to rest over `distance` (a crawl between a port and the foam's edge):
 * speed up, coast, slow down. The peak speed is the flip-halfway speed, or
 * `speedCap` if that is lower (then the middle is a coast).
 */
export function crawl(distance: number, m0: number, e: Engine, speedCap = Infinity): Burn {
  const span = (v: number): number => {
    const up = speedChange(m0, 0, v, e)
    const down = speedChange(up.massEnd, v, -v, e)
    return up.distance + down.distance
  }
  // The flip speed: speeding up and slowing down cover the distance exactly.
  let hi = Math.sqrt(distance * e.maxAccel) * 1.2 + 1
  while (span(hi) < distance) hi *= 2
  let lo = 0
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (span(mid) < distance) lo = mid
    else hi = mid
  }
  const peak = Math.min((lo + hi) / 2, speedCap)
  const up = speedChange(m0, 0, peak, e)
  const down = speedChange(up.massEnd, peak, -peak, e)
  const coastDistance = Math.max(0, distance - up.distance - down.distance)
  return {
    accel: { time: up.time, distance: up.distance },
    coast: { time: peak > 0 ? coastDistance / peak : 0, distance: coastDistance },
    decel: { time: down.time, distance: down.distance },
    peakSpeed: peak,
    propellant: m0 - down.massEnd,
    massEnd: down.massEnd
  }
}
