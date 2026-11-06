import { describe, expect, it } from 'vitest'
import { Lexicon, packWordNet } from '../src/lexicon'

// A few hand-made lines in WordNet's data-file format (offsets are made up but consistent).
const adj = [
  '  1 licence text is skipped',
  '00000001 00 a 01 slow 0 003 & 00000002 a 0000 + 00000010 n 0101 ! 00000003 a 0101 | not moving quickly; "a slow walker"',
  '00000002 00 s 03 heavy 0 lumbering 0 ponderous 0 001 & 00000001 a 0000 | slow and laborious because of weight',
  '00000003 00 a 01 fast 0 001 ! 00000001 a 0101 | moving quickly'
].join('\n')
const noun = [
  '00000010 07 n 01 slowness 0 002 + 00000001 a 0101 ~ 00000011 n 0000 | unhurried quality',
  '00000011 07 n 02 sluggishness 0 inertia 0 001 @ 00000010 n 0000 | the quality of being slow to act',
  '00000020 05 n 02 sloth 0 tree_sloth 0 000 | slow-moving arboreal mammal',
  '00000021 06 n 01 barge 0 000 | a boat with a flat bottom for carrying heavy loads'
].join('\n')

const lx = new Lexicon(packWordNet({ noun, verb: '', adj, adv: '' }, 'test'))

describe('the word list', () => {
  it('packs WordNet lines into senses, with stable ids and categories', () => {
    const [slow] = lx.senses('slow')
    expect(slow).toMatchObject({ id: '00000001-a', pos: 'a', category: 'adj.all', words: ['slow'] })
    expect(lx.senses('sloth')[0]).toMatchObject({ category: 'noun.animal', words: ['sloth', 'tree sloth'] })
  })

  it('finds base forms of inflected words', () => {
    expect(lx.senses('barges').map((s) => s.id)).toEqual(['00000021-n'])
    expect(lx.senses('nothing')).toEqual([])
  })

  it('follows only the ticked links, and says how each word was reached', () => {
    const slow = { word: 'slow', senses: ['00000001-a'] }
    const near = lx.explore({ concepts: [slow], links: ['similar'], depth: 1, defined: false })
    expect(near.words.map((w) => w.word)).toEqual(['heavy', 'lumbering', 'ponderous', 'slow'])
    expect(near.words.find((w) => w.word === 'lumbering')!.reached[0]).toMatchObject({ steps: 1, path: 'slow → similar → heavy' })

    const deeper = lx.explore({ concepts: [slow], links: ['derived', 'narrower'], depth: 2, defined: false })
    expect(deeper.words.find((w) => w.word === 'inertia')!.reached[0]).toMatchObject({
      steps: 2,
      path: 'slow → derived → slowness → narrower → sluggishness'
    })
    expect(deeper.words.some((w) => w.word === 'fast')).toBe(false)
    expect(lx.explore({ concepts: [slow], links: ['opposite'], depth: 1, defined: false }).words.map((w) => w.word)).toContain('fast')
  })

  it('finds senses whose definition uses a chosen word', () => {
    const r = lx.explore({ concepts: [{ word: 'slow', senses: ['00000001-a'] }], links: [], depth: 1, defined: true })
    expect(r.words.map((w) => w.word)).toEqual(expect.arrayContaining(['sloth', 'sluggishness', 'heavy']))
    expect(r.words.find((w) => w.word === 'sloth')!.reached[0].path).toBe('slow → defined using “slow” → sloth')
  })

  it('reports which concepts reach each word, for narrowing to words reached from all of them', () => {
    const r = lx.explore({
      concepts: [
        { word: 'slow', senses: ['00000001-a'] },
        { word: 'heavy', senses: ['00000002-s'] }
      ],
      links: ['similar'],
      depth: 1,
      defined: true
    })
    const both = r.words.filter((w) => w.reached.length === 2).map((w) => w.word)
    expect(both).toEqual(expect.arrayContaining(['slow', 'heavy', 'lumbering']))
    expect(both).not.toContain('barge')
    expect(r.words.find((w) => w.word === 'barge')!.reached.map((x) => x.concept)).toEqual([1])
  })
})
