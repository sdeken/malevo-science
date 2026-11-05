/**
 * Schemas for world files (docs/PLAN.md §3.5).
 *
 * A small combinator library rather than zod, because a world-file schema has
 * to do three things beyond validation, all of which need to be first-class:
 *
 * 1. Canonical output: `toJson` writes object keys in schema order and rounds
 *    each number to its declared precision, so a value never churns in a diff.
 * 2. References: `ref(kind)` fields are collected while parsing, which is how
 *    dangling references and the dependency graph are found.
 * 3. Forward compatibility: object keys the schema does not know are kept
 *    (after the known ones, in their original order) and reported, never
 *    silently dropped.
 *
 * Parsing never throws; problems are collected with a JSON path.
 */

export type Severity = 'error' | 'warning' | 'info'

export interface SchemaIssue {
  severity: Severity
  code: string
  /** JSON path within the file, e.g. "units[2].per". Empty for the whole file. */
  field: string
  message: string
}

export interface Ref {
  kind: string
  id: string
  field: string
}

export interface ParseContext {
  issues: SchemaIssue[]
  refs: Ref[]
}

export interface Schema<T, O extends boolean = boolean> {
  readonly type: string
  /** Absent keys are allowed in an object. */
  readonly optional: O
  /** Returns undefined (with an issue recorded) when the value is unusable. */
  parse(input: unknown, field: string, ctx: ParseContext): T | undefined
  /** The canonical JSON value: keys ordered, numbers rounded. */
  toJson(value: T): unknown
}

export type Infer<S> = S extends Schema<infer T, boolean> ? T : never

const issue = (ctx: ParseContext, field: string, message: string, code = 'schema', severity: Severity = 'error'): undefined => {
  ctx.issues.push({ severity, code, field, message })
  return undefined
}

const describe = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : JSON.stringify(v)

const join = (field: string, key: string): string => (field ? `${field}.${key}` : key)

// ---- numbers ----

export interface NumberOptions {
  /** Significant digits kept when writing (default 12). */
  sig?: number
  min?: number
  max?: number
  /** Exclusive lower bound. */
  above?: number
  integer?: boolean
}

/** Round to `sig` significant digits as a number. Integers within 2^53 are returned unchanged. */
export function roundForFile(v: number, sig: number): number {
  if (!Number.isFinite(v) || v === 0) return v === 0 ? 0 : v // also turns −0 into 0
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return v
  return Number(v.toPrecision(sig))
}

export function num(opts: NumberOptions = {}): Schema<number, false> {
  const sig = opts.sig ?? 12
  return {
    type: 'number',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'number' || !Number.isFinite(input)) return issue(ctx, field, `Expected a number, found ${describe(input)}.`)
      if (opts.integer && !Number.isInteger(input)) return issue(ctx, field, `Expected a whole number, found ${input}.`)
      if (opts.min !== undefined && input < opts.min) return issue(ctx, field, `Must be at least ${opts.min}, found ${input}.`)
      if (opts.max !== undefined && input > opts.max) return issue(ctx, field, `Must be at most ${opts.max}, found ${input}.`)
      if (opts.above !== undefined && !(input > opts.above)) return issue(ctx, field, `Must be greater than ${opts.above}, found ${input}.`)
      return input
    },
    toJson: (v) => roundForFile(v, sig)
  }
}

// ---- strings and literals ----

export interface StringOptions {
  min?: number
  max?: number
  pattern?: RegExp
  /** Said instead of the regular expression when `pattern` fails. */
  patternHint?: string
}

export function str(opts: StringOptions = {}): Schema<string, false> {
  return {
    type: 'string',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'string') return issue(ctx, field, `Expected text, found ${describe(input)}.`)
      if (opts.min !== undefined && input.length < opts.min)
        return issue(ctx, field, opts.min === 1 ? 'Must not be empty.' : `Must be at least ${opts.min} characters.`)
      if (opts.max !== undefined && input.length > opts.max) return issue(ctx, field, `Must be at most ${opts.max} characters.`)
      if (opts.pattern && !opts.pattern.test(input))
        return issue(ctx, field, `"${input}" ${opts.patternHint ?? `does not match ${opts.pattern}`}.`)
      return input
    },
    toJson: (v) => v
  }
}

export function bool(): Schema<boolean, false> {
  return {
    type: 'boolean',
    optional: false as const,
    parse: (input, field, ctx) =>
      typeof input === 'boolean' ? input : issue(ctx, field, `Expected true or false, found ${describe(input)}.`),
    toJson: (v) => v
  }
}

/** Any JSON value, kept as it is (for settings whose shape depends on another field, like a region's preset). */
export function json(): Schema<unknown, false> {
  return {
    type: 'json',
    optional: false as const,
    parse: (input, field, ctx) => {
      try {
        JSON.stringify(input)
        return input
      } catch {
        return issue(ctx, field, 'Expected plain JSON.')
      }
    },
    toJson: (v) => v
  }
}

export function oneOf<const T extends string>(values: readonly T[]): Schema<T, false> {
  return {
    type: 'enum',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input === 'string' && (values as readonly string[]).includes(input)) return input as T
      return issue(ctx, field, `Expected one of ${values.map((v) => `"${v}"`).join(', ')}, found ${describe(input)}.`)
    },
    toJson: (v) => v
  }
}

// ---- references ----

/** Entity ids: lowercase letters, digits, ".", "_" and "-", starting with a letter or digit; at most 64 characters. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isId(s: string): boolean {
  return ID_PATTERN.test(s)
}

/** The id of another entity of `kind`. Collected so dangling references can be found. */
export function ref(kind: string): Schema<string, false> {
  return {
    type: `ref:${kind}`,
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'string' || !isId(input)) return issue(ctx, field, `Expected the id of a ${kind}, found ${describe(input)}.`)
      ctx.refs.push({ kind, id: input, field })
      return input
    },
    toJson: (v) => v
  }
}

// ---- optional ----

export function opt<T>(inner: Schema<T, false>): Schema<T | undefined, true> {
  return {
    type: inner.type,
    optional: true as const,
    parse: (input, field, ctx) => (input === undefined ? undefined : inner.parse(input, field, ctx)),
    toJson: (v) => (v === undefined ? undefined : inner.toJson(v))
  }
}

// ---- arrays ----

export function arr<T>(item: Schema<T>, opts: { min?: number; max?: number } = {}): Schema<T[], false> {
  return {
    type: 'array',
    optional: false as const,
    parse(input, field, ctx) {
      if (!Array.isArray(input)) return issue(ctx, field, `Expected a list, found ${describe(input)}.`)
      if (opts.min !== undefined && input.length < opts.min)
        return issue(ctx, field, `Needs at least ${opts.min} item${opts.min === 1 ? '' : 's'}.`)
      if (opts.max !== undefined && input.length > opts.max) return issue(ctx, field, `Allows at most ${opts.max} items.`)
      const out: T[] = []
      let ok = true
      input.forEach((v, i) => {
        const parsed = item.parse(v, `${field}[${i}]`, ctx)
        if (parsed === undefined) ok = false
        else out.push(parsed)
      })
      return ok ? out : undefined
    },
    toJson: (v) => v.map((x) => item.toJson(x))
  }
}

// ---- objects ----

type Shape = Record<string, Schema<unknown>>
type Out<S extends Shape> = { [K in keyof S as S[K] extends Schema<unknown, true> ? never : K]: Infer<S[K]> } & {
  [K in keyof S as S[K] extends Schema<unknown, true> ? K : never]?: Exclude<Infer<S[K]>, undefined>
}

/** Marks the keys an object kept without understanding them. Not enumerable, so it never leaks into output. */
const EXTRAS = Symbol('extras')

export type WithExtras = { [EXTRAS]?: Record<string, unknown> }

export function extrasOf(value: object): Record<string, unknown> {
  return (value as WithExtras)[EXTRAS] ?? {}
}

export function obj<S extends Shape>(shape: S): Schema<Out<S>, false> {
  const keys = Object.keys(shape)
  return {
    type: 'object',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'object' || input === null || Array.isArray(input))
        return issue(ctx, field, `Expected an object, found ${describe(input)}.`)
      const src = input as Record<string, unknown>
      const out: Record<string, unknown> = {}
      let ok = true
      for (const k of keys) {
        const s = shape[k]
        if (!(k in src) || src[k] === undefined) {
          if (!s.optional) {
            issue(ctx, join(field, k), `"${k}" is missing.`)
            ok = false
          }
          continue
        }
        const parsed = s.parse(src[k], join(field, k), ctx)
        if (parsed === undefined) ok = false
        else out[k] = parsed
      }
      const extras: Record<string, unknown> = {}
      for (const k of Object.keys(src)) {
        if (!(k in shape)) {
          extras[k] = src[k]
          issue(ctx, join(field, k), `"${k}" is not a known field; it is kept as-is.`, 'unknown-field', 'info')
        }
      }
      if (!ok) return undefined
      if (Object.keys(extras).length) Object.defineProperty(out, EXTRAS, { value: extras, enumerable: false })
      return out as Out<S>
    },
    toJson(value) {
      const out: Record<string, unknown> = {}
      const v = value as Record<string, unknown>
      for (const k of keys) {
        if (v[k] === undefined) continue
        out[k] = shape[k].toJson(v[k])
      }
      for (const [k, x] of Object.entries(extrasOf(value as object))) if (!(k in out)) out[k] = x
      return out
    }
  }
}

/** A map from ids to values; written with keys sorted. */
export function dict<T>(value: Schema<T>, opts: { key?: Schema<string> } = {}): Schema<Record<string, T>, false> {
  return {
    type: 'dict',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'object' || input === null || Array.isArray(input))
        return issue(ctx, field, `Expected an object, found ${describe(input)}.`)
      const out: Record<string, T> = {}
      let ok = true
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (opts.key && opts.key.parse(k, join(field, k), ctx) === undefined) ok = false
        const parsed = value.parse(v, join(field, k), ctx)
        if (parsed === undefined) ok = false
        else out[k] = parsed
      }
      return ok ? out : undefined
    },
    toJson(v) {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) out[k] = value.toJson(v[k])
      return out
    }
  }
}

/**
 * Objects told apart by a string field (`kind`, usually). Each variant is an
 * obj() schema that includes the tag itself, so it is validated and written
 * like any other field.
 */
export function tagged<K extends string, V extends Record<string, Schema<object>>>(tag: K, variants: V): Schema<Infer<V[keyof V]>, false> {
  const names = Object.keys(variants)
  return {
    type: 'tagged',
    optional: false as const,
    parse(input, field, ctx) {
      if (typeof input !== 'object' || input === null || Array.isArray(input))
        return issue(ctx, field, `Expected an object, found ${describe(input)}.`)
      const t = (input as Record<string, unknown>)[tag]
      if (typeof t !== 'string' || !names.includes(t)) {
        return issue(
          ctx,
          join(field, tag),
          `Expected "${tag}" to be one of ${names.map((n) => `"${n}"`).join(', ')}, found ${describe(t)}.`
        )
      }
      return variants[t].parse(input, field, ctx) as Infer<V[keyof V]> | undefined
    },
    toJson(v) {
      const t = (v as Record<string, unknown>)[tag] as string
      return variants[t].toJson(v as object)
    }
  }
}

/** Parse a whole file's value. */
export function parseWith<T>(schema: Schema<T>, input: unknown): { value: T | undefined; issues: SchemaIssue[]; refs: Ref[] } {
  const ctx: ParseContext = { issues: [], refs: [] }
  const value = schema.parse(input, '', ctx)
  return { value, issues: ctx.issues, refs: ctx.refs }
}
