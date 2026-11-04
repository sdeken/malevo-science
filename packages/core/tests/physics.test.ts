import { describe, expect, it } from 'vitest'
import {
  AU,
  C,
  DAY,
  DEG,
  G0,
  GM_EARTH,
  GM_SUN,
  JULIAN_YEAR,
  LY,
  L_SUN,
  M_JUPITER,
  M_SUN,
  apparentMagnitude,
  balanceReport,
  collapseRadius,
  daylightFraction,
  edgeTotals,
  elementsFromState,
  findWindows,
  firstCollapseAlong,
  flipAndBurnTime,
  foamLoad,
  foamTime,
  formatInstant,
  buildCalendars,
  habitableZone,
  hillRadius,
  insolation,
  itineraryFleet,
  legTime,
  legsNeeded,
  moveDistance,
  mulberry32,
  nodeBalances,
  parseInstant,
  period,
  positionAt,
  proposeBalancing,
  runPlan,
  runsInProgress,
  semiMajorAxisForPeriod,
  shipsInTransit,
  solarDayLength,
  solarDeclination,
  solveKepler,
  stateAt,
  synodicPeriod,
  tidalAcceleration,
  topSpeedWithGravity,
  torchTrip,
  toSpherical,
  type FlowNetwork,
  type MassPoint,
  type OrbitalElements,
  type Vec3
} from '@malevo/core'

const close = (a: number, b: number, tol: number): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
}
const rel = (a: number, b: number, tol: number): void => close(a / b, 1, tol)

// ---- prototype code from story-thing/tools (reformatted only), used as references for the ports ----
// lee-planner/index.html: the load and the first-collapse scan, with its constants made parameters.
function protoLoadAt(x: number, y: number, z: number, H: number[] | null, Q: number, R03: number, ruleMax: boolean) {
  const T = new Float64Array(6)
  function addT(dx: number, dy: number, dz: number, m: number) {
    const r2 = dx * dx + dy * dy + dz * dz,
      r = Math.sqrt(r2),
      k = m / (r2 * r),
      nx = dx / r,
      ny = dy / r,
      nz = dz / r
    T[0] += k * (3 * nx * nx - 1)
    T[1] += k * (3 * ny * ny - 1)
    T[2] += k * (3 * nz * nz - 1)
    T[3] += 3 * k * nx * ny
    T[4] += 3 * k * nx * nz
    T[5] += 3 * k * ny * nz
  }
  T.fill(0)
  addT(x, y, z, 1)
  if (H) addT(x - H[0], y - H[1], z - H[2], Q)
  const a = T[0],
    b = T[1],
    c = T[2],
    d = T[3],
    e = T[4],
    f = T[5],
    p2 = a * a + b * b + c * c + 2 * (d * d + e * e + f * f)
  if (!ruleMax) return Math.sqrt(p2 / 6) * R03
  const p = Math.sqrt(p2 / 6)
  if (p < 1e-30) return 0
  const A11 = a / p,
    A22 = b / p,
    A33 = c / p,
    A12 = d / p,
    A13 = e / p,
    A23 = f / p
  let r = (A11 * (A22 * A33 - A23 * A23) - A12 * (A12 * A33 - A23 * A13) + A13 * (A12 * A23 - A22 * A13)) / 2
  r = Math.max(-1, Math.min(1, r))
  const ph = Math.acos(r) / 3,
    l1 = 2 * p * Math.cos(ph),
    l3 = 2 * p * Math.cos(ph + (2 * Math.PI) / 3),
    l2 = -l1 - l3
  return (Math.max(Math.abs(l1), Math.abs(l2), Math.abs(l3)) / 2) * R03
}
// travel-times/index.html: torch()
function protoTorch(d: number, p: { g: number; ve: number; mf: number; cap: number; stop: boolean }) {
  const G = 9.80665
  const a = p.g * G,
    dvMax = p.ve * Math.log(1 / (1 - p.mf))
  let vPeak, t, limit
  if (p.stop) {
    const vFlip = Math.sqrt(a * d),
      vCan = Math.min(dvMax / 2, p.cap || Infinity)
    if (vFlip <= vCan) {
      vPeak = vFlip
      t = 2 * Math.sqrt(d / a)
      limit = 'flip halfway'
    } else {
      vPeak = vCan
      const ta = vPeak / a,
        da = (vPeak * vPeak) / (2 * a)
      t = 2 * ta + (d - 2 * da) / vPeak
      limit = p.cap && p.cap < dvMax / 2 ? 'speed limit' : 'tanks'
    }
  } else {
    const vEnd = Math.sqrt(2 * a * d),
      vCan = Math.min(dvMax, p.cap || Infinity)
    if (vEnd <= vCan) {
      vPeak = vEnd
      t = Math.sqrt((2 * d) / a)
      limit = 'burning all the way'
    } else {
      vPeak = vCan
      const ta = vPeak / a,
        da = (vPeak * vPeak) / (2 * a)
      t = ta + (d - da) / vPeak
      limit = p.cap && p.cap < dvMax ? 'speed limit' : 'tanks'
    }
  }
  const dvUsed = vPeak * (p.stop ? 2 : 1),
    used = 1 - Math.exp(-dvUsed / p.ve)
  return { t, vPeak, limit, used }
}
// bluff-planner/city-gen.js: moveDist, legTime
function protoMoveDist(tau: number, Ls: number, v: number, a: number) {
  const ta = v / a,
    da = (v * v) / a
  if (Ls <= da) {
    const tm = Math.sqrt(Ls / a)
    return tau < tm ? 0.5 * a * tau * tau : Ls - 0.5 * a * (2 * tm - tau) ** 2
  }
  const T = Ls / v + ta
  return tau < ta ? 0.5 * a * tau * tau : tau < T - ta ? 0.5 * a * ta * ta + v * (tau - ta) : Ls - 0.5 * a * (T - tau) ** 2
}
function protoLegTime(Ls: number, v: number, a: number) {
  return Ls <= (v * v) / a ? 2 * Math.sqrt(Ls / a) : Ls / v + v / a
}

describe('orbit', () => {
  const earth: OrbitalElements = {
    // J2000 mean elements (Standish, JPL "Keplerian elements for approximate positions of the major planets").
    a: 1.00000261 * AU,
    e: 0.01671123,
    i: -0.00001531 * DEG,
    node: 0,
    peri: 102.93768193 * DEG,
    meanAnomaly: (100.46457166 - 102.93768193) * DEG,
    epoch: 0,
    mu: GM_SUN + GM_EARTH
  }
  const greg = buildCalendars({ g: { kind: 'gregorian' } }).get('g')!
  const at = (text: string): number => parseInstant(greg, text)!

  it('gets the year and Kepler’s third law right', () => {
    rel(period(earth.a, earth.mu), 365.256363 * DAY, 2e-5)
    rel(period(5.2026 * AU, GM_SUN), 11.862 * JULIAN_YEAR, 1e-3)
    rel(semiMajorAxisForPeriod(period(2.6 * AU, GM_SUN), GM_SUN), 2.6 * AU, 1e-12)
  })

  it('places Earth at the 2000 equinox, solstice and perihelion', () => {
    const lon = (text: string): number => toSpherical(positionAt(earth, at(text))).lon / DEG
    close(lon('2000-03-20 07:35'), 180, 0.03) // the Sun at 0° from Earth
    close(lon('2000-06-21 01:48'), 270, 0.03)
    close(lon('2000-12-21 13:37'), 90, 0.03)
    // Perihelion: 2000-01-03 05:18, Earth closest to the Sun.
    const r = (t: number): number => Math.hypot(...positionAt(earth, t))
    const peri = at('2000-01-03 05:18')
    expect(r(peri)).toBeLessThan(r(peri - 2 * DAY))
    expect(r(peri)).toBeLessThan(r(peri + 2 * DAY))
    close(r(peri) / AU, 0.98329, 2e-4)
  })

  it('solves Kepler’s equation across eccentricities', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99]) {
      for (let M = -10; M <= 10; M += 0.37) {
        const E = solveKepler(M, e)
        const wrapped = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        close(E - e * Math.sin(E), wrapped, 1e-12)
      }
    }
    expect(() => solveKepler(1, 1)).toThrow(RangeError)
  })

  it('round-trips state vectors and elements', () => {
    const r = mulberry32(21)
    for (let n = 0; n < 200; n++) {
      const el: OrbitalElements = {
        a: (0.2 + r() * 30) * AU,
        e: r() * 0.9,
        i: 0.01 + r() * 3,
        node: r() * 6.28,
        peri: r() * 6.28,
        meanAnomaly: r() * 6.28,
        epoch: 0,
        mu: GM_SUN
      }
      const t = r() * 1e9
      const s = stateAt(el, t)
      const back = elementsFromState(s.r, s.v, GM_SUN, t)
      rel(back.a, el.a, 1e-9)
      close(back.e, el.e, 1e-9)
      const again = stateAt(back, t + 12345)
      const expected = stateAt(el, t + 12345)
      for (let k = 0; k < 3; k++) close(again.r[k], expected.r[k], el.a * 1e-8)
      // Energy check: vis-viva.
      const v2 = s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2
      rel(v2, GM_SUN * (2 / Math.hypot(...s.r) - 1 / el.a), 1e-9)
    }
  })

  it('computes synodic periods and the drift per lap', () => {
    const p1 = period(1 * AU, GM_SUN)
    const p2 = period(2.6 * AU, GM_SUN)
    rel(p2, 4.192 * JULIAN_YEAR, 1e-3)
    const s = synodicPeriod(p1, p2)
    rel(s, 1.3132 * JULIAN_YEAR, 1e-3)
    close(((s / p1) % 1) * 360, 112.9, 0.2) // the inner body gains this much per lap
    expect(synodicPeriod(p1, p1)).toBe(Infinity)
  })

  it('derives solar days from sidereal rotation', () => {
    rel(solarDayLength(86164.0905, 365.256363 * DAY), DAY, 1e-6)
    rel(solarDayLength(-243.0226 * DAY, 224.701 * DAY), 116.75 * DAY, 2e-3) // Venus, retrograde
    expect(solarDayLength(27.3 * DAY, 27.3 * DAY)).toBe(Infinity)
  })

  it('computes daylight, declination and polar day', () => {
    const tilt = 23.44 * DEG
    // 28°N at the December solstice: 10 h 22 m between sunrise and sunset.
    close(daylightFraction(28 * DEG, solarDeclination(tilt, 270 * DEG)) * 24, 10.364, 0.01)
    close(daylightFraction(0, 0) * 24, 12.11, 0.01) // the equator at equinox, refraction included
    expect(daylightFraction(80 * DEG, solarDeclination(tilt, 90 * DEG))).toBe(1)
    expect(daylightFraction(80 * DEG, solarDeclination(tilt, 270 * DEG))).toBe(0)
  })

  it('gives the habitable zone, flux, tides and Hill spheres', () => {
    const hz = habitableZone(L_SUN)
    close(hz.inner / AU, 0.95, 0.01)
    close(hz.outer / AU, 1.676, 0.01)
    expect(habitableZone(L_SUN, 4000).inner).toBeGreaterThan(hz.inner) // cooler stars push the inner edge out at equal luminosity
    close(insolation(L_SUN, AU), 1361, 1)
    rel(tidalAcceleration(GM_SUN, 6.371e6, AU) / tidalAcceleration(4.9028e12, 6.371e6, 3.844e8), 0.46, 0.02) // the Sun raises 46% of the Moon's tide
    rel(hillRadius(AU, 0, 5.972e24, M_SUN), 1.4966e9, 1e-3)
  })

  it('finds windows when a condition holds', () => {
    const w = findWindows((t) => Math.sin(t / 100) > 0.5, 0, 2000, 10, 1e-6)
    expect(w.length).toBe(4)
    close(w[0][0], 100 * Math.asin(0.5), 1e-5)
    close(w[0][1], 100 * (Math.PI - Math.asin(0.5)), 1e-5)
    expect(findWindows(() => true, 0, 50, 10)).toEqual([[0, 50]])
    expect(findWindows(() => false, 0, 50, 10)).toEqual([])
  })
})

describe('foam', () => {
  const R0 = 2.7 * AU // a synthetic world's setting
  const settings = { collapseRadius: R0, rule: 'max-eigen' as const, topSpeed: 6500 * C, legLimit: 15 * LY, gravityLimit: 1.9 * G0 }

  it('matches the prototype load for a star and a giant, both rules', () => {
    const r = mulberry32(31)
    const Q = 0.000954
    const H = [2.6 * Math.cos(0.3), 2.6 * Math.sin(0.3), 0]
    const bodies: MassPoint[] = [
      { pos: [0, 0, 0], mass: M_SUN },
      { pos: [H[0] * AU, H[1] * AU, 0], mass: Q * M_SUN }
    ]
    for (const rule of ['max-eigen', 'rss'] as const) {
      for (let k = 0; k < 500; k++) {
        const p = [(r() * 2 - 1) * 4, (r() * 2 - 1) * 4, (r() * 2 - 1) * 1]
        const expected = protoLoadAt(p[0], p[1], p[2], H, Q, 2.7 ** 3, rule === 'max-eigen')
        const got = foamLoad([p[0] * AU, p[1] * AU, p[2] * AU], bodies, { collapseRadius: R0, rule })
        rel(got, expected, 1e-9)
      }
    }
  })

  it('collapses at the collapse radius, scaling with the cube root of mass', () => {
    const sun: MassPoint[] = [{ pos: [0, 0, 0], mass: M_SUN }]
    close(foamLoad([R0, 0, 0], sun, settings), 1, 1e-12)
    close(foamLoad([0, 0, R0], sun, { ...settings, rule: 'rss' }), 1, 1e-12)
    rel(collapseRadius(M_JUPITER, settings) / AU, 0.2659, 1e-3)
    // Coming in from x = +5 AU toward −x, offset 0.5 AU from the star.
    const s = firstCollapseAlong([0, 0.5 * AU, 0], [1, 0, 0], sun, settings, 5 * AU, -5 * AU, 0.01 * AU, 1)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(0)
    close(Math.hypot(s!, 0.5 * AU), R0, 2)
    expect(firstCollapseAlong([0, 3 * AU, 0], [1, 0, 0], sun, settings, 3 * AU, -3 * AU, 0.01 * AU)).toBeNull()
  })

  it('shows a lee: a giant square to the star’s pull lightens the load', () => {
    const star: MassPoint = { pos: [0, 0, 0], mass: M_SUN }
    const point: Vec3 = [2.6 * AU, 0, 0]
    const giantBeside: MassPoint = { pos: [2.6 * AU, 0.5 * AU, 0], mass: 0.000954 * M_SUN }
    const giantBehind: MassPoint = { pos: [3.1 * AU, 0, 0], mass: 0.000954 * M_SUN }
    const alone = foamLoad(point, [star], settings)
    expect(foamLoad(point, [star, giantBeside], settings)).toBeLessThan(alone)
    expect(foamLoad(point, [star, giantBehind], settings)).toBeGreaterThan(alone)
  })

  it('trades top speed for artificial gravity, and counts legs', () => {
    rel(topSpeedWithGravity(settings, G0), 6500 * C * Math.sqrt(1 - (1 / 1.9) ** 2), 1e-12)
    close(1 - topSpeedWithGravity(settings, G0) / settings.topSpeed, 0.15, 0.003)
    expect(topSpeedWithGravity(settings, 2 * G0)).toBe(0)
    close(foamTime(4.5 * LY, settings) / 3600, 6.07, 0.01)
    expect(legsNeeded(500 * LY, settings)).toBe(34)
    expect(legsNeeded(1 * LY, settings)).toBe(1)
  })
})

describe('torch', () => {
  it('matches the prototype in every regime', () => {
    const r = mulberry32(41)
    for (let k = 0; k < 400; k++) {
      const p = { g: 0.1 + r() * 3, ve: (0.01 + r() * 0.08) * C, mf: 0.05 + r() * 0.9, cap: r() < 0.3 ? r() * 0.2 * C : 0, stop: r() < 0.5 }
      const d = Math.pow(10, 9 + r() * 8)
      const want = protoTorch(d, p)
      const got = torchTrip(d, { accel: p.g * G0, exhaustSpeed: p.ve, propellantFraction: p.mf, speedCap: p.cap, stop: p.stop })
      rel(got.time, want.t, 1e-12)
      rel(got.peakSpeed, want.vPeak, 1e-12)
      expect(got.limit).toBe(want.limit)
      close(got.propellantUsed, want.used, 1e-12)
    }
  })

  it('crawls 1 AU at 1 g in about 3½ days', () => {
    close(flipAndBurnTime(AU, G0) / DAY, 2.85, 0.01)
  })

  it('puts the Sun at magnitude −26.74 from 1 AU', () => {
    close(apparentMagnitude(L_SUN, AU), -26.74, 1e-12)
    close(apparentMagnitude(L_SUN, 10 * 3.0857e16), -26.74 + 5 * Math.log10((10 * 3.0857e16) / AU), 1e-9)
  })
})

describe('kinematics', () => {
  it('matches the prototype profiles', () => {
    const r = mulberry32(51)
    for (let k = 0; k < 500; k++) {
      const L = 10 + r() * 5000
      const v = 1 + r() * 40
      const a = 0.2 + r() * 2
      const T = legTime(L, v, a)
      expect(T).toBe(protoLegTime(L, v, a))
      for (let j = 0; j <= 10; j++) expect(moveDistance((T * j) / 10, L, v, a)).toBe(protoMoveDist((T * j) / 10, L, v, a))
      close(moveDistance(T, L, v, a), L, 1e-6)
    }
  })

  it('runs through stops with dwells', () => {
    const plan = runPlan([0, 1000, 3000], [0, 30, 0], 20, 1)
    close(plan.duration, legTime(1000, 20, 1) + 30 + legTime(2000, 20, 1), 1e-9)
    expect(plan.at(legTime(1000, 20, 1) + 10)).toEqual({ s: 1000, moving: false })
    expect(plan.at(plan.duration + 5).s).toBe(3000)
    expect(runsInProgress(100, 30, 0, 95)).toEqual([95, 65, 35, 5])
  })
})

describe('flows', () => {
  // The rest-stop example: A → R → B at 17 a day, nothing back.
  const restStop: FlowNetwork = { edges: [], itineraries: [{ id: 'i1', stops: ['A', 'R', 'B'], perDay: 17 }] }

  it('allows asymmetric flows and counts through traffic', () => {
    const net: FlowNetwork = {
      edges: [
        { from: 'P', to: 'Q', perDay: 27 },
        { from: 'Q', to: 'P', perDay: 7 }
      ],
      itineraries: []
    }
    expect(edgeTotals(net).map((e) => [e.from, e.to, e.perDay])).toEqual([
      ['P', 'Q', 27],
      ['Q', 'P', 7]
    ])
    const r = nodeBalances(restStop)
    const R = r.find((b) => b.node === 'R')!
    expect([R.arrivals, R.departures, R.imbalance, R.through]).toEqual([17, 17, 0, 17])
    expect(r.find((b) => b.node === 'A')!.imbalance).toBe(-17)
    expect(r.find((b) => b.node === 'B')!.imbalance).toBe(17)
  })

  it('flags imbalance beyond tolerance, honouring declared sinks and sources', () => {
    const tol = { fraction: 0.02, perDay: 1 }
    expect(balanceReport(restStop, tol).unbalanced.map((b) => b.node)).toEqual(['A', 'B'])
    // A graveyard taking one extra ship every 5 days, fed by a shipyard.
    const net: FlowNetwork = {
      edges: [
        { from: 'Y', to: 'H', perDay: 30.2 },
        { from: 'H', to: 'Y', perDay: 30 },
        { from: 'H', to: 'G', perDay: 0.2 }
      ],
      itineraries: [],
      declared: { G: 0.2, Y: -0.2 }
    }
    const report = balanceReport(net, { fraction: 0, perDay: 1e-9 })
    expect(report.unbalanced).toEqual([])
    close(report.declaredTotal, 0, 1e-12)
    // Declarations that do not cancel are visible.
    expect(balanceReport({ ...net, declared: { G: 0.2 } }, tol).declaredTotal).toBe(0.2)
  })

  it('proposes the cheapest balancing flows, without applying them', () => {
    const cands = [
      { from: 'B', to: 'A', cost: 10 },
      { from: 'B', to: 'C', cost: 2 },
      { from: 'C', to: 'A', cost: 3 }
    ]
    const p = proposeBalancing(restStop, cands)
    expect(p.additions).toEqual([
      { from: 'B', to: 'C', perDay: 17 },
      { from: 'C', to: 'A', perDay: 17 }
    ])
    expect(p.cost).toBe(85)
    expect(p.remaining).toEqual({})
    expect(restStop.edges).toEqual([])
    // With no way back, the imbalance stays and is reported.
    expect(proposeBalancing(restStop, []).remaining).toEqual({ A: -17, B: 17 })
  })

  it('solves a transportation problem optimally', () => {
    // Two surplus nodes and two deficit nodes; the greedy nearest choice is not optimal.
    const net: FlowNetwork = {
      edges: [
        { from: 'x', to: 'S1', perDay: 5 },
        { from: 'y', to: 'S2', perDay: 5 }
      ],
      itineraries: []
    }
    const cands = [
      { from: 'S1', to: 'x', cost: 1 },
      { from: 'S1', to: 'y', cost: 2 },
      { from: 'S2', to: 'x', cost: 2 },
      { from: 'S2', to: 'y', cost: 100 }
    ]
    const p = proposeBalancing(net, cands)
    expect(p.cost).toBe(5 * 2 + 5 * 2) // S1→y and S2→x, not S1→x then S2→y (cost 505)
    expect(p.remaining).toEqual({})
  })

  it('applies Little’s law', () => {
    expect(shipsInTransit(24, 3 * DAY)).toBe(72)
    const fleet = itineraryFleet(
      restStop.itineraries[0],
      () => 2 * DAY,
      () => DAY / 2
    )
    expect(fleet).toBe(17 * 4.5)
  })
})

describe('the gregorian calendar used above', () => {
  it('formats as expected', () => {
    const g = buildCalendars({ g: { kind: 'gregorian' } }).get('g')!
    expect(formatInstant(g, parseInstant(g, '2000-03-20 07:35')!)).toBe('2000-03-20 07:35')
  })
})
