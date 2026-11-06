/**
 * Batches of names for the Names tool, driven by what the person liked.
 *
 * Mechanical throughout: nothing judges a name. Three sources, each a plain
 * procedure the person can see in each name's "from":
 *
 * - words: words from the word list. The first batch draws from the
 *   neighbourhood of the senses the person ticked. Later batches draw mostly
 *   (70%) from the neighbourhood of words the person liked or locked: one link
 *   out along the ticked kinds of link.
 * - sounds: invented names. Letter-pair statistics (an order-2 Markov chain)
 *   of the liked names and the person's example names, and small changes to
 *   the liked names (a vowel or consonant swapped, two names spliced).
 * - pairs: two liked names together ("Iron Patience", "Patience of Stone").
 *
 * The same request and seed give the same batch.
 */
import { mulberry32, weightedIndex, type Random } from '@malevo/core'
import type { Lexicon, LinkGroup, WordHit } from './lexicon'

export const NAME_SOURCES = ['words', 'sounds', 'pairs'] as const
export type NameSource = (typeof NAME_SOURCES)[number]

export interface BatchName {
  text: string
  source: NameSource
  /** How it was made, in people's terms. */
  from: string
}

export interface BatchNarrow {
  pos?: ('n' | 'v' | 'a' | 'r')[]
  categories?: string[]
  maxLetters?: number
  singleWords?: boolean
}

export interface BatchRequest {
  /** New names wanted. */
  count: number
  sources: NameSource[]
  seed: number
  concepts: { word: string; senses: string[] }[]
  links: LinkGroup[]
  depth: number
  defined: boolean
  narrow: BatchNarrow
  /** Names that sound right, written by the person: they seed the sounds. */
  examples: string[]
  /** Liked or locked in the batch just seen: they drive the next. */
  liked: string[]
  /** Liked in earlier batches: they count for less. */
  earlier: string[]
  /** Every name already shown, never shown again as new. */
  exclude: string[]
}

const VOWELS = 'aeiouy'
const isVowel = (c: string): boolean => VOWELS.includes(c)
const titleCase = (s: string): string => s.replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
const key = (s: string): string => s.trim().toLowerCase()

/** Passes the person's narrowing: part of speech, category, letters, single words. */
export function passesNarrow(w: WordHit, n: BatchNarrow): boolean {
  const pos = (p: string): string => (p === 's' ? 'a' : p)
  if (n.pos?.length && !w.senses.some((s) => n.pos!.includes(pos(s.pos) as 'n'))) return false
  if (n.categories?.length && !w.senses.some((s) => n.categories!.includes(s.category))) return false
  if (n.maxLetters && w.word.replace(/[^\p{L}]/gu, '').length > n.maxLetters) return false
  if (n.singleWords && /[\s-]/.test(w.word)) return false
  return true
}

/** Draws up to n items by weight, without replacement. */
function draw<T>(r: Random, items: { item: T; weight: number }[], n: number): T[] {
  const pool = items.filter((i) => i.weight > 0)
  const out: T[] = []
  while (out.length < n && pool.length) {
    const i = weightedIndex(
      r,
      pool.map((p) => p.weight)
    )
    out.push(pool[i].item)
    pool.splice(i, 1)
  }
  return out
}

function wordNames(lx: Lexicon, q: BatchRequest, r: Random, n: number, taken: Set<string>): BatchName[] {
  const fresh = (w: string): boolean => !taken.has(key(w))
  // The neighbourhood of the ticked senses.
  const active = q.concepts.filter((c) => c.senses.length)
  const base = active.length
    ? lx
        .explore({ concepts: active, links: q.links, depth: q.depth, defined: q.defined })
        .words.filter((w) => passesNarrow(w, q.narrow) && fresh(w.word))
    : []
  // The neighbourhood of liked words: one link out from every sense of each that the word list knows as it is spelled.
  const near = new Map<string, { word: string; weight: number; from: string }>()
  const around = (liked: string[], weight: number): void => {
    for (const word of liked) {
      const senses = lx
        .senses(word)
        .filter((s) => s.words.some((w) => key(w) === key(word)))
        .map((s) => s.id)
      if (!senses.length) continue
      const hits = lx.explore({ concepts: [{ word: titleCase(word), senses }], links: q.links, depth: 1, defined: false }).words
      for (const h of hits) {
        if (!passesNarrow(h, q.narrow) || !fresh(h.word)) continue
        const k = key(h.word)
        const prev = near.get(k)
        if (prev) prev.weight += weight
        else near.set(k, { word: h.word, weight, from: h.reached[0]?.path ?? word })
      }
    }
  }
  around(q.liked, 3)
  around(q.earlier, 1)
  const nNear = near.size ? Math.min(near.size, base.length ? Math.round(n * 0.7) : n) : 0
  const fromNear = draw(
    r,
    [...near.values()].map((v) => ({ item: v, weight: v.weight })),
    nNear
  )
  const used = new Set(fromNear.map((v) => key(v.word)))
  const fromBase = draw(
    r,
    base.filter((w) => !used.has(key(w.word))).map((w) => ({ item: w, weight: 1 })),
    n - fromNear.length
  )
  return [
    ...fromNear.map((v) => ({ text: titleCase(v.word), source: 'words' as const, from: `near what you liked: ${v.from}` })),
    ...fromBase.map((w) => ({ text: titleCase(w.word), source: 'words' as const, from: w.reached[0]?.path ?? w.word }))
  ]
}

/** Letters only, lower case: the material sounds are built from. */
const letters = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')

function soundNames(lx: Lexicon | null, q: BatchRequest, r: Random, n: number, taken: Set<string>): BatchName[] {
  const training: { text: string; weight: number }[] = []
  for (const s of q.liked) for (const w of s.split(/\s+/)) training.push({ text: letters(w), weight: 3 })
  for (const s of q.earlier) for (const w of s.split(/\s+/)) training.push({ text: letters(w), weight: 1 })
  for (const s of q.examples) for (const w of s.split(/\s+/)) training.push({ text: letters(w), weight: 2 })
  const own = training.filter((t) => t.text.length >= 3)
  const known = new Set(own.map((t) => t.text))
  const parents = own.length ? own : []
  // With too little to go on, the word list's own words fill in the letter statistics (lightly).
  const stats = [...own]
  if (own.length < 4 && lx) {
    const words = lx.data.words
    for (let i = 0; i < 400; i++) {
      const w = words[Math.floor(r() * words.length)][0]
      if (/^[a-z]{4,9}$/.test(w)) stats.push({ text: w, weight: 0.3 })
    }
  }
  if (!stats.length) return []
  // Order-2 letter chain: two letters of context, "^" pads the start, "$" ends.
  const chain = new Map<string, Map<string, number>>()
  for (const { text, weight } of stats) {
    const s = `^^${text}$`
    for (let i = 2; i < s.length; i++) {
      const ctx = s.slice(i - 2, i)
      const m = chain.get(ctx) ?? new Map<string, number>()
      m.set(s[i], (m.get(s[i]) ?? 0) + weight)
      chain.set(ctx, m)
    }
  }
  const walk = (): string | null => {
    let ctx = '^^'
    let out = ''
    while (out.length < 12) {
      const m = chain.get(ctx)
      if (!m) return null
      const keys = [...m.keys()]
      const c = keys[weightedIndex(r, [...m.values()])]
      if (c === '$') break
      out += c
      ctx = ctx[1] + c
    }
    return out.length >= 3 && out.length <= 11 ? out : null
  }
  const consonants = [...new Set((own.length ? own : stats).flatMap((t) => [...t.text].filter((c) => !isVowel(c))))]
  const mutate = (): { text: string; from: string } | null => {
    if (!parents.length) return null
    const a =
      parents[
        weightedIndex(
          r,
          parents.map((p) => p.weight)
        )
      ].text
    const op = r()
    if (op < 0.4 && parents.length > 1) {
      const others = parents.filter((p) => p.text !== a)
      if (!others.length) return null
      const b = others[Math.floor(r() * others.length)].text
      // Cut each after a vowel, keep the head of one and the tail of the other.
      const cuts = (s: string): number[] =>
        [...s].map((c, i) => (isVowel(c) && i > 0 && i < s.length - 1 ? i + 1 : -1)).filter((i) => i > 0)
      const ca = cuts(a)
      const cb = cuts(b)
      if (!ca.length || !cb.length) return null
      const head = a.slice(0, ca[Math.floor(r() * ca.length)])
      const tail = b.slice(cb[Math.floor(r() * cb.length)] - 1)
      return {
        text: head + tail.slice(isVowel(head[head.length - 1]) && isVowel(tail[0]) ? 1 : 0),
        from: `${titleCase(a)} × ${titleCase(b)}`
      }
    }
    const idx = [...a].map((_, i) => i)
    const vowelAt = idx.filter((i) => isVowel(a[i]))
    const consAt = idx.filter((i) => !isVowel(a[i]))
    if (op < 0.7 && vowelAt.length) {
      const i = vowelAt[Math.floor(r() * vowelAt.length)]
      const v = VOWELS.replace(a[i], '')[Math.floor(r() * (VOWELS.length - 1))]
      return { text: a.slice(0, i) + v + a.slice(i + 1), from: `${titleCase(a)}, a vowel changed` }
    }
    if (consAt.length && consonants.length > 1) {
      const i = consAt[Math.floor(r() * consAt.length)]
      const others = consonants.filter((c) => c !== a[i])
      const c = others[Math.floor(r() * others.length)]
      return { text: a.slice(0, i) + c + a.slice(i + 1), from: `${titleCase(a)}, a consonant changed` }
    }
    return null
  }
  const sample = own
    .slice()
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map((t) => titleCase(t.text))
  const chainFrom = sample.length ? `the letter patterns of ${sample.join(', ')}` : 'the letter patterns of the word list'
  const out: BatchName[] = []
  const seen = new Set<string>()
  for (let tries = 0; out.length < n && tries < n * 60; tries++) {
    const m = parents.length && r() < 0.5 ? mutate() : null
    const made = m ?? ((t) => (t ? { text: t, from: chainFrom } : null))(walk())
    if (!made || made.text.length < 3) continue
    if (known.has(made.text) || seen.has(made.text) || taken.has(made.text)) continue
    seen.add(made.text)
    out.push({ text: titleCase(made.text), source: 'sounds', from: made.from })
  }
  return out
}

function pairNames(q: BatchRequest, r: Random, n: number, taken: Set<string>): BatchName[] {
  const pool = [...q.liked.map((t) => ({ item: t, weight: 3 })), ...q.earlier.map((t) => ({ item: t, weight: 1 }))]
  const distinct = new Map(pool.map((p) => [key(p.item), p]))
  const items = [...distinct.values()]
  if (items.length < 2) return []
  const out: BatchName[] = []
  const used = new Set<string>()
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const [a, b] = draw(r, items, 2)
    const pattern = r()
    const text = pattern < 0.6 ? `${a} ${b}` : pattern < 0.85 ? `${a} of ${b}` : `The ${a} ${b}`
    const t = titleCase(text.replace(/\bOf\b/, 'of'))
      .replace(/ Of /g, ' of ')
      .trim()
    // One name per two liked names, whichever way round: no batch of the same pair in three patterns.
    const pairKey = [key(a), key(b)].sort().join('|')
    if (taken.has(key(t)) || used.has(pairKey)) continue
    used.add(pairKey)
    out.push({ text: t, source: 'pairs', from: `${a} + ${b}` })
  }
  return out
}

/**
 * The next batch of new names, shared out between the chosen sources in turn.
 * A source with nothing to go on (pairs with fewer than two liked names, words
 * without senses or a word list) gives its share to the others.
 */
export function nextBatch(lx: Lexicon | null, q: BatchRequest): BatchName[] {
  const r = mulberry32(q.seed)
  const taken = new Set([...q.exclude, ...q.liked, ...q.earlier].map(key))
  const want = Math.max(0, Math.round(q.count))
  const sources = NAME_SOURCES.filter((s) => q.sources.includes(s))
  const make = (s: NameSource, n: number): BatchName[] =>
    s === 'words' ? (lx ? wordNames(lx, q, r, n, taken) : []) : s === 'sounds' ? soundNames(lx, q, r, n, taken) : pairNames(q, r, n, taken)
  const out: BatchName[] = []
  // First a fair share each; then whatever is short, from whichever sources still have names.
  let remaining = sources.slice()
  while (out.length < want && remaining.length) {
    const share = Math.ceil((want - out.length) / remaining.length)
    const next: NameSource[] = []
    for (const s of remaining) {
      const got = make(s, Math.min(share, want - out.length)).filter((b) => !taken.has(key(b.text)))
      for (const b of got) taken.add(key(b.text))
      out.push(...got)
      if (got.length >= share) next.push(s)
      if (out.length >= want) break
    }
    if (next.length === remaining.length && out.length < want) continue
    remaining = next
  }
  // Interleave the sources, so a batch does not read as blocks.
  const by = sources.map((s) => out.filter((b) => b.source === s))
  const mixed: BatchName[] = []
  for (let i = 0; mixed.length < out.length; i++) for (const list of by) if (list[i]) mixed.push(list[i])
  return mixed.slice(0, want)
}
