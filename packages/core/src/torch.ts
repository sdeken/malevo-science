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
