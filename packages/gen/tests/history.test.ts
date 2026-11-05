import { describe, expect, it } from 'vitest'
import { segmentHitsEllipsoid } from '@malevo/core'
import { history, runGenerator } from '@malevo/gen'
import { syntheticInput, syntheticStars } from './synthetic'

const stars = syntheticStars(5000, 240)

describe('history@1', () => {
  const inp = syntheticInput(stars)
  const out = runGenerator(history, inp, 11)
  const byStar = new Map(stars.map((s) => [s.id, s]))
  const d = (a: string, b: string): number => {
    const p = byStar.get(a)!.pos
    const q = byStar.get(b)!.pos
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  }

  it('is repeatable and does not depend on the order of the stars', () => {
    expect(runGenerator(history, inp, 11)).toEqual(out)
    expect(runGenerator(history, { ...inp, stars: [...stars].reverse() }, 11)).toEqual(out)
    expect(runGenerator(history, inp, 12)).not.toEqual(out)
  })

  it('settles about as many systems as asked, and keeps to the timeline', () => {
    expect(out.systems.length).toBeGreaterThan(90)
    expect(out.systems.length).toBeLessThan(160)
    for (const s of out.systems) {
      expect(s.founded).toBeGreaterThanOrEqual(300)
      expect(s.founded).toBeLessThanOrEqual(1000)
      // Before the foam drive, only slow ships: nothing past their reach.
      if (s.founded < 650) expect(d('s0', s.star)).toBeLessThanOrEqual(20)
    }
    expect(out.systems.some((s) => s.founded < 650 && s.star !== 's0')).toBe(true)
    expect(out.systems.some((s) => d('s0', s.star) > 60)).toBe(true)
    for (const e of out.events) expect(e.year).toBeGreaterThanOrEqual(300)
  })

  it('keeps every lane within the leg limit, and founds belief enclaves only once the belief exists', () => {
    for (const l of out.lanes.filter((x) => !x.slow))
      for (let k = 1; k < l.stars.length; k++) expect(d(l.stars[k - 1], l.stars[k])).toBeLessThanOrEqual(15 + 1e-9)
    for (const l of out.lanes.filter((x) => x.slow)) expect(d(l.stars[0], l.stars[l.stars.length - 1])).toBeLessThanOrEqual(20)
    const enclaves = out.systems.filter((s) => s.mixFounded.belief === 1)
    for (const s of enclaves) expect(s.founded).toBeGreaterThanOrEqual(700)
    // New regional cultures branch off, each named from its parent's sounds.
    expect(out.cultures.length).toBeGreaterThan(0)
    for (const c of out.cultures) expect(c.key.startsWith('gen-')).toBe(true)
  })

  it('draws polity borders close to the shares asked for', () => {
    expect(Object.keys(out.capitals).sort()).toEqual(['north', 'south'])
    for (const k of ['north', 'south']) expect(Math.abs(out.shares[k].actual - 0.3)).toBeLessThan(0.08)
    const north = out.systems.filter((s) => s.polity === 'north')
    expect(north.every((s) => s.politySince! >= 850 || s.politySince! >= s.founded)).toBe(true)
  })

  it('goes around nebulae', () => {
    const neb = { center: [40, 0, 0] as const, radii: [12, 40, 20] as const }
    const o = runGenerator(history, { ...inp, nebulae: [neb] }, 11)
    for (const l of o.lanes.filter((x) => !x.slow))
      for (let k = 1; k < l.stars.length; k++)
        expect(segmentHitsEllipsoid(byStar.get(l.stars[k - 1])!.pos, byStar.get(l.stars[k])!.pos, neb)).toBe(false)
  })

  it('honours fixed facts, and reports the ones it cannot', () => {
    const far = stars.filter((s) => d('s0', s.id) > 80 && d('s0', s.id) < 95)[0]
    const near = out.systems.find((s) => s.founded > 700 && d('s0', s.star) > 30)!
    const o = runGenerator(
      history,
      {
        ...inp,
        fixed: [
          { star: near.star, year: 720, polity: 'south', mix: { belief: 1 }, name: 'Kept' },
          { star: far.id, year: 400, name: 'Too soon' }
        ]
      },
      11
    )
    const kept = o.systems.find((s) => s.star === near.star)!
    expect(kept).toMatchObject({ founded: 720, fixed: true, name: 'Kept', polity: 'south', mixFounded: { belief: 1 } })
    expect(o.conflicts.some((c) => c.startsWith('Too soon is settled in year 400, before the foam drive'))).toBe(true)
    // A fixed capital is used as given.
    const cap = runGenerator(history, { ...inp, polities: [{ key: 'north', share: 0.3, capital: near.star, unify: 0 }] }, 11)
    expect(cap.capitals.north).toBe(near.star)
  })
})
