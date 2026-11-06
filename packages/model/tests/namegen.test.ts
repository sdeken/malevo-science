import { describe, expect, it } from 'vitest'
import { Lexicon, packWordNet } from '../src/lexicon'
import { nextBatch, type BatchRequest } from '../src/namegen'

const adj = [
  '00000001 00 a 01 slow 0 002 & 00000002 a 0000 + 00000010 n 0101 | not moving quickly',
  '00000002 00 s 03 heavy 0 lumbering 0 ponderous 0 001 & 00000001 a 0000 | slow and laborious because of weight'
].join('\n')
const noun = [
  '00000010 07 n 01 slowness 0 002 + 00000001 a 0101 ~ 00000011 n 0000 | unhurried quality',
  '00000011 07 n 02 sluggishness 0 inertia 0 001 @ 00000010 n 0000 | the quality of being slow to act',
  '00000020 05 n 02 sloth 0 tree_sloth 0 001 @ 00000022 n 0000 | slow-moving arboreal mammal',
  '00000022 05 n 01 mammal 0 001 ~ 00000020 n 0000 | a warm-blooded animal',
  '00000021 06 n 01 barge 0 000 | a boat with a flat bottom for carrying heavy loads'
].join('\n')
const lx = new Lexicon(packWordNet({ noun, verb: '', adj, adv: '' }, 'test'))

const base: BatchRequest = {
  count: 10,
  sources: ['words'],
  seed: 7,
  concepts: [{ word: 'slow', senses: ['00000001-a'] }],
  links: ['similar', 'derived', 'narrower', 'broader'],
  depth: 2,
  defined: true,
  narrow: {},
  examples: [],
  liked: [],
  earlier: [],
  exclude: []
}

describe('batches of names', () => {
  it('draws the first batch of words from the ticked senses, and says how each was reached', () => {
    const b = nextBatch(lx, base)
    expect(b.length).toBeGreaterThan(3)
    expect(b.every((x) => x.source === 'words' && x.from.startsWith('slow'))).toBe(true)
    expect(b.map((x) => x.text)).toContain('Sloth')
  })

  it('is the same for the same seed, and never repeats a name already shown', () => {
    expect(nextBatch(lx, base)).toEqual(nextBatch(lx, base))
    const shown = nextBatch(lx, base).map((x) => x.text)
    const again = nextBatch(lx, { ...base, seed: 8, exclude: shown })
    expect(again.some((x) => shown.includes(x.text))).toBe(false)
  })

  it('draws on liked words: their neighbours come up, marked as near what was liked', () => {
    const b = nextBatch(lx, { ...base, concepts: [], liked: ['Sloth'] })
    expect(b.map((x) => x.text)).toEqual(expect.arrayContaining(['Mammal']))
    expect(b.find((x) => x.text === 'Mammal')!.from).toMatch(/^near what you liked: Sloth/)
  })

  it('narrows words by part of speech and letters', () => {
    const b = nextBatch(lx, { ...base, narrow: { pos: ['n'], maxLetters: 6 } })
    expect(b.length).toBeGreaterThan(0)
    for (const x of b) expect(x.text.replace(/[^A-Za-z]/g, '').length).toBeLessThanOrEqual(6)
    expect(b.map((x) => x.text)).not.toContain('Ponderous')
  })

  it('invents names from the sounds of liked and example names, never one of them', () => {
    const q: BatchRequest = {
      ...base,
      sources: ['sounds'],
      concepts: [],
      examples: ['Aldren', 'Corvane', 'Mirel', 'Tobrin'],
      liked: ['Tobrin']
    }
    const b = nextBatch(lx, q)
    expect(b).toHaveLength(10)
    for (const x of b) {
      expect(x.text).toMatch(/^[A-Z][a-z]{2,}$/)
      expect(['Aldren', 'Corvane', 'Mirel', 'Tobrin']).not.toContain(x.text)
    }
  })

  it('pairs liked names, and shares a batch between the sources', () => {
    const b = nextBatch(lx, { ...base, sources: ['words', 'sounds', 'pairs'], liked: ['Sloth', 'Barge'], examples: ['Aldren'] })
    expect(b).toHaveLength(10)
    expect(new Set(b.map((x) => x.source))).toEqual(new Set(['words', 'sounds', 'pairs']))
    expect(b.filter((x) => x.source === 'pairs').every((x) => /Sloth/.test(x.text) && /Barge/.test(x.text))).toBe(true)
  })

  it('gives a short source’s share to the others', () => {
    const b = nextBatch(lx, { ...base, sources: ['pairs', 'sounds'], concepts: [], examples: ['Aldren', 'Corvane'] })
    expect(b).toHaveLength(10)
    expect(b.every((x) => x.source === 'sounds')).toBe(true)
  })
})
