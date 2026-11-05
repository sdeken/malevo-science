/**
 * Golden fixtures (docs/PLAN.md §3.3): every frozen generator version has a
 * file in packages/gen/golden/ pinning the hash of its output for a set of
 * cases. If one no longer matches, something changed the output of a version
 * that locked records depend on: the code, a dependency, or the JavaScript
 * engine. Do not update the fixture to make the test pass; find the change.
 *
 * To create the fixture for a new frozen version (never to update one):
 *   GOLDEN_WRITE=1 npx vitest run packages/gen
 * writes fixtures only for frozen generators that have none yet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syntheticInput, syntheticStars } from './synthetic'
import { describe, expect, it } from 'vitest'
import { canonicalJson, contentHash } from '@malevo/model'
import { GENERATORS, findGenerator, generatorId, placeholderNames, runGenerator, type Generator } from '@malevo/gen'

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden')

interface GoldenCase {
  seed: number
  input: unknown
  hash: string
}
interface GoldenFile {
  generator: string
  note: string
  cases: GoldenCase[]
}

/** The inputs each frozen generator is pinned with. Extend when adding a generator; never change existing ones. */
const STARFIELD_PARAMS = { density: 0.004, scaleHeight: 1000, cell: 25, catalogMag: 8, catalogNear: 25 }
const STARS = [
  { mass_msun: 1, luminosity_lsun: 1, cls: 'G' },
  { mass_msun: 0.12, luminosity_lsun: 0.0016, cls: 'M' },
  { mass_msun: 2.1, luminosity_lsun: 25, cls: 'A' },
  { mass_msun: 0.75, luminosity_lsun: 0.3, cls: 'K' }
]

const CASES: Record<string, { seed: number; input: unknown }[]> = {
  'starfield@1': [1, 42, 4242].flatMap((seed) =>
    [
      [0, 0, 0],
      [3, -2, 1],
      [-7, 5, 0],
      [9, 9, -1]
    ].map((cell) => ({ seed, input: { params: STARFIELD_PARAMS, cell } }))
  ),
  'planets@1': [1, 42, 4242].flatMap((seed) =>
    STARS.flatMap((star, k) => [0, 1, 2].map((roll) => ({ seed, input: { system: `sys-${k}`, systemName: `System ${k}`, star, roll } })))
  ),
  'history@1': [1, 42].map((seed) => ({
    seed,
    input: syntheticInput(syntheticStars(500, 120, 9), {
      growth: { total: 30, maxRadius: 60, outward: 7, legs: 2 },
      years: { slow: 300, foam: 650, end: 900, polities: 850 }
    })
  })),
  'placeholder-names@1': [1, 42, 4242, 0xffffffff].flatMap((seed) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((palette) => ({ seed, input: { ids: ['a', 'b', 'c', 'sys-001', 'sys-002', 'x.y_z'], palette } }))
  )
}

const hashOf = (g: Generator<never, unknown>, seed: number, input: unknown): string =>
  contentHash(canonicalJson(runGenerator(g, input as never, seed)))

describe('golden fixtures', () => {
  for (const g of GENERATORS.filter((x) => x.frozen)) {
    const id = generatorId(g)
    const file = path.join(GOLDEN_DIR, `${id}.json`)

    it(`${id} still produces its pinned output`, () => {
      if (!existsSync(file) && process.env.GOLDEN_WRITE) {
        const cases = CASES[id]
        if (!cases) throw new Error(`Add cases for ${id} to CASES first.`)
        const golden: GoldenFile = {
          generator: id,
          note: 'Pinned output hashes of a frozen generator. Never edit; see packages/gen/tests/golden.test.ts.',
          cases: cases.map((c) => ({ ...c, hash: hashOf(g, c.seed, c.input) }))
        }
        mkdirSync(GOLDEN_DIR, { recursive: true })
        writeFileSync(file, canonicalJson(golden))
      }
      expect(existsSync(file), `${id} is frozen but has no golden fixture; create it with GOLDEN_WRITE=1`).toBe(true)
      const golden = JSON.parse(readFileSync(file, 'utf8')) as GoldenFile
      expect(golden.generator).toBe(id)
      expect(golden.cases.length).toBeGreaterThan(0)
      for (const c of golden.cases) expect(hashOf(g, c.seed, c.input), `${id} seed ${c.seed} input ${JSON.stringify(c.input)}`).toBe(c.hash)
    })
  }

  it('every generator id is unique and findable', () => {
    const ids = GENERATORS.map(generatorId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(findGenerator(id)).toBeDefined()
    expect(findGenerator('nope@1')).toBeUndefined()
  })
})

describe('placeholder-names@1', () => {
  it('gives each id a name that does not depend on the other ids', () => {
    const few = runGenerator(placeholderNames, { ids: ['a', 'b'], palette: 3 }, 99)
    const many = runGenerator(placeholderNames, { ids: ['zz', 'b', 'q', 'a'], palette: 3 }, 99)
    expect(many.a).toBe(few.a)
    expect(many.b).toBe(few.b)
    expect(Object.keys(many)).toEqual(['a', 'b', 'q', 'zz'])
  })

  it('changes with the world seed and the palette', () => {
    const base = runGenerator(placeholderNames, { ids: ['a', 'b', 'c', 'd'], palette: 0 }, 1)
    expect(runGenerator(placeholderNames, { ids: ['a', 'b', 'c', 'd'], palette: 0 }, 2)).not.toEqual(base)
    expect(runGenerator(placeholderNames, { ids: ['a', 'b', 'c', 'd'], palette: 5 }, 1)).not.toEqual(base)
    for (const n of Object.values(base)) expect(n).toMatch(/^[A-Z][a-z]+$/)
  })
})
