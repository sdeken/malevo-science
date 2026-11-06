/**
 * String ordering by UTF-16 code unit. Unlike localeCompare, the result never
 * depends on the machine's locale or ICU version, so anything sorted with it
 * (file lists, ids, generator inputs) comes out the same everywhere.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const SPAN_UNITS: [string, number][] = [
  ['y', 31_557_600],
  ['w', 604_800],
  ['d', 86_400],
  ['h', 3_600],
  ['m', 60],
  ['s', 1]
]

/**
 * A span of time for people: years (Julian), weeks, days, hours, minutes and
 * seconds, leaving out units that are zero: "1w 1d 13h", "14m 56.4s". At most
 * three units are shown, the smallest rounded; under an hour, seconds keep a
 * tenth.
 */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'never'
  const sign = seconds < 0 ? '−' : ''
  let a = Math.abs(seconds)
  const top = (x: number): number => {
    const i = SPAN_UNITS.findIndex(([, u]) => x >= u)
    return i < 0 ? SPAN_UNITS.length - 1 : i
  }
  // Round at the smallest unit shown (three units down from the largest; tenths of a second under an hour).
  const precision = (x: number): number => {
    const i = top(x)
    return SPAN_UNITS[i][1] < 3_600 ? 0.1 : SPAN_UNITS[Math.min(i + 2, SPAN_UNITS.length - 1)][1]
  }
  let p = precision(a)
  a = Math.round(a / p) * p
  p = precision(a)
  a = Math.round(a / p) * p
  if (a === 0) return '0s'
  const parts: string[] = []
  let rest = a
  for (const [name, u] of SPAN_UNITS) {
    if (u < p && !(p < 1 && name === 's')) break
    if (name === 's') {
      const v = Math.round(rest * 10) / 10
      if (v > 0) parts.push(`${Number.isInteger(v) ? v : v.toFixed(1)}s`)
      break
    }
    const n = Math.floor(rest / u + 1e-9)
    rest -= n * u
    if (n > 0) parts.push(`${n}${name}`)
  }
  return sign + (parts.join(' ') || '0s')
}
