/**
 * The ride: what the people aboard feel, moment by moment, going down or up. Two things: the push (the
 * acceleration felt, in g: thrust and the air's drag and lift, never gravity, which is felt only as weight on
 * the ground or not at all in free fall) and the shaking (dynamic pressure, ½ρv², the air's push on the hull,
 * which is what sets the buffeting; worst at its peak, "max-Q", and through the sound barrier).
 *
 * The climb: a lighter from the pad to the ship's orbit, worked out step by step in the orbit's plane: a
 * vertical rise, a pitch over as it climbs, throttled back so the push never passes a set limit, engines off
 * when the high point of its path reaches the orbit, a coast up to it, and a last burn to match the ship's
 * speed there. The planet's rotation (a push eastward for free) is left out.
 */
import { G0 } from '@malevo/core'

export interface RideSample {
  /** Seconds from the start (the burn, or liftoff). */
  t: number
  /** The push felt, g. */
  g: number
  /** Dynamic pressure, kPa. */
  q: number
  h_km: number
  v_ms: number
}

export interface Ride {
  samples: RideSample[]
  peak_g: number
  /** Time spent above 2 g and above 4 g, s. */
  over2g_s: number
  over4g_s: number
  maxQ_kPa: number
  maxQ_t: number
  /** When the shaking is hardest: dynamic pressure above half its peak, s from the start. */
  shake: { from: number; to: number } | null
  /** When it passes the speed of sound, s from the start (null: never in the air). */
  mach1_t: number | null
  /** How hard the shaking is, in a word. */
  shakeWord: string
}

/** Grade the worst of the air's push: Earth's rockets peak about 30–35 kPa. */
export function shakeWord(kPa: number): string {
  if (kPa < 2) return 'barely any'
  if (kPa < 10) return 'a steady rumble'
  if (kPa < 25) return 'hard shaking'
  if (kPa < 45) return 'violent shaking, like a rocket at max-Q'
  return 'brutal: far past what rockets fly through'
}

/** Collect samples about once a second, and the summary, as a flight is worked out. */
export class RideLog {
  private samples: RideSample[] = []
  private lastT = -Infinity
  private peak = 0
  private o2 = 0
  private o4 = 0
  private maxQ = 0
  private maxQt = 0
  private mach1: number | null = null
  private qs: { t: number; q: number }[] = []

  constructor(
    /** Speed of sound in the low air, m/s (null: no air). */
    private readonly sound: number | null
  ) {}

  add(t: number, dt: number, g: number, q_Pa: number, h: number, v: number, inAir: boolean): void {
    if (g > this.peak) this.peak = g
    if (g > 2) this.o2 += dt
    if (g > 4) this.o4 += dt
    if (q_Pa > this.maxQ) {
      this.maxQ = q_Pa
      this.maxQt = t
    }
    if (this.mach1 === null && this.sound && inAir && q_Pa > 50) {
      const prev = this.samples.at(-1)
      if (prev && (prev.v_ms - this.sound) * (v - this.sound) <= 0) this.mach1 = t
    }
    if (t - this.lastT >= 1 || q_Pa === this.maxQ) {
      this.samples.push({ t, g, q: q_Pa / 1000, h_km: h / 1000, v_ms: v })
      this.qs.push({ t, q: q_Pa })
      this.lastT = t
    }
  }

  /** A stretch of nothing felt (a coast), in one sample at each end. */
  coast(t0: number, t1: number, h0: number, h1: number, v0: number, v1: number): void {
    this.samples.push({ t: t0, g: 0, q: 0, h_km: h0 / 1000, v_ms: v0 }, { t: t1, g: 0, q: 0, h_km: h1 / 1000, v_ms: v1 })
    this.lastT = t1
  }

  done(): Ride {
    const half = this.maxQ / 2
    const over = this.qs.filter((x) => x.q >= half && this.maxQ > 500)
    return {
      samples: this.samples,
      peak_g: this.peak,
      over2g_s: this.o2,
      over4g_s: this.o4,
      maxQ_kPa: this.maxQ / 1000,
      maxQ_t: this.maxQt,
      shake: over.length ? { from: over[0].t, to: over[over.length - 1].t } : null,
      mach1_t: this.mach1,
      shakeWord: shakeWord(this.maxQ / 1000)
    }
  }
}

export interface ClimbInput {
  mu: number
  radius: number
  /** Air density at a height, kg/m³. */
  rho(h: number): number
  /** Speed of sound in the low air, m/s (null: no air). */
  sound: number | null
  orbit_km: number
  /** Thrust over weight at liftoff (full thrust). */
  thrust_g: number
  /** Throttle back to hold the push at most this, g. */
  max_g: number
  exhaust_kms: number
  /** Mass per drag area, kg/m². */
  beta_kg_m2: number
}

export interface Climb extends Ride {
  /** From liftoff to matching the ship's orbit, s. */
  toOrbit_s: number
  /** Engines off after the main burn, the coast up, and the last burn, s from liftoff. */
  meco_s: number
  coast_s: number
  circ_s: number
  /** How far round the planet it reaches the orbit, radians from the pad. */
  downrange_rad: number
  /** Velocity the engines gave, m/s, and the share of the liftoff mass burnt. */
  dv_ms: number
  propellantShare: number
  error: string | null
}

/** The climb from the pad to the ship's orbit. */
export function climbRide(p: ClimbInput): Climb {
  const R = p.radius
  const target = R + p.orbit_km * 1000
  const ve = p.exhaust_kms * 1000
  const log = new RideLog(p.sound)
  const thrust0 = p.thrust_g * G0 // per unit liftoff mass
  const cap = p.max_g * G0
  // Pitch over by this height: a quarter of the orbit's, but at least well out of the thick air.
  const turnH = Math.max(0.25 * p.orbit_km * 1000, 30_000)
  let r = R
  let vr = 0
  let vt = 0
  let m = 1
  let t = 0
  let dv = 0
  let theta = 0
  const dt = 0.05
  const fail = (error: string): Climb => ({
    ...log.done(),
    toOrbit_s: t,
    meco_s: t,
    coast_s: 0,
    circ_s: 0,
    downrange_rad: theta,
    dv_ms: dv,
    propellantShare: 1 - m,
    error
  })
  if (p.thrust_g <= 1) return fail('Thrust over weight must be more than 1 to leave the ground.')
  const apo = (): number => {
    const v2 = vr * vr + vt * vt
    const eps = v2 / 2 - p.mu / r
    if (eps >= 0) return Infinity
    const a = -p.mu / (2 * eps)
    const h = r * vt
    const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (p.mu * p.mu)))
    return a * (1 + e)
  }
  // The main burn.
  for (let i = 0; i < 2e6; i++) {
    const h = r - R
    const v = Math.hypot(vr, vt)
    const gl = p.mu / (r * r)
    const dens = p.rho(h)
    const q = 0.5 * dens * v * v
    const drag = q / (p.beta_kg_m2 * m)
    const acc = Math.min(thrust0 / m, cap)
    // Straight up until moving, then pitch over with height; once over, hold horizontal but don't fall.
    let psi: number
    if (v < 60 && h < 2000) psi = 0
    else if (h < turnH) psi = (Math.PI / 2) * Math.pow(h / turnH, 0.45)
    else psi = Math.PI / 2
    let ur = Math.cos(psi)
    let ut = Math.sin(psi)
    if (h >= turnH && vr < 0) {
      // Tilt up just enough to stop sinking.
      const s = Math.max(0, Math.min(0.9, (gl - (vt * vt) / r - vr * 0.05) / acc))
      ur = s
      ut = Math.sqrt(1 - s * s)
    }
    const dx = v > 0 ? vr / v : 0
    const dy = v > 0 ? vt / v : 0
    const fr = acc * ur - drag * dx
    const ft = acc * ut - drag * dy
    log.add(t, dt, Math.hypot(fr, ft) / G0, q, h, v, dens > 0)
    vr += (fr - gl + (vt * vt) / r) * dt
    vt += (ft - (vr * vt) / r) * dt
    r += vr * dt
    theta += (vt / r) * dt
    m -= ((acc * m) / ve) * dt
    dv += acc * dt
    t += dt
    if (r < R) return fail('It falls back: more thrust, or a slower pitch over.')
    if (m < 0.02) return fail('It runs out of propellant before reaching orbit: a higher exhaust speed, or a lower orbit.')
    if (apo() >= target) break
    if (t > 3 * 3600) return fail("It never reaches the orbit's height.")
  }
  const meco = t
  // Coast up to the high point.
  const hC = r
  const vC = Math.hypot(vr, vt)
  const hMom = r * vt
  const eps = (vr * vr + vt * vt) / 2 - p.mu / r
  const a = -p.mu / (2 * eps)
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * hMom * hMom) / (p.mu * p.mu)))
  const nuOf = (rr: number): number => Math.acos(Math.max(-1, Math.min(1, ((a * (1 - e * e)) / rr - 1) / Math.max(e, 1e-9))))
  const Mof = (nu: number): number => {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2))
    return E - e * Math.sin(E)
  }
  const n = Math.sqrt(p.mu / a ** 3)
  const nuC = vr >= 0 ? nuOf(r) : Math.PI
  const coast = e > 1e-6 ? (Math.PI - Mof(nuC)) / n : 0
  theta += e > 1e-6 ? Math.PI - nuC : 0
  const rA = a * (1 + e)
  const vA = hMom / rA
  log.coast(t, t + coast, hC - R, rA - R, vC, vA)
  t += coast
  // The last burn: up to the ship's speed at the top.
  const vCirc = Math.sqrt(p.mu / rA)
  let vNow = vA
  const t1 = t
  while (vNow < vCirc && t - t1 < 3600) {
    const acc = Math.min(thrust0 / m, cap)
    vNow += acc * dt
    dv += acc * dt
    m -= ((acc * m) / ve) * dt
    log.add(t, dt, acc / G0, 0, rA - R, vNow, false)
    t += dt
  }
  log.add(t, dt, 0, 0, rA - R, vNow, false)
  return {
    ...log.done(),
    toOrbit_s: t,
    meco_s: meco,
    coast_s: coast,
    circ_s: t - t1,
    downrange_rad: theta,
    dv_ms: dv,
    propellantShare: 1 - m,
    error: m < 0.02 ? 'It runs out of propellant matching the orbit.' : null
  }
}
