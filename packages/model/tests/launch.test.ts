import { describe, expect, it } from 'vitest'
import { GM_EARTH } from '@malevo/core'
import { launchSlots } from '@malevo/model'

const SIDEREAL_H = 23.9345
const earth = (lat: number, spare = 100, extra: object = {}) =>
  launchSlots({
    radius: 6378e3,
    mu: GM_EARTH,
    rotation_h: SIDEREAL_H,
    orbit_km: 400,
    site: { lat_deg: lat, lon_deg: 0 },
    track: { inclination_deg: 51.6, node_lon_deg: 0, arg_deg: 0, at: { t_s: 0 } },
    from: 0,
    spare_ms: spare,
    ascent_min: 10,
    ...extra
  })
const gaps = (slots: { best: number }[]) => slots.slice(1).map((s, i) => (s.best - slots[i].best) / 3600)

describe('launch slots back up to the ship', () => {
  it('come twice a day, unevenly, from a site nearer the equator than the orbit is tilted', () => {
    const s = earth(28.5)
    const g = gaps(s).slice(0, 4)
    // The site passes through the plane at about 25.5° and 154.5° from the node: 8.6 h, then 15.4 h (sidereal).
    expect(g.filter((x) => Math.abs(x - 8.58) < 0.1).length).toBe(2)
    expect(g.filter((x) => Math.abs(x - 15.36) < 0.1).length).toBe(2)
    expect(new Set(s.slice(0, 2).map((x) => x.heading)).size).toBe(2)
    for (const x of s) expect(x.dv_ms).toBeLessThan(1)
  })

  it('bunch up closer to the tilt: 5 h, then 19 h at 45°', () => {
    const g = gaps(earth(45)).slice(0, 4)
    expect(g.some((x) => Math.abs(x - 5.0) < 0.15)).toBe(true)
    expect(g.some((x) => Math.abs(x - 18.9) < 0.15)).toBe(true)
  })

  it('stay open as long as the spare velocity covers the turn into the plane', () => {
    // About 21 m/s a minute off at 28.5°: 100 m/s spare is about ±5 min.
    const s = earth(28.5)[0]
    expect((s.close - s.best) / 60).toBeGreaterThan(4.2)
    expect((s.close - s.best) / 60).toBeLessThan(5.6)
    const wide = earth(28.5, 400)[0]
    expect(wide.close - wide.open).toBeGreaterThan(3.5 * (s.close - s.open))
  })

  it('come once a day, or not at all, beyond the tilt', () => {
    expect(earth(60)).toEqual([])
    // 54° is 2.4° off the plane at best: about 320 m/s to turn.
    const far = earth(54, 400)
    expect(far.length).toBeGreaterThan(1)
    expect(gaps(far)[0]).toBeGreaterThan(23)
    expect(far[0].dv_ms).toBeGreaterThan(250)
  })

  it('say how long catching the ship takes, from where it is when the lighter reaches orbit', () => {
    for (const x of earth(28.5)) {
      expect(Math.abs(x.phase_deg)).toBeLessThanOrEqual(180)
      // Ten minutes up, half an hour alongside, and the catch-up: up to half an orbit's lead at 1.5·n·Δh/r.
      expect(x.alongside_s).toBeGreaterThanOrEqual(2400)
      expect(x.alongside_s).toBeLessThan(2400 + 40 * 3600)
    }
  })

  it('include a slot already open at the earliest liftoff', () => {
    const s = earth(28.5)
    const late = earth(28.5, 100, { from: s[0].best + 60 })
    expect(late[0].open).toBe(s[0].best + 60)
    expect(late[0].close).toBeCloseTo(s[0].close, -1)
  })
})
