/**
 * Canonical JSON text for world files (docs/PLAN.md §3.5).
 *
 * - Two-space indent, LF line endings, a trailing newline.
 * - Objects are always one key per line, in the order given (schemas give
 *   schema order).
 * - Arrays of numbers, booleans and short strings stay on one line when the
 *   line fits in 100 columns, so coordinate triples read as [x, y, z].
 *   Anything else gets one item per line.
 * - Numbers use JavaScript's shortest round-trip form; schemas round them to
 *   their declared precision before they get here.
 */
const INLINE_WIDTH = 100

export function canonicalJson(value: unknown): string {
  return `${write(value, '')}\n`
}

function write(value: unknown, indent: string): string {
  if (value === null || typeof value !== 'object') return scalar(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isInlineScalar)) {
      const one = `[${value.map(scalar).join(', ')}]`
      if (indent.length + one.length <= INLINE_WIDTH) return one
    }
    return `[\n${value.map((v) => inner + write(v, inner)).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`).join(',\n')}\n${indent}}`
}

function isInlineScalar(v: unknown): boolean {
  return v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 24)
}

function scalar(v: unknown): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Cannot write ${v} to a world file.`)
    return Object.is(v, -0) ? '0' : JSON.stringify(v)
  }
  return JSON.stringify(v)
}
