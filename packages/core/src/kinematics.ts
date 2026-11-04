/**
 * Vehicle kinematics for timetables, ported from the prototype city-gen.js
 * (moveDist, legTime, runPlan) so the city planner, travel-time estimates and
 * any view of moving vehicles agree.
 */

/**
 * Distance covered `tau` seconds into a leg of length L: accelerate at a,
 * cruise at v, brake at a (a triangle profile when the leg is too short to
 * reach v).
 */
export function moveDistance(tau: number, L: number, v: number, a: number): number {
  const ta = v / a
  const da = (v * v) / a
  if (L <= da) {
    const tm = Math.sqrt(L / a)
    return tau < tm ? 0.5 * a * tau * tau : L - 0.5 * a * (2 * tm - tau) ** 2
  }
  const T = L / v + ta
  return tau < ta ? 0.5 * a * tau * tau : tau < T - ta ? 0.5 * a * ta * ta + v * (tau - ta) : L - 0.5 * a * (T - tau) ** 2
}

/** Time to cover a leg of length L from rest to rest. */
export function legTime(L: number, v: number, a: number): number {
  return L <= (v * v) / a ? 2 * Math.sqrt(L / a) : L / v + v / a
}

export interface RunPlan {
  /** Total time of the run including dwells, s. */
  duration: number
  /** Where the vehicle is u seconds into the run. */
  at(u: number): { s: number; moving: boolean }
}

/**
 * A run through stops at distances `stops` (ascending, first 0, last the line
 * length), dwelling `dwell[i]` seconds at stop i.
 */
export function runPlan(stops: readonly number[], dwell: readonly number[], v: number, a: number): RunPlan {
  const legs: { t0: number; T: number; s0: number; L: number }[] = []
  let t = 0
  for (let i = 0; i < stops.length - 1; i++) {
    t += dwell[i] || 0
    const L = stops[i + 1] - stops[i]
    const T = legTime(L, v, a)
    legs.push({ t0: t, T, s0: stops[i], L })
    t += T
  }
  t += dwell[stops.length - 1] || 0
  return {
    duration: t,
    at(u: number) {
      let s = stops[0]
      for (const g of legs) {
        if (u < g.t0) return { s: g.s0, moving: false }
        if (u <= g.t0 + g.T) return { s: g.s0 + moveDistance(u - g.t0, g.L, v, a), moving: true }
        s = g.s0 + g.L
      }
      return { s, moving: false }
    }
  }
}

/**
 * Runs in progress at time t on a service that departs every `headway`
 * seconds starting at `phase`: the elapsed time u into each run, oldest first.
 */
export function runsInProgress(duration: number, headway: number, phase: number, t: number): number[] {
  const out: number[] = []
  for (let k = Math.floor((t - phase - duration) / headway); k <= Math.floor((t - phase) / headway); k++) {
    const u = t - phase - k * headway
    if (u >= 0 && u <= duration) out.push(u)
  }
  return out
}

/** Expected wait for a service with the given headway, for a passenger arriving at random. */
export function expectedWait(headway: number): number {
  return headway / 2
}
