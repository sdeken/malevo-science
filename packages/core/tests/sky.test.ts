import { describe, expect, it } from 'vitest'
import {
  AU,
  DAY,
  DEG,
  G0,
  LY,
  M_JUPITER,
  M_SUN,
  airParams,
  altAz,
  approachAlong,
  crawlProgress,
  limitingMagnitude,
  localFrame,
  luminanceOf,
  marginRange,
  meridianAt,
  muToCd,
  orbitDirections,
  reflectedMagnitude,
  shipsUnderway,
  skyModel,
  spinAxis,
  starMagnitudeAt,
  toLocal,
  type MassPoint,
  type Vec3
} from '@malevo/core'

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]

describe('frames on a tilted, spinning body', () => {
  // An Earth-like planet: orbit in the reference plane, 23.44° tilt, spring equinox at orbital longitude 0.
  const el = { i: 0, node: 0 }
  const tilt = 23.44 * DEG
  const spin = spinAxis(el, tilt, 0)

  const sunAltAt = (lambda: number, lat: number): number => {
    const toSun = neg(orbitDirections(el, lambda).dir)
    // Local noon: the meridian through the Sun's direction.
    const m = toSun.map(
      (x, k) => x - spin.pole[k] * (toSun[0] * spin.pole[0] + toSun[1] * spin.pole[1] + toSun[2] * spin.pole[2])
    ) as unknown as Vec3
    const n = Math.hypot(...m)
    const f = localFrame(spin.pole, [m[0] / n, m[1] / n, m[2] / n], lat, 0)
    return altAz(toLocal(f, toSun)).alt / DEG
  }

  it('puts the noon Sun where Earth’s seasons do', () => {
    expect(sunAltAt(0, 0)).toBeCloseTo(90, 6) // equinox, equator
    expect(sunAltAt(0, 40 * DEG)).toBeCloseTo(50, 6)
    expect(sunAltAt(Math.PI / 2, 40 * DEG)).toBeCloseTo(90 - 40 + 23.44, 6) // northern summer solstice
    expect(sunAltAt(-Math.PI / 2, 40 * DEG)).toBeCloseTo(90 - 40 - 23.44, 6)
  })

  it('turns the meridian with the rotation angle', () => {
    const m0 = meridianAt(spin, 0)
    const m1 = meridianAt(spin, Math.PI)
    expect(m0[0] + m1[0]).toBeCloseTo(0, 12)
    expect(m0[0] * spin.pole[0] + m0[1] * spin.pole[1] + m0[2] * spin.pole[2]).toBeCloseTo(0, 12)
    // East is the direction of rotation: a quarter turn brings the east point to the meridian.
    const f = localFrame(spin.pole, m0, 0, 0)
    const later = meridianAt(spin, Math.PI / 2)
    expect(f.east[0] * later[0] + f.east[1] * later[1] + f.east[2] * later[2]).toBeCloseTo(1, 12)
    expect(altAz(toLocal(f, f.north)).az).toBeCloseTo(0, 12)
    expect(altAz(toLocal(f, f.east)).az / DEG).toBeCloseTo(90, 9)
  })
})

describe('brightness', () => {
  it('gives catalogue stars and the Moon their real magnitudes', () => {
    expect(starMagnitudeAt(1.42, 8.6 * LY)).toBeCloseTo(-1.47, 1) // Sirius
    const full = reflectedMagnitude(-26.74, 1737.4e3, 0.11, 384_400e3, 0)
    expect(full).toBeGreaterThan(-13) // the real full Moon is about −12.7
    expect(full).toBeLessThan(-11.5)
    expect(reflectedMagnitude(-26.74, 1737.4e3, 0.11, 384_400e3, Math.PI)).toBe(Infinity) // new
  })
})

describe('the sky over an Earth-like planet', () => {
  const air = airParams({ radius: 6371e3, column: 1, scaleHeight: 8000, light: 1 })
  const sky = (sunAlt: number, column = 1) =>
    skyModel({
      air: column ? air : airParams({ radius: 6371e3, column: 0, scaleHeight: 8000, light: 1 }),
      column,
      sun: [0, Math.cos(sunAlt * DEG), Math.sin(sunAlt * DEG)],
      // The galactic pole overhead, so the Milky Way lies along the horizon.
      galPole: [0, 0, 1],
      galCentre: [0, 1, 0]
    })
  const zenith: Vec3 = [0, 0, 1]

  it('is bright by day, darkens through twilight, and is dark at night', () => {
    const day = luminanceOf(sky(45).light(zenith))
    expect(day).toBeGreaterThan(1000)
    expect(day).toBeLessThan(30_000)
    const steps = [0, -3, -6, -9, -12, -15, -18].map((h) => luminanceOf(sky(h).light(zenith)))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1])
    const night = luminanceOf(sky(-30).light([0, 0.3, 0.95]))
    expect(night).toBeGreaterThan(muToCd(22))
    expect(night).toBeLessThan(muToCd(20.5))
    const blue = sky(45).light(zenith)
    expect(blue[2]).toBeGreaterThan(blue[0])
  })

  it('lets the eye see sixth-magnitude stars at night and none by day', () => {
    const nightLim = sky(-30).limitingMagnitude(zenith)
    expect(nightLim).toBeGreaterThan(5.8)
    expect(nightLim).toBeLessThan(7.5)
    expect(sky(30).limitingMagnitude(zenith)).toBeLessThan(-1)
    expect(limitingMagnitude(muToCd(21.8), { aperture: 50, magnification: 10, transmission: 0.85 })).toBeGreaterThan(nightLim)
    expect(sky(-30).extinction([0, 1, 0.05])).toBeGreaterThan(sky(-30).extinction(zenith))
  })

  it('without air the sky stays black in daylight', () => {
    const s = sky(45, 0)
    expect(luminanceOf(s.light(zenith))).toBeLessThan(muToCd(21))
    expect(s.extinction([0, 1, 0.05])).toBe(0)
  })
})

describe('torches on their crawl', () => {
  it('flips halfway inbound and burns all the way outbound', () => {
    const L = 1.7 * AU
    const a = G0
    const T = 2 * Math.sqrt(L / a)
    expect(crawlProgress('in', T / 2, L, a).s).toBeCloseTo(L / 2, 0)
    expect(crawlProgress('in', T, L, a)).toEqual({ s: L, accelerating: false })
    expect(crawlProgress('out', 100, L, a)).toEqual({ s: 0.5 * a * 100 * 100, accelerating: true })
  })

  it('has λ·T ships under way on average, the whole number either side at any instant', () => {
    const perDay = 7.3
    const T = 2.6 * DAY
    const expected = (perDay * T) / DAY
    let sum = 0
    const N = 2000
    for (let k = 0; k < N; k++) {
      const n = shipsUnderway(perDay, T, k * 3917.3, 0.37).length
      expect(n === Math.floor(expected) || n === Math.ceil(expected)).toBe(true)
      sum += n
    }
    expect(sum / N).toBeCloseTo(expected, 1)
  })
})

describe('approach', () => {
  const foam = { collapseRadius: 2.7 * AU, rule: 'max-eigen' as const }
  const star: MassPoint = { pos: [0, 0, 0], mass: M_SUN }
  const port: Vec3 = [AU, 0, 0]
  const line = { aim: port, back: [1, 0, 0] as Vec3 }

  it('drops at the collapse radius for a lone star and crawls the rest', () => {
    const r = approachAlong(line, [star], foam, port, G0, 6 * AU)
    expect(r.drop![0] / AU).toBeCloseTo(2.7, 3)
    expect(r.crawlDistance! / AU).toBeCloseTo(1.7, 3)
  })

  it('finds a lee where a giant’s tide shortens the crawl, and margins that bracket it', () => {
    const base = approachAlong(line, [star], foam, port, G0, 6 * AU).crawl!
    let best = Infinity
    // The giant must pass within about 0.34 AU of the line to halve the star's tide there.
    for (let deg = 0; deg < 30; deg += 0.25) {
      const giant: MassPoint = { pos: [2.6 * AU * Math.cos(deg * DEG), 2.6 * AU * Math.sin(deg * DEG), 0], mass: M_JUPITER }
      best = Math.min(best, approachAlong(line, [star, giant], foam, port, G0, 6 * AU).crawl ?? Infinity)
    }
    expect(best).toBeLessThan(base * 0.95)
    const m = marginRange(line, 0.05 * AU, (l) => approachAlong(l, [star], foam, port, G0, 6 * AU), 12)
    expect(m.best!).toBeLessThanOrEqual(base + 1)
    expect(m.worst!).toBeGreaterThanOrEqual(base - 1)
  })
})
