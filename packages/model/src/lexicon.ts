/**
 * A word list for brainstorming names: WordNet, packed into one file at build
 * time (scripts/build-wordnet.mjs) and explored here by plain lexical links.
 *
 * Nothing here judges a word. Exploring follows the links the person ticks
 * (synonyms, similar, broader, narrower, ...) from the senses they chose, and
 * reports how each word was reached; ordering is alphabetical or by the
 * number of links walked, never by any notion of a good name.
 */
import { compareStrings } from '@malevo/core'

/** WordNet's lexicographer files, by number: the broad category of each sense. */
export const LEX_FILES = [
  'adj.all',
  'adj.pert',
  'adv.all',
  'noun.Tops',
  'noun.act',
  'noun.animal',
  'noun.artifact',
  'noun.attribute',
  'noun.body',
  'noun.cognition',
  'noun.communication',
  'noun.event',
  'noun.feeling',
  'noun.food',
  'noun.group',
  'noun.location',
  'noun.motive',
  'noun.object',
  'noun.person',
  'noun.phenomenon',
  'noun.plant',
  'noun.possession',
  'noun.process',
  'noun.quantity',
  'noun.relation',
  'noun.shape',
  'noun.state',
  'noun.substance',
  'noun.time',
  'verb.body',
  'verb.change',
  'verb.cognition',
  'verb.communication',
  'verb.competition',
  'verb.consumption',
  'verb.contact',
  'verb.creation',
  'verb.emotion',
  'verb.motion',
  'verb.perception',
  'verb.possession',
  'verb.social',
  'verb.stative',
  'verb.weather',
  'adj.ppl'
] as const

/** WordNet's pointer symbols, in the order the packed file numbers them, with a name for people. */
export const LINKS: readonly { symbol: string; name: string }[] = [
  { symbol: '!', name: 'opposite' },
  { symbol: '@', name: 'broader' },
  { symbol: '@i', name: 'instance of' },
  { symbol: '~', name: 'narrower' },
  { symbol: '~i', name: 'instance' },
  { symbol: '#m', name: 'member of' },
  { symbol: '#s', name: 'substance of' },
  { symbol: '#p', name: 'part of' },
  { symbol: '%m', name: 'has member' },
  { symbol: '%s', name: 'made of' },
  { symbol: '%p', name: 'has part' },
  { symbol: '=', name: 'attribute' },
  { symbol: '+', name: 'derived' },
  { symbol: ';c', name: 'topic' },
  { symbol: '-c', name: 'in topic' },
  { symbol: ';r', name: 'region' },
  { symbol: '-r', name: 'in region' },
  { symbol: ';u', name: 'usage' },
  { symbol: '-u', name: 'in usage' },
  { symbol: '*', name: 'entails' },
  { symbol: '>', name: 'causes' },
  { symbol: '^', name: 'see also' },
  { symbol: '$', name: 'verb group' },
  { symbol: '&', name: 'similar' },
  { symbol: '<', name: 'participle of' },
  { symbol: '\\', name: 'pertains to' }
]

/** The kinds of link a person can tick when exploring, each a set of WordNet pointers. */
export const LINK_GROUPS = {
  similar: ['&', '^', '$', '=', '<', '\\'],
  derived: ['+'],
  broader: ['@', '@i'],
  narrower: ['~', '~i'],
  parts: ['#m', '#s', '#p', '%m', '%s', '%p'],
  topic: [';c', '-c', ';r', '-r', ';u', '-u'],
  opposite: ['!'],
  cause: ['*', '>']
} as const satisfies Record<string, readonly string[]>
export type LinkGroup = keyof typeof LINK_GROUPS
export const LINK_GROUP_NAMES = Object.keys(LINK_GROUPS) as LinkGroup[]

export type SensePos = 'n' | 'v' | 'a' | 's' | 'r'

/** The packed file: one column per field, one entry per synset. */
export interface PackedLexicon {
  format: 1
  /** "WordNet 3.1". */
  source: string
  /** One character per synset: n, v, a, s (adjective satellite) or r. */
  pos: string
  /** WordNet's own synset offsets, so a sense id ("01196329-s") is stable for this source. */
  offset: number[]
  /** Index into LEX_FILES. */
  lex: number[]
  /** Words in the synset, spaces for underscores, as WordNet spells them. */
  words: string[][]
  gloss: string[]
  /** Flat pairs: [link index into LINKS, target synset, ...]. */
  links: number[][]
}

const LINK_INDEX = new Map(LINKS.map((l, i) => [l.symbol, i]))

/**
 * Parses WordNet's data files (data.noun, data.verb, data.adj, data.adv) into
 * the packed form. Licence lines (those starting with spaces) are skipped.
 */
export function packWordNet(files: { noun: string; verb: string; adj: string; adv: string }, source: string): PackedLexicon {
  interface Raw {
    pos: SensePos
    offset: number
    lex: number
    words: string[]
    gloss: string
    links: [number, string][]
  }
  const raws: Raw[] = []
  const fileKey = (pos: string): string => (pos === 's' ? 'a' : pos)
  for (const [file, text] of [
    ['n', files.noun],
    ['v', files.verb],
    ['a', files.adj],
    ['r', files.adv]
  ] as const) {
    for (const line of text.split('\n')) {
      if (!line || line.startsWith(' ')) continue
      const bar = line.indexOf(' | ')
      const head = (bar >= 0 ? line.slice(0, bar) : line).trim().split(' ')
      const gloss = bar >= 0 ? line.slice(bar + 3).trim() : ''
      const offset = Number(head[0])
      const lex = Number(head[1])
      const pos = head[2] as SensePos
      const count = parseInt(head[3], 16)
      let i = 4
      const words: string[] = []
      for (let w = 0; w < count; w++, i += 2) words.push(head[i].replace(/\((a|p|ip)\)$/, '').replace(/_/g, ' '))
      const pcount = Number(head[i++])
      const links: [number, string][] = []
      for (let p = 0; p < pcount; p++, i += 4) {
        const k = LINK_INDEX.get(head[i])
        if (k !== undefined) links.push([k, `${fileKey(head[i + 2])}${head[i + 1]}`])
      }
      if (fileKey(pos) !== file) continue
      raws.push({ pos, offset, lex, words, gloss, links })
    }
  }
  const indexOf = new Map(raws.map((r, i) => [`${fileKey(r.pos)}${String(r.offset).padStart(8, '0')}`, i]))
  return {
    format: 1,
    source,
    pos: raws.map((r) => r.pos).join(''),
    offset: raws.map((r) => r.offset),
    lex: raws.map((r) => r.lex),
    words: raws.map((r) => r.words),
    gloss: raws.map((r) => r.gloss),
    links: raws.map((r) => r.links.flatMap(([k, key]) => (indexOf.has(key) ? [k, indexOf.get(key)!] : [])))
  }
}

/** A sense as tools and files see it. */
export interface Sense {
  /** Stable for the lexicon's source: offset and part of speech, "01196329-s". */
  id: string
  pos: SensePos
  category: string
  words: string[]
  gloss: string
}

/** How one word was reached from one concept: the links walked, from the chosen sense. */
export interface Reach {
  concept: number
  steps: number
  /** "slow → similar → sluggish", in people's terms. */
  path: string
}

export interface WordHit {
  word: string
  /** One per concept that reaches it: the shortest way there. */
  reached: Reach[]
  /** The senses of this word that were reached. */
  senses: Sense[]
}

export interface ExploreQuery {
  /** Each concept is a word the person looked up and the sense ids they ticked for it. */
  concepts: { word: string; senses: string[] }[]
  links: LinkGroup[]
  /** Links to walk from each chosen sense, 1 to 3. */
  depth: number
  /** Also take senses whose definition uses the looked-up word or its base form (one step, not walked further). */
  defined: boolean
}

export interface ExploreResult {
  words: WordHit[]
  /** Concepts whose neighbourhood hit the cap and was cut short. */
  capped: number[]
}

const CAP = 6000

const MORPH: Record<'n' | 'v' | 'a', [string, string][]> = {
  n: [
    ['s', ''],
    ['ses', 's'],
    ['xes', 'x'],
    ['zes', 'z'],
    ['ches', 'ch'],
    ['shes', 'sh'],
    ['men', 'man'],
    ['ies', 'y']
  ],
  v: [
    ['s', ''],
    ['ies', 'y'],
    ['es', 'e'],
    ['es', ''],
    ['ed', 'e'],
    ['ed', ''],
    ['ing', 'e'],
    ['ing', '']
  ],
  a: [
    ['er', ''],
    ['est', ''],
    ['er', 'e'],
    ['est', 'e']
  ]
}

const posGroup = (p: string): 'n' | 'v' | 'a' | 'r' => (p === 's' ? 'a' : (p as 'n' | 'v' | 'a' | 'r'))

export class Lexicon {
  private readonly byLemma = new Map<string, number[]>()
  private readonly byId = new Map<string, number>()
  private glossIndex: Map<string, number[]> | null = null
  /** Links WordNet keeps one way only, turned round: "pertains to" (an adverb to its adjective), found from the adjective. */
  private readonly reverse = new Map<number, number[]>()

  constructor(readonly data: PackedLexicon) {
    const pertains = LINK_INDEX.get('\\')!
    for (let i = 0; i < data.links.length; i++) {
      const l = data.links[i]
      for (let k = 0; k < l.length; k += 2) {
        if (l[k] !== pertains) continue
        const list = this.reverse.get(l[k + 1]) ?? []
        list.push(pertains, i)
        this.reverse.set(l[k + 1], list)
      }
    }
    for (let i = 0; i < data.words.length; i++) {
      this.byId.set(this.idOf(i), i)
      for (const w of data.words[i]) {
        const key = w.toLowerCase()
        const list = this.byLemma.get(key)
        if (list) list.push(i)
        else this.byLemma.set(key, [i])
      }
    }
  }

  /** A synset's links, as flat [link, target] pairs, including the turned-round ones. */
  linksOf(i: number): number[] {
    const extra = this.reverse.get(i)
    return extra ? [...this.data.links[i], ...extra] : this.data.links[i]
  }

  get size(): number {
    return this.data.words.length
  }

  /** Synsets holding exactly this word (no base forms). */
  synsetsOf(word: string): number[] {
    return this.byLemma.get(word.trim().toLowerCase()) ?? []
  }

  /** Synset index for a sense id, if the lexicon has it. */
  indexOf(id: string): number | undefined {
    return this.byId.get(id)
  }

  /** Synsets reachable from these within `depth` links of the given kinds, with the links walked to each. */
  neighbourhood(start: number[], groups: readonly LinkGroup[], depth: number, cap = CAP): Map<number, number> {
    const allowed = new Set(groups.flatMap((g) => LINK_GROUPS[g] ?? []).map((s) => LINK_INDEX.get(s)!))
    const steps = new Map<number, number>()
    for (const s of start) steps.set(s, 0)
    let frontier = start
    for (let step = 1; step <= depth && frontier.length && steps.size <= cap; step++) {
      const next: number[] = []
      for (const s of frontier) {
        const links = this.linksOf(s)
        for (let k = 0; k < links.length; k += 2) {
          if (!allowed.has(links[k]) || steps.has(links[k + 1])) continue
          steps.set(links[k + 1], step)
          next.push(links[k + 1])
        }
      }
      frontier = next
    }
    return steps
  }

  /**
   * Synsets whose definition uses a looked-up word (or its base form) as it appears in the senses it was
   * looked up for: "sloth: slow-moving arboreal mammals" for "slow".
   */
  definedUsing(word: string, start: number[]): number[] {
    const inSenses = new Set(start.flatMap((s) => this.data.words[s].map((w) => w.toLowerCase())))
    const forms = [word.toLowerCase(), ...this.lemmas(word).map((l) => l.lemma)].filter((w) => w && !w.includes(' ') && inSenses.has(w))
    return [...new Set(forms.flatMap((f) => this.glossHits(f)))]
  }

  get source(): string {
    return this.data.source
  }

  private idOf(i: number): string {
    return `${String(this.data.offset[i]).padStart(8, '0')}-${this.data.pos[i]}`
  }

  sense(i: number): Sense {
    return {
      id: this.idOf(i),
      pos: this.data.pos[i] as SensePos,
      category: LEX_FILES[this.data.lex[i]] ?? 'unknown',
      words: this.data.words[i],
      gloss: this.data.gloss[i]
    }
  }

  /** Base forms of a word that the lexicon knows, by WordNet's detachment rules, with the word itself first. */
  private lemmas(word: string): { lemma: string; pos: string | null }[] {
    const w = word.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
    const out: { lemma: string; pos: string | null }[] = []
    if (this.byLemma.has(w)) out.push({ lemma: w, pos: null })
    for (const [pos, rules] of Object.entries(MORPH)) {
      for (const [suffix, ending] of rules) {
        if (!w.endsWith(suffix) || w.length <= suffix.length) continue
        const base = w.slice(0, -suffix.length) + ending
        if (base !== w && this.byLemma.has(base)) out.push({ lemma: base, pos })
        // running → run, bigger → big
        if (ending === '' && /([b-df-hj-np-tv-z])\1$/.test(base)) {
          const single = base.slice(0, -1)
          if (this.byLemma.has(single)) out.push({ lemma: single, pos })
        }
      }
    }
    return out
  }

  /** Every sense of a word (or of its base form), in WordNet's order within each part of speech. */
  senses(word: string): Sense[] {
    const seen = new Set<number>()
    const out: Sense[] = []
    for (const { lemma, pos } of this.lemmas(word)) {
      for (const i of this.byLemma.get(lemma) ?? []) {
        if (seen.has(i) || (pos && posGroup(this.data.pos[i]) !== pos)) continue
        seen.add(i)
        out.push(this.sense(i))
      }
    }
    return out
  }

  private glossHits(token: string): number[] {
    if (!this.glossIndex) {
      const index = new Map<string, number[]>()
      const forms = new Map<string, string[]>()
      const formsOf = (t: string): string[] => {
        let f = forms.get(t)
        if (!f) forms.set(t, (f = [t, ...t.split('-'), ...this.lemmas(t).map((l) => l.lemma)]))
        return f
      }
      for (let i = 0; i < this.data.gloss.length; i++) {
        // The definition only, not the quoted examples.
        const def = this.data.gloss[i].split(/;\s*"/)[0].toLowerCase()
        const tokens = new Set<string>()
        for (const t of def.match(/[a-z]+(?:-[a-z]+)*/g) ?? []) for (const f of formsOf(t)) tokens.add(f)
        for (const t of tokens) {
          const list = index.get(t)
          if (list) list.push(i)
          else index.set(t, [i])
        }
      }
      this.glossIndex = index
    }
    return this.glossIndex.get(token) ?? []
  }

  /**
   * Walks the ticked links out from each concept's chosen senses and gathers
   * every word reached, with the shortest path from each concept. Words are
   * returned alphabetically; narrowing (all concepts or any, part of speech,
   * category, length) is left to the caller.
   */
  explore(q: ExploreQuery): ExploreResult {
    const allowed = new Set(q.links.flatMap((g) => LINK_GROUPS[g] ?? []).map((s) => LINK_INDEX.get(s)!))
    const depth = Math.max(1, Math.min(3, Math.round(q.depth)))
    const capped: number[] = []
    // word key -> hit under construction
    const hits = new Map<string, { word: string; reached: Map<number, Reach>; senses: Map<number, Sense> }>()

    q.concepts.forEach(({ word: conceptWord, senses: ids }, c) => {
      const start = ids.map((id) => this.byId.get(id)).filter((i): i is number => i !== undefined)
      if (!start.length) return
      // synset -> how it was reached
      const via = new Map<number, { steps: number; from: number; link: string }>()
      for (const s of start) via.set(s, { steps: 0, from: -1, link: '' })
      let frontier = start
      for (let step = 1; step <= depth && frontier.length; step++) {
        const next: number[] = []
        for (const s of frontier) {
          const links = this.linksOf(s)
          for (let k = 0; k < links.length; k += 2) {
            if (!allowed.has(links[k])) continue
            const t = links[k + 1]
            if (via.has(t)) continue
            via.set(t, { steps: step, from: s, link: LINKS[links[k]].name })
            next.push(t)
          }
        }
        frontier = next
        if (via.size > CAP) {
          capped.push(c)
          break
        }
      }
      if (q.defined) {
        // The word as looked up (or its base form) as it appears in the ticked senses: not every synonym,
        // which would bring in every definition that says "heavy" when the word was "lumbering", nor a base
        // form from another sense ("lumber" the timber).
        const inSenses = new Set(start.flatMap((s) => this.data.words[s].map((w) => w.toLowerCase())))
        const forms = new Set(
          [conceptWord.toLowerCase(), ...this.lemmas(conceptWord).map((l) => l.lemma)].filter(
            (w) => w && !w.includes(' ') && inSenses.has(w)
          )
        )
        for (const w of forms) {
          for (const t of this.glossHits(w)) {
            if (!via.has(t)) via.set(t, { steps: 1, from: start[0], link: `defined using “${w}”` })
          }
        }
      }
      const pathTo = (s: number): string => {
        const parts: string[] = []
        let cur = s
        while (cur >= 0) {
          const v = via.get(cur)!
          parts.unshift(v.from < 0 ? conceptWord : this.data.words[cur][0])
          if (v.from < 0) break
          parts.unshift(v.link)
          cur = v.from
        }
        return parts.join(' → ')
      }
      for (const [s, v] of via) {
        for (const word of this.data.words[s]) {
          const key = word.toLowerCase()
          let hit = hits.get(key)
          if (!hit) hits.set(key, (hit = { word, reached: new Map(), senses: new Map() }))
          hit.senses.set(s, this.sense(s))
          const prev = hit.reached.get(c)
          if (!prev || v.steps < prev.steps) hit.reached.set(c, { concept: c, steps: v.steps, path: pathTo(s) })
        }
      }
    })

    const words = [...hits.values()]
      .map((h) => ({
        word: h.word,
        reached: [...h.reached.values()].sort((a, b) => a.concept - b.concept),
        senses: [...h.senses.values()]
      }))
      .sort((a, b) => compareStrings(a.word.toLowerCase(), b.word.toLowerCase()) || compareStrings(a.word, b.word))
    return { words, capped }
  }
}
