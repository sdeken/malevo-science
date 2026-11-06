import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  LINK_GROUP_NAMES,
  Lexicon,
  RATINGS,
  nextRound,
  type ExploreQuery,
  type ExploreResult,
  type LinkGroup,
  type NamePools,
  type PartOfSpeech,
  type Rating,
  type RoundName,
  type Sense
} from '@malevo/model'

/**
 * The Names tool's data: WordNet (scripts/build-wordnet.mjs) and given and
 * family names by language (scripts/build-names.mjs), packed into out/ beside
 * the app's code. Each is loaded on first use and kept.
 */
let lexicon: Lexicon | null | undefined
let pools: NamePools | null | undefined

function readJson<T>(rel: string): T | null {
  const file = path.join(__dirname, rel)
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
  } catch (err) {
    console.error(`[names] could not load ${rel}`, err)
    return null
  }
}

function lex(): Lexicon | null {
  if (lexicon === undefined) {
    const data = readJson<ConstructorParameters<typeof Lexicon>[0]>('../wordnet/wordnet.json')
    lexicon = data ? new Lexicon(data) : null
  }
  return lexicon
}

function namePools(): NamePools | null {
  if (pools === undefined) pools = readJson<NamePools>('../names/names.json')
  return pools
}

const MISSING = { error: 'The word list is missing from this build.' }
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : [])
const letters = (x: unknown): number | undefined => (Number(x) > 0 ? Math.round(Number(x)) : undefined)
const unit = (x: unknown, d: number): number => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : d)
const groups = (x: unknown): LinkGroup[] => strings(x).filter((g): g is LinkGroup => LINK_GROUP_NAMES.includes(g as LinkGroup))

export function lookUpSenses(word: unknown): { source: string; senses: Sense[] } | { error: string } {
  const lx = lex()
  if (!lx) return MISSING
  return { source: lx.source, senses: lx.senses(String(word ?? '')).slice(0, 80) }
}

export function exploreWords(q: unknown): ExploreResult | { error: string } {
  const lx = lex()
  if (!lx) return MISSING
  const v = (q ?? {}) as Record<string, unknown>
  const query: ExploreQuery = {
    concepts: (Array.isArray(v.concepts) ? v.concepts : []).map((c: { word?: unknown; senses?: unknown }) => ({
      word: String(c?.word ?? ''),
      senses: strings(c?.senses)
    })),
    links: groups(v.links),
    depth: Number(v.depth) || 1,
    defined: Boolean(v.defined)
  }
  return lx.explore(query)
}

/** The languages the sounds mode can draw names from. */
export function nameLocales():
  { source: string; locales: { id: string; label: string; given: number; family: number }[] } | { error: string } {
  const p = namePools()
  if (!p) return { error: 'The name lists are missing from this build.' }
  return {
    source: p.source,
    locales: p.locales.map((l) => ({ id: l.id, label: l.label, given: l.given.any.length, family: l.family.length }))
  }
}

export function namesRound(q: unknown): RoundName[] | { error: string } {
  const v = (q ?? {}) as Record<string, unknown>
  const w = (v.words ?? {}) as Record<string, unknown>
  const s = (v.sounds ?? {}) as Record<string, unknown>
  const mode = v.mode === 'sounds' ? 'sounds' : 'words'
  const lx = lex()
  if (mode === 'words' && !lx) return MISSING
  return nextRound(lx, namePools(), {
    mode,
    count: Math.min(50, Math.max(1, Number(v.count) || 10)),
    seed: Number(v.seed) >>> 0,
    focus: unit(v.focus, 0.6),
    words: {
      concepts: (Array.isArray(w.concepts) ? w.concepts : []).map((c: { word?: unknown; senses?: unknown }) => ({
        word: String(c?.word ?? ''),
        senses: strings(c?.senses)
      })),
      links: groups(w.links),
      depth: Math.max(1, Math.min(3, Number(w.depth) || 1)),
      defined: Boolean(w.defined),
      pos: strings(w.pos).filter((p): p is PartOfSpeech => ['n', 'v', 'a', 'r'].includes(p)),
      categories: strings(w.categories),
      minLetters: letters(w.minLetters),
      maxLetters: letters(w.maxLetters),
      singleWords: Boolean(w.singleWords),
      sound: unit(w.sound, 0)
    },
    sounds: {
      locales: strings(s.locales),
      given: s.given !== false,
      family: Boolean(s.family),
      gender: s.gender === 'female' || s.gender === 'male' ? s.gender : 'any',
      invented: unit(s.invented, 0.3),
      minLetters: letters(s.minLetters),
      maxLetters: letters(s.maxLetters)
    },
    rated: (Array.isArray(v.rated) ? v.rated : []).map((x: { text?: unknown; rating?: unknown }) => ({
      text: String(x?.text ?? ''),
      rating: (RATINGS as readonly string[]).includes(String(x?.rating)) ? (x.rating as Rating) : 'neutral'
    }))
  })
}
