import { describe, expect, it } from 'vitest'
import { Lexicon, packWordNet } from '../src/lexicon'
import { nextRound, soundFeatures, soundLikeness, type NamePools, type RoundRequest } from '../src/namegen'

const adj = [
  '00000001 00 a 01 slow 0 002 & 00000002 a 0000 + 00000010 n 0101 | not moving quickly',
  '00000002 00 s 03 heavy 0 lumbering 0 ponderous 0 001 & 00000001 a 0000 | slow and laborious because of weight'
].join('\n')
const adv = '00000030 02 r 01 slowly 0 001 \\ 00000001 a 0101 | in a slow manner'
const fish = Array.from(
  { length: 30 },
  (_, i) => `000001${String(i).padStart(2, '0')} 05 n 01 fish${'abcdefghijklmnopqrstuvwxyzabcd'[i]}${i} 0 001 @ 00000099 n 0000 | a fish`
)
const birds = Array.from(
  { length: 30 },
  (_, i) => `000002${String(i).padStart(2, '0')} 05 n 01 bird${'abcdefghijklmnopqrstuvwxyzabcd'[i]}${i} 0 001 @ 00000098 n 0000 | a bird`
)
const noun = [
  '00000010 07 n 01 slowness 0 001 + 00000001 a 0101 | unhurried quality',
  '00000020 05 n 02 sloth 0 tree_sloth 0 000 | slow-moving arboreal mammal',
  `00000099 05 n 01 fishes 0 030 ${fish.map((_, i) => `~ 000001${String(i).padStart(2, '0')} n 0000`).join(' ')} | fish in general`,
  `00000098 05 n 01 birds 0 030 ${birds.map((_, i) => `~ 000002${String(i).padStart(2, '0')} n 0000`).join(' ')} | birds in general`,
  ...fish,
  ...birds
].join('\n')
const lx = new Lexicon(packWordNet({ noun, verb: '', adj, adv }, 'test'))

const pools: NamePools = {
  source: 'test',
  locales: [
    {
      id: 'xx',
      label: 'Test',
      given: {
        female: ['Dorrie', 'Dora', 'Dorothy', 'Corrie', 'Lorrie', 'Gertrude', 'Hildegard', 'Brunhilde', 'Ethel', 'Mildred', 'Ann', 'Bea'],
        male: ['Bob'],
        any: [
          'Dorrie',
          'Dora',
          'Dorothy',
          'Corrie',
          'Lorrie',
          'Gertrude',
          'Hildegard',
          'Brunhilde',
          'Ethel',
          'Mildred',
          'Ann',
          'Bea',
          'Bob'
        ]
      },
      family: ['Smith']
    }
  ]
}

const base: RoundRequest = {
  mode: 'words',
  count: 10,
  seed: 7,
  focus: 0.6,
  words: { concepts: [], links: ['similar', 'derived'], depth: 1, defined: true, pos: ['n'], categories: [], singleWords: true, sound: 0 },
  sounds: { locales: ['xx'], given: true, family: false, gender: 'female', invented: 0 },
  rated: []
}

describe('rounds of names', () => {
  it('draws words that pass the filters, never one already shown, the same for the same seed', () => {
    const r = nextRound(lx, pools, base)
    expect(r).toHaveLength(10)
    expect(nextRound(lx, pools, base)).toEqual(r)
    const again = nextRound(lx, pools, { ...base, seed: 8, rated: r.map((x) => ({ text: x.text, rating: 'neutral' })) })
    expect(again.some((x) => r.some((y) => y.text === x.text))).toBe(false)
  })

  it('finds an adverb for a meaning: adverbs reached back from the adjective, and by definition', () => {
    const r = nextRound(lx, pools, { ...base, words: { ...base.words, pos: ['r'], concepts: [{ word: 'slow', senses: ['00000001-a'] }] } })
    expect(r.map((x) => x.text)).toEqual(['Slowly'])
    expect(r[0].note).toMatch(/in a slow manner/)
  })

  it('leans toward the neighbours of loved words and away from hated ones', () => {
    const rated = [
      { text: 'fisha0', rating: 'love' as const },
      { text: 'birda0', rating: 'hate' as const }
    ]
    let fishes = 0
    let birdsSeen = 0
    for (let seed = 1; seed <= 10; seed++) {
      const r = nextRound(lx, pools, { ...base, seed, focus: 1, rated })
      fishes += r.filter((x) => /^Fish/.test(x.text)).length
      birdsSeen += r.filter((x) => /^Bird/.test(x.text)).length
    }
    expect(fishes).toBeGreaterThan(80)
    expect(birdsSeen).toBeLessThan(5)
  })

  it('with no lean, ignores the ratings', () => {
    const rated = [{ text: 'fisha0', rating: 'love' as const }]
    let fishes = 0
    for (let seed = 1; seed <= 10; seed++)
      fishes += nextRound(lx, pools, { ...base, seed, focus: 0, rated }).filter((x) => /^Fish/.test(x.text)).length
    expect(fishes).toBeLessThan(70)
  })

  it('measures likeness of sound in the letters', () => {
    const like = (a: string, b: string): number => soundLikeness(soundFeatures(a), soundFeatures(b))
    expect(like('Dorrie', 'Lorrie')).toBeGreaterThan(like('Dorrie', 'Brunhilde'))
    expect(like('Dorrie', 'Dorrie')).toBeCloseTo(1)
  })

  it('draws people’s names by sound: loving Dorrie and hating Brunhilde leans toward the -orrie names', () => {
    const rated = [
      { text: 'Dorrie', rating: 'love' as const },
      { text: 'Brunhilde', rating: 'hate' as const }
    ]
    const r = nextRound(lx, pools, { ...base, mode: 'sounds', count: 3, focus: 1, rated })
    expect(r.every((x) => x.note === 'given name · Test')).toBe(true)
    expect(r.map((x) => x.text)).toEqual(expect.arrayContaining(['Lorrie', 'Corrie']))
    expect(r.map((x) => x.text)).not.toContain('Hildegard')
  })

  it('makes up names from the letter patterns of the names in play, never a real one', () => {
    const r = nextRound(lx, pools, { ...base, mode: 'sounds', sounds: { ...base.sounds, invented: 1 } })
    expect(r.length).toBeGreaterThan(0)
    for (const x of r) {
      expect(x.note).toBe('made up')
      expect(pools.locales[0].given.any).not.toContain(x.text)
    }
  })
})
