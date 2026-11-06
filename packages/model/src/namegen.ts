/**
 * Rounds of names for the Names tool, tipped by the person's ratings.
 *
 * No judgement anywhere: the tool looks things up, measures likeness and draws
 * at random. Ratings only change the odds. Each rated name pulls the draw
 * toward names like it (love 3, like 1) or pushes it away (hate −2); neutral
 * does nothing. The tool never writes, combines or proposes a name of its own
 * making beyond what is described here, and it never picks.
 *
 * Two modes:
 *
 * - words: words from the word list (WordNet). The pool is the neighbourhood
 *   of the senses the person ticked, or, with none ticked, every word that
 *   passes their filters (part of speech, kind of thing, letters). Likeness is
 *   closeness in the word list: the same sense, or one or two links apart.
 *   Optionally sound counts as well.
 * - sounds: real given and family names from the languages the person picks,
 *   and made-up names from an order-2 letter chain over those names and the
 *   ones the person liked. Likeness is in the letters: pairs of letters,
 *   beginnings and endings, the pattern of vowels and consonants, length.
 *
 * Every draw is weighted exp(focus × score), so focus 0 ignores the ratings
 * and higher focus stays closer to what was liked. The same request and seed
 * give the same round.
 */
import { mulberry32, type Random } from '@malevo/core'
import { LEX_FILES, type Lexicon, type LinkGroup } from './lexicon'

export const RATINGS = ['neutral', 'hate', 'like', 'love'] as const
export type Rating = (typeof RATINGS)[number]
export const RATING_WEIGHT: Record<Rating, number> = { neutral: 0, hate: -2, like: 1, love: 3 }

export type PartOfSpeech = 'n' | 'v' | 'a' | 'r'

export interface NamePools {
  source: string
  locales: { id: string; label: string; given: { female: string[]; male: string[]; any: string[] }; family: string[] }[]
}

export interface WordsSettings {
  concepts: { word: string; senses: string[] }[]
  links: LinkGroup[]
  depth: number
  /** Also senses whose definition uses a looked-up word. */
  defined: boolean
  pos: PartOfSpeech[]
  categories: string[]
  minLetters?: number
  maxLetters?: number
  singleWords: boolean
  /** How much sound counts beside meaning, 0 to 1. */
  sound: number
}

export interface SoundsSettings {
  locales: string[]
  given: boolean
  family: boolean
  gender: 'any' | 'female' | 'male'
  /** Share of each round that is made up, 0 to 1. */
  invented: number
  minLetters?: number
  maxLetters?: number
}

export interface RoundRequest {
  mode: 'words' | 'sounds'
  count: number
  seed: number
  /** 0: ratings ignored, wander freely; 1: stay close to what was liked. */
  focus: number
  words: WordsSettings
  sounds: SoundsSettings
  /** Every name shown so far, with the person's rating. */
  rated: { text: string; rating: Rating }[]
}

export interface RoundName {
  text: string
  /** What it is, for the person's information: a definition, "given name · German", "made up". Not stored. */
  note: string
}

const key = (s: string): string => s.trim().toLowerCase()
const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
const titleCase = (s: string): string => s.replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
const lettersIn = (s: string): number => s.replace(/[^\p{L}]/gu, '').length
const isVowel = (c: string): boolean => 'aeiouy'.includes(c)

// ---- likeness of sound ----

/** A name's sound, as letter features: pairs of letters (with its edges), how it begins and ends, its vowel pattern, its length. */
export function soundFeatures(name: string): Map<string, number> {
  const f = new Map<string, number>()
  const add = (k: string, v: number): void => void f.set(k, (f.get(k) ?? 0) + v)
  for (const word of name.split(/[\s-]+/)) {
    const w = fold(word)
    if (!w) continue
    const s = `^${w}$`
    for (let i = 0; i + 1 < s.length; i++) add(`b:${s.slice(i, i + 2)}`, 1)
    add(`start:${w.slice(0, 2)}`, 1.5)
    add(`end:${w.slice(-2)}`, 1.5)
    const shape = [...w].map((c) => (isVowel(c) ? 'V' : 'C')).join('')
    add(`shape:${shape.replace(/(.)\1+/g, '$1$1')}`, 1)
    add(`len:${Math.min(12, w.length)}`, 1)
    add(`len:${Math.min(12, w.length + 1)}`, 0.5)
    add(`len:${Math.max(1, w.length - 1)}`, 0.5)
  }
  return f
}

/** Cosine likeness of two feature sets, 0 to 1. */
export function soundLikeness(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) {
    na += v * v
    const w = b.get(k)
    if (w) dot += v * w
  }
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

// ---- drawing ----

/**
 * Draws n distinct items, each with odds exp(k × score). k grows with the log of the pool's size, so the
 * same lean tips a pool of fifty and a pool of fifty thousand alike: at full lean, a score of 1 outweighs
 * the whole rest of the pool.
 */
function drawScored<T>(r: Random, items: { item: T; score: number }[], n: number, focus: number): T[] {
  const k = Math.max(0, focus) * 1.5 * Math.log(Math.max(10, items.length))
  const pool = items.map((x) => ({ item: x.item, w: Math.exp(k * x.score) }))
  let total = pool.reduce((a, x) => a + x.w, 0)
  const out: T[] = []
  while (out.length < n && pool.length && total > 0) {
    let t = r() * total
    let i = 0
    for (; i < pool.length - 1; i++) {
      t -= pool[i].w
      if (t <= 0) break
    }
    out.push(pool[i].item)
    total -= pool[i].w
    pool.splice(i, 1)
  }
  return out
}

function sample<T>(r: Random, items: T[], n: number): T[] {
  if (items.length <= n) return items
  const a = items.slice()
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/** Ratings that count, with their weights, normalised so scores fall roughly in −1…1. */
function weights(q: RoundRequest): { text: string; w: number }[] {
  const rated = q.rated.filter((x) => RATING_WEIGHT[x.rating] !== 0).map((x) => ({ text: x.text, w: RATING_WEIGHT[x.rating] }))
  const sum = rated.reduce((a, x) => a + Math.abs(x.w), 0)
  return sum ? rated.map((x) => ({ text: x.text, w: (x.w / sum) * Math.min(3, rated.length) })) : []
}

function soundScorer(q: RoundRequest): (text: string) => number {
  const rated = weights(q).map((x) => ({ f: soundFeatures(x.text), w: x.w }))
  return (text) => {
    if (!rated.length) return 0
    const f = soundFeatures(text)
    return rated.reduce((a, x) => a + x.w * soundLikeness(f, x.f), 0)
  }
}

// ---- words ----

function wordsRound(lx: Lexicon, q: RoundRequest, r: Random, shown: Set<string>): RoundName[] {
  const s = q.words
  const pos = (i: number): PartOfSpeech => (lx.data.pos[i] === 's' ? 'a' : (lx.data.pos[i] as PartOfSpeech))
  const synsetOk = (i: number): boolean =>
    (!s.pos.length || s.pos.includes(pos(i))) && (!s.categories.length || s.categories.includes(LEX_FILES[lx.data.lex[i]]))
  const wordOk = (w: string): boolean =>
    !shown.has(key(w)) &&
    (!s.singleWords || !/[\s-]/.test(w)) &&
    (!s.maxLetters || lettersIn(w) <= s.maxLetters) &&
    (!s.minLetters || lettersIn(w) >= s.minLetters)
  // word key -> its synsets that pass
  const pool = new Map<string, { word: string; synsets: number[] }>()
  const addSynset = (i: number): void => {
    if (!synsetOk(i)) return
    for (const w of lx.data.words[i]) {
      if (!wordOk(w)) continue
      const k = key(w)
      const e = pool.get(k)
      if (e) e.synsets.push(i)
      else pool.set(k, { word: w, synsets: [i] })
    }
  }
  const starts = s.concepts.flatMap((c) => c.senses.map((id) => lx.indexOf(id)).filter((i): i is number => i !== undefined))
  if (starts.length) {
    for (const i of lx.neighbourhood(starts, s.links, s.depth).keys()) addSynset(i)
    if (s.defined)
      for (const c of s.concepts) {
        const own = c.senses.map((id) => lx.indexOf(id)).filter((i): i is number => i !== undefined)
        if (own.length) for (const i of lx.definedUsing(c.word, own)) addSynset(i)
      }
  } else {
    // No senses ticked: every word passing the filters, sampled so a round stays quick.
    const all: number[] = []
    for (let i = 0; i < lx.size; i++) if (synsetOk(i)) all.push(i)
    for (const i of sample(r, all, 6000)) addSynset(i)
  }
  // Rated words pull in (or push away) their own neighbourhoods: closeness 1 for the same sense, 0.8 one link out,
  // 0.6 two, times the rating's weight over 3 (love 1, like ⅓, hate −⅔).
  // Broader and narrower always count as near, so a loved fish brings its sibling fish (up one, down one).
  const nearLinks = [...new Set<LinkGroup>([...s.links, 'similar', 'derived', 'broader', 'narrower'])]
  const near = new Map<number, number>()
  for (const x of q.rated) {
    const w = RATING_WEIGHT[x.rating] / 3
    const synsets = w ? lx.synsetsOf(x.text) : []
    if (!synsets.length) continue
    for (const [i, steps] of lx.neighbourhood(synsets, nearLinks, 2)) {
      near.set(i, (near.get(i) ?? 0) + w * (1 - 0.2 * steps))
      if (w > 0) addSynset(i)
    }
  }
  const bySound = s.sound > 0 ? soundScorer(q) : null
  const items = [...pool.values()].map((e) => {
    const meaning = Math.max(
      -1.5,
      Math.min(
        1.5,
        e.synsets.reduce((m, i) => (Math.abs(near.get(i) ?? 0) > Math.abs(m) ? (near.get(i) ?? 0) : m), 0)
      )
    )
    const score = (1 - s.sound) * meaning + (bySound ? s.sound * bySound(e.word) : 0)
    return { item: e, score }
  })
  return drawScored(r, items, q.count, q.focus).map((e) => {
    const i = e.synsets[0]
    const gloss = lx.data.gloss[i].split(/;\s*"/)[0]
    const category = LEX_FILES[lx.data.lex[i]].split('.')
    return { text: titleCase(e.word), note: `${category[1] === 'all' ? category[0] : `${category[1]} (${category[0]})`}: ${gloss}` }
  })
}

// ---- sounds ----

function soundsRound(names: NamePools | null, lx: Lexicon | null, q: RoundRequest, r: Random, shown: Set<string>): RoundName[] {
  const s = q.sounds
  const fits = (t: string): boolean =>
    !shown.has(key(t)) && (!s.maxLetters || lettersIn(t) <= s.maxLetters) && (!s.minLetters || lettersIn(t) >= s.minLetters)
  const real = new Map<string, { text: string; note: string }>()
  for (const l of names?.locales ?? []) {
    if (!s.locales.includes(l.id)) continue
    if (s.given)
      for (const t of l.given[s.gender]) if (fits(t) && !real.has(key(t))) real.set(key(t), { text: t, note: `given name · ${l.label}` })
    if (s.family)
      for (const t of l.family) if (fits(t) && !real.has(key(t))) real.set(key(t), { text: t, note: `family name · ${l.label}` })
  }
  const score = soundScorer(q)
  const nInvented = real.size ? Math.round(q.count * Math.max(0, Math.min(1, s.invented))) : q.count

  // Made-up names: an order-2 letter chain over the real names in play and the names the person liked.
  const training: { text: string; w: number }[] = [...real.values()].map((x) => ({ text: fold(x.text), w: 1 }))
  for (const x of q.rated)
    if (x.rating === 'like' || x.rating === 'love') training.push({ text: fold(x.text), w: x.rating === 'love' ? 12 : 4 })
  if (training.length < 20 && lx)
    for (let i = 0; i < 400; i++) {
      const w = lx.data.words[Math.floor(r() * lx.size)][0]
      if (/^[a-z]{4,9}$/.test(w)) training.push({ text: w, w: 0.3 })
    }
  const invented: string[] = []
  if (nInvented && training.length) {
    const chain = new Map<string, Map<string, number>>()
    for (const { text, w } of training) {
      const t = `^^${text}$`
      for (let i = 2; i < t.length; i++) {
        const ctx = t.slice(i - 2, i)
        const m = chain.get(ctx) ?? new Map<string, number>()
        m.set(t[i], (m.get(t[i]) ?? 0) + w)
        chain.set(ctx, m)
      }
    }
    const known = new Set(training.map((t) => t.text))
    const walk = (): string | null => {
      let ctx = '^^'
      let out = ''
      while (out.length < 12) {
        const m = chain.get(ctx)
        if (!m) return null
        let t = r() * [...m.values()].reduce((a, x) => a + x, 0)
        let c = '$'
        for (const [k, v] of m) {
          t -= v
          if (t <= 0) {
            c = k
            break
          }
        }
        if (c === '$') break
        out += c
        ctx = ctx[1] + c
      }
      return out.length >= 3 ? out : null
    }
    const seen = new Set<string>()
    for (let i = 0; i < 400 && seen.size < 200; i++) {
      const w = walk()
      if (!w || known.has(w) || seen.has(w)) continue
      const t = titleCase(w)
      if (!fits(t) || (!s.maxLetters && w.length > 10)) continue
      seen.add(w)
      invented.push(t)
    }
  }
  const fromInvented = drawScored(
    r,
    invented.map((t) => ({ item: t, score: score(t) })),
    nInvented,
    q.focus
  ).map((t) => ({ text: t, note: 'made up' }))
  const realItems = sample(r, [...real.values()], 8000).map((x) => ({ item: x, score: score(x.text) }))
  const fromReal = drawScored(r, realItems, q.count - fromInvented.length, q.focus)
  // Mixed, so made-up names do not sit in a block.
  const out: RoundName[] = []
  const a = [...fromReal]
  const b = [...fromInvented]
  while (a.length || b.length) {
    if (a.length && (!b.length || r() < a.length / (a.length + b.length))) out.push(a.shift()!)
    else out.push(b.shift()!)
  }
  return out
}

/** The next round: up to `count` names never shown before, drawn as described above. */
export function nextRound(lx: Lexicon | null, names: NamePools | null, q: RoundRequest): RoundName[] {
  const r = mulberry32(q.seed >>> 0)
  const shown = new Set(q.rated.map((x) => key(x.text)))
  if (q.mode === 'words') return lx ? wordsRound(lx, q, r, shown) : []
  return soundsRound(names, lx, q, r, shown)
}
