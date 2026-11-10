/**
 * history@1: a settlement history played out on the stars (docs/PLAN.md §7.3).
 *
 * The mechanics are the prototype's (story-thing tools/star-map/settle.js),
 * with everything particular to one story taken out. Which events unlock
 * slow ships and the foam drive, where it starts, which cultures found
 * enclaves, which polities exist and the share of systems each aims for: all
 * of it comes in as input. Nothing here names a place, a people or a power.
 *
 * - The slow-ship era: a few colonies at the nearest stars, each starting a
 *   regional culture of its own.
 * - The foam era: settled systems found new ones up to `legs` legs out,
 *   preferring sun-like stars and pushing outward, with outposts at the
 *   stops between. A colony inherits its parent's culture mix, or is founded
 *   as an enclave of a belief culture, or (far from its culture's home)
 *   branches into a new regional culture.
 * - Every step, cultures blend along lanes; enclaves resist.
 * - When the polities form, each takes the systems nearest its capital,
 *   weighted until the shares come out as asked. A polity can pull its
 *   systems toward one culture.
 * - Fixed facts (systems already settled at a date, capitals, a system's
 *   polity or culture) are honoured; what cannot be honoured is reported.
 *
 * Times are years on any consistent scale. A history is path-dependent, so
 * the run draws from one stream; names come from per-star streams, so a
 * system keeps its name as long as it is settled at all.
 */
import { compareStrings, segmentHitsEllipsoid, type Ellipsoid, type Point3, type Random } from '@malevo/core'
import { defineGenerator, type GenContext } from './generator'
import { nameFrom } from './names'

export interface HistoryStar {
  id: string
  pos: [number, number, number]
  /** Spectral class letter: O B A F G K M D, or X for a star off the main sequence (never settled). */
  cls: string
  /** A proper name, if the star has one worth using. */
  name: string | null
}

export interface FixedSettlement {
  star: string
  /** Settled in this year (by the author, or accepted from an earlier run). Null: settle it, when the run gets there. */
  year: number | null
  polity?: string | null
  /** Culture key → share. */
  mix?: Record<string, number> | null
  /** The system's name, if it has one. */
  name?: string
}

export interface HistoryInput {
  stars: HistoryStar[]
  origin: string
  /** The culture the origin starts with (an existing culture's key). */
  originCulture: string
  /** Palettes of existing cultures, for naming. */
  palettes: Record<string, number>
  legLimit: number
  nebulae: Ellipsoid[]
  years: { slow: number; foam: number; end: number; polities: number | null }
  step: number
  slow: { reach: number; colonies: number }
  growth: { total: number; maxRadius: number; outward: number; legs: number }
  culture: { enclave: number; split: number; splitDistance: number; blend: number }
  enclaves: { culture: string; from: number }[]
  polities: { key: string; share: number; capital: string | null; unify: number }[]
  fixed: FixedSettlement[]
  /** history@2 only: polities that come about by expansion or by federation, breakaways, and minor polities. */
  founding?: FoundingInput
}

/**
 * How polities come about (history@2).
 *
 * - `expand`: founded at its capital at a date; every colony its systems seed is its own, and it pulls its
 *   systems' cultures toward its overall mix.
 * - `federate`: formed at a date by the independent systems that broke away from an expanding polity (and
 *   their colonies, and minor polities they formed); it rarely founds colonies itself, and grows by
 *   independent systems and minor polities next to it applying to join.
 * - Breakaways: now and then a system far from an expanding polity's capital breaks away, with the colonies
 *   it founded.
 * - Minor polities: independent systems now and then organize, with their independent neighbours, into a
 *   small polity of their own.
 */
export interface FoundingInput {
  polities: FoundingPolity[]
  breakaway: { rate: number; distance: number; minAge: number }
  minor: { rate: number; size: number; minAge: number; max: number }
}

export interface FoundingPolity {
  key: string
  name: string
  mode: 'expand' | 'federate'
  /** The year it is founded (expand) or formed (federate). */
  from: number
  /** Its capital's star, if fixed. An expanding polity without one starts at the origin. */
  capital: string | null
  /** Expand: how fast it pulls its systems toward its overall culture mix, per decade (0–1). */
  unify: number
  /** Expand: how much more readily its systems found colonies than others do (1: no more). */
  vigor: number
  /** Federate: the chance a colony one of its systems founds stays in it (the rest are independent). */
  direct: number
  /**
   * Federate: who may join, and how often. A system (or a minor polity, as a whole) applies when it is within
   * `legs` legs of a member, has stood `minAge` years, and shares at least `similarity` (0–1) of its culture
   * mix with the federation's; each qualifying applicant joins with chance `rate` per decade.
   */
  join: { rate: number; minAge: number; similarity: number; legs: number }
}

export interface HistoryPolityChange {
  year: number
  polity: string | null
  mix: Record<string, number>
  why: 'founded' | 'founding' | 'breakaway' | 'minor' | 'federation' | 'joined' | 'fixed'
}

export interface HistoryPolity {
  key: string
  name: string
  /** Null for a polity of the world (it has its own). */
  color: string | null
  minor: boolean
  founded: number | null
  capital: string | null
  /** The year it was absorbed into another, if it was. */
  dissolved: number | null
  /** Systems it holds at the end. */
  systems: number
}

export interface HistorySystem {
  star: string
  name: string
  founded: number
  parent: string | null
  outpost: boolean
  /** Settled by a fixed fact rather than by the run. */
  fixed: boolean
  mixFounded: Record<string, number>
  polity: string | null
  politySince: number | null
  mixAtPolities: Record<string, number> | null
  mixAtEnd: Record<string, number>
  /** history@2: every change of polity, in order. */
  changes?: HistoryPolityChange[]
}

export interface HistoryCulture {
  key: string
  name: string
  palette: number
  color: string
  founded: number
  parent: string | null
  /** Where it began. */
  home: string
}

export interface HistoryOutput {
  systems: HistorySystem[]
  cultures: HistoryCulture[]
  /** Chains of stars. `slow` lanes are sublight links from before the foam drive, not bound by the leg limit. */
  lanes: { stars: string[]; opened: number; slow: boolean }[]
  events: { year: number; text: string; star: string | null }[]
  capitals: Record<string, string>
  shares: Record<string, { target: number; actual: number }>
  conflicts: string[]
  /** history@2 with founding: the polities of the run, the world's and the minor ones it made. */
  polities?: HistoryPolity[]
}

/** X: off the main sequence (a giant), never settled. */
const CLASS_WEIGHT: Record<string, number> = { G: 1, K: 1, F: 0.8, M: 0.35, A: 0.45, B: 0.15, D: 0.05, X: 0 }
const SLOW_WEIGHT: Record<string, number> = { G: 4, K: 3, F: 2, A: 1.2, M: 1, X: 0 }
/** Catalogue designations, which make poor names for a world. */
const CATALOG_NAME =
  /^(HIP|HD|HR|GJ|Gl|Gliese|LHS|LP|LTT|BD|CD|CPD|G\s|L\s|SAO|TYC|NLTT|LFT|Ross|Wolf|Struve|Kapteyn|Lacaille|Lalande|Luyten|Van|Kruger|Groombridge|Stein|EZ|EV|AD|YZ|DX|V\d|[A-Z]{2}\s)/

function pickWeighted(r: Random, w: readonly number[]): number {
  let tot = 0
  for (const x of w) tot += x
  if (!(tot > 0)) return -1
  let u = r() * tot
  for (let k = 0; k < w.length; k++) {
    u -= w[k]
    if (u <= 0) return k
  }
  return w.length - 1
}

function hsl(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return (
    '#' +
    [f(0), f(8), f(4)]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

type Mix = Map<string, number>

interface Sys {
  i: number
  founded: number
  parent: number | null
  outpost: boolean
  fixed: boolean
  mix: Mix
  mixFounded: Mix
  mixAtPolities: Mix | null
  polity: string | null
  politySince: number | null
  /** Polity fixed by the author: a key, or null for none; undefined when free. */
  fixedPolity?: string | null
  exhausted: boolean
  name?: string
  /** history@2: descended from a breakaway, with no expanding polity since. */
  free?: boolean
  changes?: HistoryPolityChange[]
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4
const mixRecord = (m: Mix): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const k of [...m.keys()].sort(compareStrings)) if (m.get(k)! > 0) out[k] = round4(m.get(k)!)
  return out
}

export const history = defineGenerator<HistoryInput, HistoryOutput>({
  name: 'history',
  version: 1,
  description: 'A settlement history on the stars: slow ships, then the foam; cultures, enclaves and polity borders',
  frozen: true,
  generate: (inp, ctx) => run(inp, ctx, 1)
})

export const history2 = defineGenerator<HistoryInput, HistoryOutput>({
  name: 'history',
  version: 2,
  description: 'history@1, with polities that expand from a capital or federate from breakaways and take in applicants, and minor polities',
  frozen: true,
  generate: (inp, ctx) => run(inp, ctx, 2)
})

const FORMS = ['League', 'Compact', 'Union', 'Republic', 'Concord', 'Assembly', 'Commonwealth', 'Accord']

function run(inp: HistoryInput, ctx: GenContext, version: 1 | 2): HistoryOutput {
  {
    const r = ctx.stream('run', inp.origin)
    // history@2's polities draw from a stream of their own, so the settlement itself is history@1's.
    const F = version >= 2 ? (inp.founding ?? null) : null
    const rp = ctx.stream('polities', inp.origin)
    const st = [...inp.stars].sort((a, b) => compareStrings(a.id, b.id))
    const index = new Map(st.map((s, i) => [s.id, i]))
    const origin = index.get(inp.origin)
    const conflicts: string[] = []
    const events: HistoryOutput['events'] = []
    const ev = (year: number, text: string, star: number | null = null): void => {
      events.push({ year: Math.round(year * 100) / 100, text, star: star === null ? null : st[star].id })
    }
    if (origin === undefined) {
      return {
        systems: [],
        cultures: [],
        lanes: [],
        events: [],
        capitals: {},
        shares: {},
        conflicts: ['The origin star is not among the stars.']
      }
    }
    const L = inp.legLimit
    const pos = (i: number): Point3 => st[i].pos
    const dist = (i: number, j: number): number =>
      Math.hypot(st[i].pos[0] - st[j].pos[0], st[i].pos[1] - st[j].pos[1], st[i].pos[2] - st[j].pos[2])
    const dO = (i: number): number => dist(i, origin)
    const clear = (i: number, j: number): boolean => !inp.nebulae.some((n) => segmentHitsEllipsoid(pos(i), pos(j), n))

    // A grid with cells one leg across.
    const grid = new Map<string, number[]>()
    const cellOf = (p: Point3): [number, number, number] => [Math.floor(p[0] / L), Math.floor(p[1] / L), Math.floor(p[2] / L)]
    st.forEach((s, i) => {
      const k = cellOf(s.pos).join(',')
      let c = grid.get(k)
      if (!c) grid.set(k, (c = []))
      c.push(i)
    })
    const near = (p: Point3, radius: number, fn: (j: number) => void): void => {
      const [cx, cy, cz] = cellOf(p)
      const n = Math.ceil(radius / L)
      for (let x = cx - n; x <= cx + n; x++)
        for (let y = cy - n; y <= cy + n; y++)
          for (let z = cz - n; z <= cz + n; z++)
            for (const j of grid.get(`${x},${y},${z}`) ?? []) {
              const s = st[j].pos
              if (Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]) <= radius) fn(j)
            }
    }

    // ---- cultures ----
    const cultures: HistoryCulture[] = []
    const kind = new Map<string, 'regional' | 'enclave'>()
    const palette = new Map<string, number>(Object.entries(inp.palettes))
    const home = new Map<string, number>()
    kind.set(inp.originCulture, 'regional')
    for (const e of inp.enclaves) kind.set(e.culture, 'enclave')
    let hue = r() * 360
    const MAX_CULTURES = 48
    const regional = (parent: string | null, year: number, where: number): string | null => {
      if (cultures.length >= MAX_CULTURES) return null
      const pal = parent !== null ? (palette.get(parent) ?? 0) : Math.floor(r() * 8)
      const n = cultures.length
      const base = nameFrom(ctx.stream(`culture-${n}`, 'name'), pal)
      const name = base + (/[aeiouy]$/.test(base) ? 'n' : 'i')
      let key = `gen-${name.toLowerCase().replace(/[^a-z]+/g, '')}`
      while (kind.has(key)) key += '-x'
      hue = (hue + 137.508) % 360
      cultures.push({ key, name, palette: pal, color: hsl(hue, 55, 60), founded: round4(year), parent, home: st[where].id })
      kind.set(key, 'regional')
      palette.set(key, pal)
      home.set(key, where)
      return key
    }
    home.set(inp.originCulture, origin)

    // ---- systems ----
    const sys: Sys[] = []
    const at = new Map<number, number>()
    const blocked = new Set<number>()
    const lanes: { nodes: number[]; opened: number }[] = []
    const settle = (i: number, year: number, parent: number | null, mix: Mix, extra: Partial<Sys> = {}): number => {
      const k = sys.length
      sys.push({
        i,
        founded: year,
        parent,
        outpost: false,
        fixed: false,
        mix: new Map(mix),
        mixFounded: new Map(mix),
        mixAtPolities: null,
        polity: null,
        politySince: null,
        exhausted: false,
        ...extra
      })
      at.set(i, k)
      blocked.add(i)
      // Companions in the same system.
      near(pos(i), 0.8, (j) => {
        if (dist(i, j) < 0.8) blocked.add(j)
      })
      return k
    }
    const one = (c: string): Mix => new Map([[c, 1]])
    const dominant = (m: Mix): string => {
      let best = ''
      let v = -1
      for (const [k, x] of [...m.entries()].sort((a, b) => compareStrings(a[0], b[0])))
        if (x > v) {
          v = x
          best = k
        }
      return best
    }
    const addLane = (nodes: number[], year: number): void => {
      lanes.push({ nodes, opened: year })
    }
    /** history@2: a system changes polity (null: independent). */
    const setPolity = (k: number, key: string | null, year: number, why: HistoryPolityChange['why']): void => {
      const s = sys[k]
      // Within a step, a colony founded part way through cannot change before it exists.
      year = Math.max(year, s.founded)
      s.polity = key
      s.politySince = key === null ? null : year
      if (key !== null && !s.mixAtPolities) s.mixAtPolities = new Map(s.mix)
      ;(s.changes ??= []).push({ year: round4(year), polity: key, mix: mixRecord(s.mix), why })
    }
    const foundingOf = new Map((F?.polities ?? []).map((p) => [p.key, p]))
    const minorPolities = new Map<string, HistoryPolity>()
    const modeOf = (key: string | null): 'expand' | 'federate' | 'minor' | null =>
      key === null ? null : (foundingOf.get(key)?.mode ?? (minorPolities.has(key) ? 'minor' : null))
    /** history@2: the polity a new colony of system k gets. */
    const inherit = (k: number, kk: number, year: number, enclave: boolean): void => {
      const par = sys[k]
      sys[kk].free = par.free === true && modeOf(par.polity) !== 'expand'
      if (sys[kk].fixedPolity !== undefined) {
        if (sys[kk].fixedPolity !== null) setPolity(kk, sys[kk].fixedPolity!, year, 'fixed')
        return
      }
      const mode = modeOf(par.polity)
      if (mode === null) return
      if (mode === 'federate') {
        if (rp() < foundingOf.get(par.polity!)!.direct) setPolity(kk, par.polity, year, 'founded')
        else sys[kk].free = true
        return
      }
      if (mode === 'minor' && enclave) return
      setPolity(kk, par.polity, year, 'founded')
    }

    // Fixed settlements: by year, and wanted ones (no year) as strong candidates.
    const fixedByStar = new Map<number, FixedSettlement>()
    for (const f of inp.fixed) {
      const i = index.get(f.star)
      if (i === undefined) conflicts.push(`A fixed system's star ${f.star} is not among the stars the run can use (outside its radius?).`)
      else fixedByStar.set(i, f)
    }
    const dated = [...fixedByStar.entries()].filter(([, f]) => f.year !== null).sort((a, b) => a[1].year! - b[1].year! || a[0] - b[0])
    const wanted = new Set([...fixedByStar.entries()].filter(([, f]) => f.year === null).map(([i]) => i))
    const fixedMix = (f: FixedSettlement | undefined, fallback: Mix): Mix => {
      if (!f?.mix || !Object.keys(f.mix).length) return fallback
      const m: Mix = new Map()
      for (const [k, v] of Object.entries(f.mix)) {
        m.set(k, v)
        if (!kind.has(k)) kind.set(k, 'regional')
      }
      return m
    }
    let nextDated = 0
    /** Settle the fixed systems due by `year`, checking that something could have got there. */
    const settleDue = (year: number): void => {
      while (nextDated < dated.length && dated[nextDated][1].year! <= year) {
        const [i, f] = dated[nextDated++]
        if (at.has(i)) continue
        const y = f.year!
        let parent: number | null = null
        if (i === origin) parent = null
        else if (y < inp.years.slow) conflicts.push(`${f.name ?? st[i].id} is settled in ${fmtYear(y)}, before any ship could reach it.`)
        else if (y < inp.years.foam) {
          if (dO(i) > inp.slow.reach)
            conflicts.push(
              `${f.name ?? st[i].id} is settled in ${fmtYear(y)}, before the foam drive, but it is ${dO(i).toFixed(1)} ly out, beyond slow ships' ${inp.slow.reach} ly.`
            )
          parent = at.get(origin) ?? null
        } else {
          let best = -1
          let bd = Infinity
          sys.forEach((s, k) => {
            if (s.founded > y) return
            const d = dist(s.i, i)
            if (d < bd) {
              bd = d
              best = k
            }
          })
          if (best < 0 || bd > inp.growth.legs * L)
            conflicts.push(
              `${f.name ?? st[i].id} is settled in ${fmtYear(y)}, but no settled system was within ${inp.growth.legs} legs of it then${best >= 0 ? ` (the nearest was ${bd.toFixed(1)} ly away)` : ''}.`
            )
          parent = best >= 0 ? best : null
        }
        const kf = settle(i, y, parent, fixedMix(f, parent !== null ? sys[parent].mix : one(inp.originCulture)), {
          fixed: true,
          fixedPolity: f.polity === undefined ? undefined : f.polity,
          name: f.name
        })
        if (F) {
          if (parent !== null) inherit(parent, kf, y, false)
          else if (f.polity) setPolity(kf, f.polity, y, 'fixed')
        }
        if (parent !== null && dist(sys[parent].i, i) <= L && clear(sys[parent].i, i)) addLane([sys[parent].i, i], y)
      }
    }
    const fmtYear = (y: number): string => `year ${Math.round(y)}`

    // ---- history@2: polities that expand, break away, organize, federate and take in applicants ----
    const founded = new Map<string, { year: number; capital: number }>()
    const waiting = new Set<string>()
    const chance = (perDecade: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, perDecade)), inp.step / 10)
    const free = (k: number): boolean => sys[k].fixedPolity === undefined
    const members = (key: string): number[] => sys.flatMap((s, k) => (s.polity === key ? [k] : []))
    const meanMix = (ks: readonly number[]): Mix => {
      const m: Mix = new Map()
      for (const k of ks) for (const [c, v] of sys[k].mix) m.set(c, (m.get(c) ?? 0) + v / ks.length)
      return m
    }
    const similarity = (a: Mix, b: Mix): number => {
      let t = 0
      for (const [c, v] of a) t += Math.min(v, b.get(c) ?? 0)
      return t
    }
    const nameOfPolity = (key: string): string => foundingOf.get(key)?.name ?? minorPolities.get(key)?.name ?? key
    /** Found the expanding polities (and form the federations) that are due by `year`. */
    function foundDue(year: number): void {
      if (!F) return
      for (const p of F.polities) {
        if (founded.has(p.key) || p.from > year) continue
        if (p.mode === 'expand') {
          const ci = p.capital !== null ? index.get(p.capital) : origin
          const k = ci === undefined ? undefined : at.get(ci)
          if (k === undefined) {
            if (!waiting.has(p.key)) waiting.add(p.key)
            continue
          }
          waiting.delete(p.key)
          founded.set(p.key, { year: Math.max(p.from, sys[k].founded), capital: k })
          if (free(k)) setPolity(k, p.key, Math.max(p.from, sys[k].founded), 'founding')
          sys[k].free = false
          ev(Math.max(p.from, sys[k].founded), `${p.name} is founded at @${st[sys[k].i].id}.`, sys[k].i)
          continue
        }
        // A federation: the independent systems of the breakaway line, and the minor polities they formed.
        const fromMinor = new Set<string>()
        for (const [key] of minorPolities) {
          const ms = members(key)
          if (ms.length && ms.filter((k) => sys[k].free).length * 2 >= ms.length) fromMinor.add(key)
        }
        const founders = sys.flatMap((s, k) =>
          free(k) && ((s.polity === null && s.free) || (s.polity !== null && fromMinor.has(s.polity))) ? [k] : []
        )
        if (!founders.length) {
          waiting.add(p.key)
          continue
        }
        waiting.delete(p.key)
        const fixedCap = p.capital !== null ? at.get(index.get(p.capital) ?? -1) : undefined
        let cap = fixedCap !== undefined && founders.includes(fixedCap) ? fixedCap : -1
        if (cap < 0) {
          let bestN = -1
          for (const k of founders) {
            if (sys[k].outpost) continue
            const n = founders.filter((q) => dist(sys[q].i, sys[k].i) <= L).length
            if (n > bestN) [bestN, cap] = [n, k]
          }
          if (cap < 0) cap = founders[0]
        }
        for (const key of fromMinor) {
          const m = minorPolities.get(key)!
          if (m.dissolved === null) m.dissolved = round4(year)
        }
        for (const k of founders) setPolity(k, p.key, year, 'federation')
        founded.set(p.key, { year, capital: cap })
        ev(
          year,
          `${p.name} is formed by ${founders.length} systems that broke away${fromMinor.size ? `, with ${fromMinor.size} polities of their own` : ''}; its capital is @${st[sys[cap].i].id}.`,
          sys[cap].i
        )
      }
    }
    /** One step of polity life (history@2). */
    function polityStep(year: number): void {
      if (!F) return
      foundDue(year)
      // Breakaways: now and then a system far from an expanding polity's capital leaves, with the colonies it founded.
      const children = new Map<number, number[]>()
      sys.forEach((s, k) => {
        if (s.parent === null) return
        let c = children.get(s.parent)
        if (!c) children.set(s.parent, (c = []))
        c.push(k)
      })
      for (const p of F.polities) {
        const f = founded.get(p.key)
        if (p.mode !== 'expand' || !f || rp() >= chance(F.breakaway.rate)) continue
        const capPos = sys[f.capital].i
        const elig = sys.flatMap((s, k) =>
          s.polity === p.key &&
          k !== f.capital &&
          free(k) &&
          !s.outpost &&
          year - s.founded >= F.breakaway.minAge &&
          dist(s.i, capPos) > F.breakaway.distance
            ? [k]
            : []
        )
        if (!elig.length) continue
        const seed =
          elig[
            pickWeighted(
              rp,
              elig.map((k) => dist(sys[k].i, capPos))
            )
          ]
        const line: number[] = []
        const walk = (k: number): void => {
          if (sys[k].polity !== p.key || !free(k)) return
          line.push(k)
          for (const c of children.get(k) ?? []) walk(c)
        }
        walk(seed)
        for (const k of line) {
          setPolity(k, null, year, 'breakaway')
          sys[k].free = true
        }
        ev(
          year,
          `@${st[sys[seed].i].id} breaks away from ${p.name}${line.length > 1 ? `, with ${line.length - 1} of its colonies` : ''}.`,
          sys[seed].i
        )
      }
      // Minor polities: an independent system organizes with its independent neighbours.
      const indep = (k: number): boolean => sys[k].polity === null && free(k)
      for (let k = 0; k < sys.length; k++) {
        if (minorPolities.size >= F.minor.max) break
        if (!indep(k) || sys[k].outpost || year - sys[k].founded < F.minor.minAge || rp() >= chance(F.minor.rate)) continue
        const group = [k]
        for (let q = 0; q < group.length && group.length < F.minor.size; q++)
          near(pos(sys[group[q]].i), L, (j) => {
            const kj = at.get(j)
            if (kj !== undefined && indep(kj) && !group.includes(kj) && group.length < F.minor.size) group.push(kj)
          })
        const n = minorPolities.size
        const lead = dominant(meanMix(group))
        const base = nameFrom(ctx.stream(`polity-${n}`, 'name'), palette.get(lead) ?? 0)
        const form = FORMS[Math.floor(ctx.stream(`polity-${n}`, 'form')() * FORMS.length)]
        let key = `minor-${base.toLowerCase().replace(/[^a-z]+/g, '')}`
        while (foundingOf.has(key) || minorPolities.has(key)) key += '-x'
        hue = (hue + 137.508) % 360
        const m: HistoryPolity = {
          key,
          name: `${base} ${form}`,
          color: hsl(hue, 45, 52),
          minor: true,
          founded: round4(year),
          capital: st[sys[k].i].id,
          dissolved: null,
          systems: 0
        }
        minorPolities.set(key, m)
        for (const q of group) setPolity(q, key, year, 'minor')
        ev(year, `The ${m.name} is formed at @${st[sys[k].i].id}${group.length > 1 ? `, by ${group.length} systems` : ''}.`, sys[k].i)
      }
      // Applications: independent systems and minor polities next to a federation join it, if they are alike enough.
      for (const p of F.polities) {
        const f = founded.get(p.key)
        if (p.mode !== 'federate' || !f) continue
        const ms = members(p.key)
        if (!ms.length) continue
        const pmix = meanMix(ms)
        const nextTo = (k: number): boolean => ms.some((q) => dist(sys[q].i, sys[k].i) <= p.join.legs * L)
        const units: { ks: number[]; minor: string | null }[] = []
        const seenMinor = new Set<string>()
        sys.forEach((s, k) => {
          if (!free(k) || s.outpost) return
          if (s.polity === null) {
            if (year - s.founded >= p.join.minAge && nextTo(k)) units.push({ ks: [k], minor: null })
          } else if (minorPolities.has(s.polity) && !seenMinor.has(s.polity)) {
            const mk = members(s.polity)
            if (mk.some(nextTo) && year - minorPolities.get(s.polity)!.founded! >= p.join.minAge) units.push({ ks: mk, minor: s.polity })
            seenMinor.add(s.polity)
          }
        })
        for (const u of units) {
          if (similarity(meanMix(u.ks), pmix) < p.join.similarity || rp() >= chance(p.join.rate)) continue
          for (const k of u.ks) setPolity(k, p.key, year, 'joined')
          if (u.minor) {
            minorPolities.get(u.minor)!.dissolved = round4(year)
            ev(year, `The ${nameOfPolity(u.minor)} joins ${p.name} (${u.ks.length} systems).`, sys[u.ks[0]].i)
          } else ev(year, `@${st[sys[u.ks[0]].i].id} joins ${p.name}.`, sys[u.ks[0]].i)
        }
      }
      // Expanding polities pull their systems toward their own overall mix.
      for (const p of F.polities) {
        if (p.mode !== 'expand' || p.unify <= 0 || !founded.has(p.key)) continue
        const ms = members(p.key)
        const pmix = meanMix(ms)
        const a = chance(p.unify)
        for (const k of ms) {
          const s = sys[k]
          if (kind.get(dominant(s.mix)) === 'enclave') continue
          const keys = new Set([...s.mix.keys(), ...pmix.keys()])
          for (const c of keys) s.mix.set(c, (s.mix.get(c) ?? 0) * (1 - a) + (pmix.get(c) ?? 0) * a)
        }
      }
    }
    function politiesOut(): HistoryPolity[] {
      const count = new Map<string, number>()
      for (const s of sys) if (s.polity !== null) count.set(s.polity, (count.get(s.polity) ?? 0) + 1)
      for (const key of waiting)
        conflicts.push(
          foundingOf.get(key)!.mode === 'expand'
            ? `${nameOfPolity(key)} was never founded: its capital was never settled.`
            : `${nameOfPolity(key)} never formed: no system had broken away by then (raise the breakaway rate, or move its event later).`
        )
      const out: HistoryPolity[] = (F?.polities ?? []).map((p) => ({
        key: p.key,
        name: p.name,
        color: null,
        minor: false,
        founded: founded.get(p.key)?.year ?? null,
        capital: founded.has(p.key) ? st[sys[founded.get(p.key)!.capital].i].id : null,
        dissolved: null,
        systems: count.get(p.key) ?? 0
      }))
      for (const m of minorPolities.values()) out.push({ ...m, systems: count.get(m.key) ?? 0 })
      return out
    }

    // ---- the origin and the slow-ship era ----
    if (!fixedByStar.has(origin) || fixedByStar.get(origin)!.year === null)
      settle(origin, inp.years.slow, null, fixedMix(fixedByStar.get(origin), one(inp.originCulture)), {
        fixed: fixedByStar.has(origin),
        name: fixedByStar.get(origin)?.name
      })
    settleDue(inp.years.slow)
    if (!at.has(origin)) settle(origin, inp.years.slow, null, one(inp.originCulture))
    if (F) foundDue(inp.years.slow)
    {
      const cand: number[] = []
      near(pos(origin), inp.slow.reach, (j) => {
        if (j !== origin && st[j].cls !== 'D' && st[j].cls !== 'B' && st[j].cls !== 'O') cand.push(j)
      })
      cand.sort((a, b) => dO(a) - dO(b) || a - b)
      const picked: number[] = []
      const fixedSlow = dated.filter(([i, f]) => f.year! < inp.years.foam && i !== origin).length
      while (picked.length + fixedSlow < inp.slow.colonies) {
        const free = cand.filter((j) => !blocked.has(j) && !picked.includes(j) && !fixedByStar.has(j))
        if (!free.length) break
        const w = free.map((j) => (SLOW_WEIGHT[st[j].cls] ?? 0.5) * Math.exp(-dO(j) / 6) * (wanted.has(j) ? 20 : 1))
        const k = pickWeighted(r, w)
        if (k < 0) break
        picked.push(free[k])
      }
      picked.sort((a, b) => dO(a) - dO(b) || a - b)
      const span = Math.max(1, inp.years.foam - inp.years.slow)
      const enclaveAt = picked.length > 1 ? 1 + Math.floor(r() * (picked.length - 1)) : -1
      picked.forEach((j, n) => {
        const year = inp.years.slow + ((n + 0.5) * span * 0.85) / picked.length + r() * span * 0.05
        settleDue(year)
        if (at.has(j)) return
        const slowEnclaves = inp.enclaves.filter((e) => e.from <= year)
        let c: string | null
        if (n === enclaveAt && slowEnclaves.length && r() < inp.culture.enclave * 4)
          c = slowEnclaves[Math.floor(r() * slowEnclaves.length)].culture
        else c = regional(null, year, j)
        const kj = settle(j, year, at.get(origin)!, c ? one(c) : one(inp.originCulture), { name: fixedByStar.get(j)?.name })
        if (F) {
          foundDue(year)
          inherit(at.get(origin)!, kj, year, c !== null && kind.get(c) === 'enclave')
        }
        addLane([origin, j], year)
        ev(
          year,
          `A slow-ship colony at ${starLabel(j)} (${dO(j).toFixed(1)} ly out)${c && kind.get(c) === 'enclave' ? ', founded as an enclave' : ''}.`,
          j
        )
      })
    }
    function starLabel(j: number): string {
      const s = st[j]
      return s.name ?? s.id
    }
    ev(inp.years.foam, 'The foam drive: settlement spreads outward.')

    // ---- growth in the foam era ----
    const reach = inp.growth.legs * L
    const candidates = (k: number): { j: number; d: number; w: number }[] => {
      const a = sys[k].i
      const out: { j: number; d: number; w: number }[] = []
      near(pos(a), reach, (j) => {
        if (blocked.has(j) || at.has(j)) return
        const d = dist(a, j)
        if (d > reach || dO(j) > inp.growth.maxRadius) return
        const outward = dO(j) - dO(a)
        const w =
          (CLASS_WEIGHT[st[j].cls] ?? 0.2) *
          Math.min(5, Math.max(0.12, Math.exp(outward / inp.growth.outward))) *
          (d <= L ? 1 : 0.8) *
          (wanted.has(j) ? 20 : 1)
        out.push({ j, d, w })
      })
      return out
    }
    /** A single stop between two stars more than one leg apart. */
    const hopVia = (a: number, j: number): number => {
      let best = -1
      let bm = Infinity
      const mid: Point3 = [(st[a].pos[0] + st[j].pos[0]) / 2, (st[a].pos[1] + st[j].pos[1]) / 2, (st[a].pos[2] + st[j].pos[2]) / 2]
      near(mid, L, (q) => {
        if (q === a || q === j) return
        const m = Math.max(dist(a, q), dist(q, j))
        if (m <= L && m < bm && clear(a, q) && clear(q, j)) {
          bm = m
          best = q
        }
      })
      return best
    }
    const grow = (k: number, year: number): boolean => {
      const cands = candidates(k)
      if (!cands.length) {
        sys[k].exhausted = true
        return false
      }
      for (let tries = 0; tries < 6 && cands.length; tries++) {
        const n = pickWeighted(
          r,
          cands.map((c) => c.w)
        )
        if (n < 0) return false
        const c = cands.splice(n, 1)[0]
        const a = sys[k].i
        let via = -1
        if (c.d <= L) {
          if (!clear(a, c.j)) continue
        } else {
          via = hopVia(a, c.j)
          if (via < 0) continue
        }
        const par = sys[k]
        let mix: Mix = new Map(par.mix)
        let enclave = false
        if (r() < inp.culture.enclave) {
          const act = inp.enclaves.filter((e) => e.from <= year)
          if (act.length) {
            mix = one(act[Math.floor(r() * act.length)].culture)
            enclave = true
          }
        }
        if (!enclave) {
          const dc = dominant(par.mix)
          const h = home.get(dc)
          if (kind.get(dc) === 'regional' && h !== undefined && dist(h, c.j) > inp.culture.splitDistance && r() < inp.culture.split) {
            const nc = regional(dc, year, c.j)
            if (nc)
              mix = new Map([
                [nc, 0.75],
                [dc, 0.25]
              ])
          }
        }
        const founded = year + r() * inp.step * 0.9
        const kk = settle(c.j, founded, k, mix, { name: fixedByStar.get(c.j)?.name })
        if (F) inherit(k, kk, founded, enclave)
        else if (par.polity !== null && !enclave) {
          sys[kk].polity = par.polity
          sys[kk].politySince = founded
        }
        if (via >= 0 && !at.has(via)) {
          const ko = settle(via, founded, k, new Map(mix), { outpost: true })
          if (F && sys[kk].polity !== null) setPolity(ko, sys[kk].polity, founded, 'founded')
          if (F) sys[ko].free = sys[kk].free
        }
        addLane(via >= 0 ? [a, via, c.j] : [a, c.j], founded)
        wanted.delete(c.j)
        return true
      }
      return false
    }

    // ---- polities ----
    const capitals: Record<string, number> = {}
    const shares: HistoryOutput['shares'] = {}
    const chooseCapitals = (): void => {
      const unit = (k: number): Point3 => {
        const p = st[sys[k].i].pos
        const o = st[origin].pos
        const v: Point3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]
        const d = Math.hypot(...v) || 1
        return [v[0] / d, v[1] / d, v[2] / d]
      }
      const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      const maxD = Math.max(...sys.map((s) => dO(s.i)))
      const chosen: number[] = []
      for (const p of inp.polities) {
        if (p.capital !== null) {
          const i = index.get(p.capital)
          const k = i === undefined ? undefined : at.get(i)
          if (k === undefined) conflicts.push(`The capital of ${p.key} (${p.capital}) is not settled by the time the polities form.`)
          else {
            capitals[p.key] = k
            chosen.push(k)
          }
        }
      }
      for (const p of inp.polities) {
        if (capitals[p.key] !== undefined) continue
        // Spread the capitals out: the settled system farthest, in direction, from those already chosen.
        const pool = sys.map((_, k) => k).filter((k) => !sys[k].outpost && dO(sys[k].i) >= maxD * 0.25 && !chosen.includes(k))
        if (!pool.length) continue
        const score = pool.map((k) => (chosen.length ? Math.min(...chosen.map((c) => 1 - dot(unit(k), unit(c)))) : 1) + r() * 0.15)
        let best = 0
        for (let n = 1; n < pool.length; n++) if (score[n] > score[best]) best = n
        capitals[p.key] = pool[best]
        chosen.push(pool[best])
      }
    }
    /** Polity per system by weighted distance from each capital, balanced to the shares. */
    const borders = (): (string | null)[] => {
      const keys = inp.polities.map((p) => p.key).filter((k) => capitals[k] !== undefined)
      const target = new Map(inp.polities.map((p) => [p.key, p.share]))
      const strength = new Map(keys.map((k) => [k, 1]))
      const elig = sys.map((s) => s.fixedPolity === undefined)
      const Ne = Math.max(1, elig.filter(Boolean).length)
      const maxD = Math.max(1, ...sys.map((s) => dO(s.i)))
      const R0 = maxD * 0.7
      let best: (string | null)[] = sys.map(() => null)
      let bestErr = Infinity
      for (let it = 0; it < 80 && keys.length; it++) {
        const out: (string | null)[] = sys.map(() => null)
        const count = new Map<string, number>()
        sys.forEach((s, k) => {
          if (!elig[k]) return
          let bk: string | null = null
          let bc = Infinity
          for (const key of keys) {
            const c = dist(sys[capitals[key]].i, s.i) / strength.get(key)!
            if (c < bc) {
              bc = c
              bk = key
            }
          }
          if (bk !== null && bc <= R0) {
            out[k] = bk
            count.set(bk, (count.get(bk) ?? 0) + 1)
          }
        })
        let err = 0
        for (const key of keys) err += Math.abs((count.get(key) ?? 0) / Ne - target.get(key)!)
        if (err < bestErr) {
          bestErr = err
          best = out
        }
        for (const key of keys) {
          const share = (count.get(key) ?? 0) / Ne
          strength.set(key, strength.get(key)! * Math.min(1.25, Math.max(0.8, Math.pow((target.get(key)! + 0.01) / (share + 0.01), 0.3))))
        }
      }
      return best
    }
    const formPolities = (year: number): void => {
      chooseCapitals()
      const fin = borders()
      const count = new Map<string, number>()
      sys.forEach((s, k) => {
        s.mixAtPolities = new Map(s.mix)
        const key = s.fixedPolity !== undefined ? s.fixedPolity : fin[k]
        s.polity = key
        s.politySince = key === null ? null : Math.max(year, s.founded)
        if (key !== null) count.set(key, (count.get(key) ?? 0) + 1)
      })
      for (const p of inp.polities) {
        const actual = sys.length ? (count.get(p.key) ?? 0) / sys.length : 0
        shares[p.key] = { target: p.share, actual: round4(actual) }
        if (Math.abs(actual - p.share) > 0.05)
          conflicts.push(
            `${p.key} ends up with ${(actual * 100).toFixed(0)}% of the systems, not the ${(p.share * 100).toFixed(0)}% asked for.`
          )
      }
      const parts = inp.polities.filter((p) => count.get(p.key)).map((p) => `${p.key} ${count.get(p.key)}`)
      ev(
        year,
        `The polities take shape: ${parts.join(', ') || 'none'}; ${sys.filter((s) => s.polity === null).length} systems independent.`
      )
    }

    // ---- the run, a step at a time ----
    const n0 = sys.length
    let politiesFormed = false
    for (let year = inp.years.foam; year < inp.years.end; year += inp.step) {
      settleDue(year)
      if (!F && !politiesFormed && inp.years.polities !== null && year >= inp.years.polities && inp.polities.length) {
        formPolities(inp.years.polities)
        politiesFormed = true
      }
      const f = (t: number): number => Math.pow(Math.max(0, (t - inp.years.foam) / (inp.years.end - inp.years.foam)), 1.1)
      const want = Math.round(n0 + (inp.growth.total - n0) * f(year + inp.step)) - sys.length
      for (let n = 0; n < want; n++) {
        const front = Math.max(20, ...sys.map((s) => dO(s.i)))
        const pool: number[] = []
        const w: number[] = []
        sys.forEach((s, k) => {
          if (s.exhausted || s.outpost || year - s.founded < 15) return
          let x = Math.exp(-(year - s.founded) / 260) * (0.15 + Math.pow(dO(s.i) / front, 2))
          if (kind.get(dominant(s.mix)) === 'enclave') x *= 0.3
          // An expanding polity keeps founding colonies from its old systems too, not only from its frontier.
          if (F && s.polity !== null && foundingOf.get(s.polity)?.mode === 'expand')
            x = Math.max(x, 0.15 + Math.pow(dO(s.i) / front, 2)) * foundingOf.get(s.polity)!.vigor
          pool.push(k)
          w.push(x)
        })
        let ok = false
        for (let tries = 0; tries < 8 && !ok; tries++) {
          const q = pickWeighted(r, w)
          if (q < 0) break
          ok = grow(pool[q], year)
          if (!ok) w[q] = 0
        }
        if (!ok) break
      }
      polityStep(year)
      // Cultures blend along lanes; enclaves resist.
      const delta = sys.map(() => new Map<string, number>())
      const add = (m: Map<string, number>, k: string, v: number): void => {
        m.set(k, (m.get(k) ?? 0) + v)
      }
      for (const l of lanes) {
        if (l.opened > year) continue
        const a = at.get(l.nodes[0])
        const b = at.get(l.nodes[l.nodes.length - 1])
        if (a === undefined || b === undefined) continue
        const ra = kind.get(dominant(sys[a].mix)) === 'enclave' ? 0.15 : 1
        const rb = kind.get(dominant(sys[b].mix)) === 'enclave' ? 0.15 : 1
        const keys = [...new Set([...sys[a].mix.keys(), ...sys[b].mix.keys()])].sort(compareStrings)
        for (const c of keys) {
          const d = (sys[b].mix.get(c) ?? 0) - (sys[a].mix.get(c) ?? 0)
          add(delta[a], c, inp.culture.blend * ra * d)
          add(delta[b], c, -inp.culture.blend * rb * d)
        }
      }
      sys.forEach((s, k) => {
        for (const [c, v] of delta[k]) s.mix.set(c, Math.max(0, (s.mix.get(c) ?? 0) + v))
        let t = 0
        for (const [c, v] of [...s.mix.entries()]) {
          if (v < 0.01) s.mix.delete(c)
          else t += v
        }
        if (t > 0) for (const [c, v] of [...s.mix.entries()]) s.mix.set(c, v / t)
      })
    }
    settleDue(inp.years.end)
    if (!F && !politiesFormed && inp.years.polities !== null && inp.polities.length) formPolities(inp.years.polities)
    if (F && inp.polities.length) conflicts.push('Polities by borders are left out: the polities come about by founding instead.')
    for (const i of wanted) if (!at.has(i)) conflicts.push(`${fixedByStar.get(i)?.name ?? st[i].id} was never reached.`)

    // ---- busy neighbours within one leg get lanes too, so the network is a mesh, not a tree ----
    const has = new Set(lanes.map((l) => `${l.nodes[0]}:${l.nodes[l.nodes.length - 1]}`))
    sys.forEach((s) => {
      const nb: [number, number, number][] = []
      near(pos(s.i), L, (j) => {
        const k = at.get(j)
        if (k === undefined || j === s.i) return
        nb.push([dist(s.i, j), j, k])
      })
      nb.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      for (const [, j, k] of nb.slice(0, 2)) {
        if (has.has(`${s.i}:${j}`) || has.has(`${j}:${s.i}`) || !clear(s.i, j)) continue
        has.add(`${s.i}:${j}`)
        addLane([s.i, j], Math.max(s.founded, sys[k].founded, inp.years.foam) + 15)
      }
    })

    // ---- polities that pull their systems toward one culture ----
    if (politiesFormed)
      for (const p of inp.polities) {
        const cap = capitals[p.key]
        if (cap === undefined || p.unify <= 0) continue
        const cc = dominant(sys[cap].mixAtPolities ?? sys[cap].mix)
        sys.forEach((s) => {
          if (s.polity !== p.key || s.politySince === null) return
          const a = 1 - Math.pow(1 - p.unify, (inp.years.end - s.politySince) / 10)
          for (const [c, v] of [...s.mix.entries()]) s.mix.set(c, v * (1 - a))
          s.mix.set(cc, (s.mix.get(cc) ?? 0) + a)
        })
      }
    for (const [key, k] of Object.entries(capitals))
      ev(inp.years.polities ?? inp.years.end, `${key}: capital at @${st[sys[k].i].id}.`, sys[k].i)

    // ---- names: the star's own if it has a usable one, else from the leading culture's sounds ----
    const used = new Set<string>()
    for (const s of sys) if (s.name) used.add(s.name)
    for (const s of sys) {
      if (s.name) continue
      const star = st[s.i]
      if (star.name && !CATALOG_NAME.test(star.name) && !used.has(star.name)) {
        s.name = star.name
        used.add(s.name)
        continue
      }
      const stream = ctx.stream(star.id, 'name')
      let n = ''
      for (let tries = 0; tries < 30; tries++) {
        n = nameFrom(stream, palette.get(dominant(s.mix)) ?? 0)
        if (!used.has(n) && n.length >= 4) break
      }
      used.add(n)
      s.name = n
    }
    const nameOf = new Map(sys.map((s) => [st[s.i].id, s.name!]))
    for (const e of events) e.text = e.text.replace(/@([^\s.,;]+(?:\.[^\s.,;]+)*)/g, (m, id: string) => nameOf.get(id) ?? id)

    events.sort((a, b) => a.year - b.year || compareStrings(a.text, b.text))
    return {
      systems: sys.map((s) => ({
        star: st[s.i].id,
        name: s.name!,
        founded: round4(s.founded),
        parent: s.parent === null ? null : st[sys[s.parent].i].id,
        outpost: s.outpost,
        fixed: s.fixed,
        mixFounded: mixRecord(s.mixFounded),
        polity: s.polity,
        politySince: s.politySince === null ? null : round4(s.politySince),
        mixAtPolities: s.mixAtPolities ? mixRecord(s.mixAtPolities) : null,
        mixAtEnd: mixRecord(s.mix),
        ...(F ? { changes: s.changes ?? [] } : {})
      })),
      cultures,
      lanes: lanes.map((l) => ({ stars: l.nodes.map((i) => st[i].id), opened: round4(l.opened), slow: l.opened < inp.years.foam })),
      events,
      capitals: Object.fromEntries(Object.entries(capitals).map(([k, v]) => [k, st[sys[v].i].id])),
      shares,
      conflicts,
      ...(F ? { polities: politiesOut() } : {})
    }
  }
}
