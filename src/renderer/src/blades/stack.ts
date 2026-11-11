/**
 * The blade stack: the views open side by side, left to right. Opening something from a blade puts it just
 * to the right, in place of whatever was there (as following a link replaces the rest of a trail); the
 * sidebar starts a new stack, or (with Shift) adds to the end.
 */
import type { BladeSpec } from '../tools/registry'

export interface Blade {
  /** Stable while the blade is open, so its view keeps its state. */
  key: string
  type: string
  params: Record<string, string>
  collapsed?: boolean
}

let counter = 0
const newKey = (): string => `b${Date.now().toString(36)}${(counter++).toString(36)}`

const sameParams = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

/**
 * Open `spec` to the right of blade `from` (−1: at the start). A view already just there of the same type is
 * pointed at the new thing instead of opening another; the blades beyond it close.
 */
export function openAfter(stack: readonly Blade[], from: number, spec: BladeSpec): Blade[] {
  const params = spec.params ?? {}
  const keep = stack.slice(0, from + 1)
  const next = stack[from + 1]
  if (next && next.type === spec.type) return [...keep, { ...next, params, collapsed: false }]
  // Asked to open what this very blade already shows: nothing to do.
  const self = stack[from]
  if (self && self.type === spec.type && sameParams(self.params, params)) return [...stack]
  return [...keep, { key: newKey(), type: spec.type, params }]
}

/** Start again from one view. */
export function fresh(spec: BladeSpec): Blade[] {
  return [{ key: newKey(), type: spec.type, params: spec.params ?? {} }]
}

/** Add a view at the end. */
export function append(stack: readonly Blade[], spec: BladeSpec): Blade[] {
  return [...stack, { key: newKey(), type: spec.type, params: spec.params ?? {} }]
}

export function close(stack: readonly Blade[], key: string): Blade[] {
  return stack.filter((b) => b.key !== key)
}

export function toggleCollapsed(stack: readonly Blade[], key: string): Blade[] {
  return stack.map((b) => (b.key === key ? { ...b, collapsed: !b.collapsed } : b))
}

/** A stack read back from storage: anything malformed is dropped. */
export function sanitize(v: unknown, known: (type: string) => boolean): Blade[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((b): Blade[] => {
    const x = b as Partial<Blade>
    if (typeof x?.type !== 'string' || !known(x.type)) return []
    const params: Record<string, string> = {}
    for (const [k, val] of Object.entries(x.params ?? {})) if (typeof val === 'string') params[k] = val
    return [{ key: typeof x.key === 'string' ? x.key : newKey(), type: x.type, params, collapsed: x.collapsed === true }]
  })
}
