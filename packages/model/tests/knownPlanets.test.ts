import { describe, expect, it } from 'vitest'
import { KNOWN_SYSTEMS, knownPlanetsFor, type WorldData } from '@malevo/model'

const worldWith = (files: Record<string, unknown>): WorldData =>
  ({
    entities: new Map(
      Object.entries(files).map(([key, value]) => {
        const [kind, id] = key.split('/')
        return [key, { kind: { kind }, id, path: `${kind}s/${id}.json`, value }]
      })
    )
  }) as unknown as WorldData

describe('known planets', () => {
  it('gives a system on Proxima Centauri its confirmed planets, and the candidate only when asked', () => {
    const w = worldWith({ 'system/proxima-centauri': { name: 'Proxima Centauri', star: 'hip.70890' } })
    expect(knownPlanetsFor(w, 'proxima-centauri').map((f) => f.id)).toEqual(['proxima-d', 'proxima-b'])
    expect(knownPlanetsFor(w, 'proxima-centauri', { candidates: true }).map((f) => f.id)).toContain('proxima-c')
    const b = knownPlanetsFor(w, 'proxima-centauri').find((f) => f.id === 'proxima-b')!.value as { orbit: { a_au: number } }
    expect(b.orbit.a_au).toBeCloseTo(0.0486, 3)
  })

  it('leaves out planets the world already has, and stars with none', () => {
    const w = worldWith({
      'system/prox': { name: 'Prox', star: 'hip.70890' },
      'body/proxima-b': { name: 'Mine', system: 'prox' },
      'system/other': { name: 'Other', star: 'hip.1' }
    })
    expect(knownPlanetsFor(w, 'prox').map((f) => f.id)).toEqual(['proxima-d'])
    expect(knownPlanetsFor(w, 'other')).toEqual([])
  })

  it('matches each planet’s period to its orbit for the star’s mass (Kepler)', () => {
    // Proxima Centauri: 0.122 solar masses.
    for (const p of KNOWN_SYSTEMS[0].planets) {
      const years = Math.sqrt(p.a_au ** 3 / 0.122)
      expect(Math.abs(years * 365.25 - p.period_d) / p.period_d).toBeLessThan(0.03)
    }
  })
})
