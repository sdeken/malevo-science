import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { LINK_GROUP_NAMES, Lexicon, type ExploreQuery, type ExploreResult, type LinkGroup, type Sense } from '@malevo/model'

/**
 * The Names tool's word list: WordNet, packed by scripts/build-wordnet.mjs
 * into out/wordnet beside the app's code. Loaded on first use and kept.
 */
let lexicon: Lexicon | null | undefined

function load(): Lexicon | null {
  if (lexicon !== undefined) return lexicon
  const file = path.join(__dirname, '../wordnet/wordnet.json')
  try {
    lexicon = existsSync(file) ? new Lexicon(JSON.parse(readFileSync(file, 'utf8'))) : null
  } catch (err) {
    console.error('[names] could not load the word list', err)
    lexicon = null
  }
  return lexicon
}

const MISSING = { error: 'The word list is missing from this build.' }

export function lexiconSource(): string | null {
  return load()?.source ?? null
}

export function lookUpSenses(word: unknown): { source: string; senses: Sense[] } | { error: string } {
  const lx = load()
  if (!lx) return MISSING
  return { source: lx.source, senses: lx.senses(String(word ?? '')).slice(0, 80) }
}

export function exploreWords(q: unknown): ExploreResult | { error: string } {
  const lx = load()
  if (!lx) return MISSING
  const v = (q ?? {}) as Record<string, unknown>
  const query: ExploreQuery = {
    concepts: (Array.isArray(v.concepts) ? v.concepts : []).map((c: { word?: unknown; senses?: unknown }) => ({
      word: String(c?.word ?? ''),
      senses: Array.isArray(c?.senses) ? c.senses.map(String) : []
    })),
    links: (Array.isArray(v.links) ? v.links : []).filter((g): g is LinkGroup => LINK_GROUP_NAMES.includes(g as LinkGroup)),
    depth: Number(v.depth) || 1,
    defined: Boolean(v.defined)
  }
  return lx.explore(query)
}
