/**
 * placeholder-names@1: pronounceable placeholder names, so freshly generated
 * stars, systems and settlements have something to be called until the
 * author names them.
 *
 * The syllable palettes and the name shape are the prototype's (story-thing
 * tools/star-map/settle.js `namer`): generic sound sets with no setting in
 * them. Unlike the prototype, which drew every name from one shared stream,
 * each id gets its own keyed stream, so adding an id never renames another.
 */
import { compareStrings, type Random } from '@malevo/core'
import { defineGenerator } from './generator'

export const PALETTES: readonly { on: readonly string[]; vo: readonly string[]; co: readonly string[] }[] = [
  {
    on: ['k', 't', 'r', 'v', 's', 'm', 'n', 'd', 'l', 'kh', 'zh', 'b'],
    vo: ['a', 'o', 'e', 'i', 'u', 'ai', 'ya'],
    co: ['', '', 'n', 'r', 's', 'k', 'v', 'sk']
  },
  {
    on: ['l', 'm', 'n', 's', 'th', 'f', 'h', 'w', 'r', 'c', 'v'],
    vo: ['e', 'i', 'a', 'ae', 'ia', 'o', 'y'],
    co: ['', '', 'n', 'l', 'th', 's', 'ne', 'll']
  },
  {
    on: ['b', 'd', 'g', 'p', 't', 'k', 'q', 'z', 'm', 'h'],
    vo: ['a', 'u', 'o', 'i', 'aa', 'uu', 'e'],
    co: ['', '', 'n', 'm', 'r', 'q', 'b']
  },
  { on: ['s', 'sh', 'ch', 'j', 'y', 'h', 'm', 'n', 'k', 't'], vo: ['a', 'i', 'o', 'e', 'ei', 'ou', 'u'], co: ['', '', '', 'n', 'ng'] },
  {
    on: ['br', 'cr', 'dr', 'f', 'g', 'st', 'p', 'c', 'h', 'w', 'b', 'm'],
    vo: ['a', 'e', 'i', 'o', 'ea', 'ow'],
    co: ['', 'ck', 'll', 'rn', 'ss', 'ton', 'ford', 'den', 'lin']
  },
  {
    on: ['p', 'r', 's', 'v', 'l', 'm', 'c', 't', 'n', 'qu'],
    vo: ['e', 'a', 'i', 'o', 'u', 'ei'],
    co: ['', 's', 'ris', 'n', 'ra', 'lla', 'to']
  },
  { on: ['x', 'tl', 'ts', 'k', 'w', 'y', 'm', 'n', 'p', 'h'], vo: ['a', 'e', 'i', 'o', 'ua'], co: ['', '', 'l', 'n', 'c', 'tl'] },
  { on: ['al', 'an', 'ar', 'z', 'r', 'n', 'm', 'h', 'f', 'd'], vo: ['a', 'i', 'u', 'aa', 'ei', 'e'], co: ['', '', 'r', 'n', 'm', 'h', 'd'] }
]

/** One name from a stream (behaves exactly like the prototype's namer). */
export function nameFrom(r: Random, palette: number): string {
  const P = PALETTES[((palette % PALETTES.length) + PALETTES.length) % PALETTES.length]
  const pk = (a: readonly string[]): string => a[Math.floor(r() * a.length)]
  const n = r() < 0.55 ? 2 : r() < 0.85 ? 3 : 1
  let s = ''
  for (let k = 0; k < n; k++) s += pk(P.on) + pk(P.vo) + (k === n - 1 || r() < 0.25 ? pk(P.co) : '')
  return s[0].toUpperCase() + s.slice(1)
}

export interface NamesInput {
  /** Entity ids to name. */
  ids: string[]
  /** Which sound palette (0–7); a culture would keep to one. */
  palette: number
}

export const placeholderNames = defineGenerator<NamesInput, Record<string, string>>({
  name: 'placeholder-names',
  version: 1,
  description: 'Pronounceable placeholder names from one of eight sound palettes, one keyed stream per id.',
  frozen: true,
  generate(input, ctx) {
    const out: Record<string, string> = {}
    for (const id of [...input.ids].sort(compareStrings)) out[id] = nameFrom(ctx.stream(id, 'name'), input.palette)
    return out
  }
})
