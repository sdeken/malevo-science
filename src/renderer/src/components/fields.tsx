import { useEffect, useState } from 'react'

/** A text field that commits on Enter or when it loses focus. */
export function TextField({
  label,
  value,
  onCommit,
  id,
  placeholder
}: {
  label: string
  value: string
  onCommit(v: string): void
  id?: string
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      {label}
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

/**
 * A number field that commits on Enter or blur. With `optional`, clearing it
 * commits undefined (an override removed, say).
 */
export function NumberField({
  label,
  value,
  onCommit,
  hint,
  step,
  optional,
  placeholder,
  id
}: {
  label: string
  value: number | undefined
  onCommit(v: number | undefined): void
  hint?: string
  step?: number
  optional?: boolean
  placeholder?: string
  id?: string
}): React.JSX.Element {
  const shown = value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = (): void => {
    if (draft.trim() === '') {
      if (optional && value !== undefined) onCommit(undefined)
      else setDraft(shown)
      return
    }
    const n = Number(draft)
    if (Number.isFinite(n) && n !== value) onCommit(n)
    else setDraft(shown)
  }
  return (
    <label className="field">
      {label}
      <input
        id={id}
        type="number"
        step={step ?? 'any'}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  )
}

/** Significant figures, without exponent noise for everyday magnitudes. */
export function sig(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return v === Infinity ? '∞' : '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e7 || abs < 1e-4) return v.toExponential(digits - 1).replace('e+', 'e')
  return Number(v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 10 })
}

/** A duration in the most readable unit: hours, days or years (standard days, Julian years). */
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—'
  if (!Number.isFinite(s)) return 'never'
  const a = Math.abs(s)
  const sign = s < 0 ? '−' : ''
  if (a < 2 * 86400) return `${sign}${sig(a / 3600, 4)} h`
  if (a < 2 * 31_557_600) return `${sign}${sig(a / 86400, 4)} d`
  return `${sign}${sig(a / 31_557_600, 4)} yr`
}

/** A star's colour from its B−V index (black-body approximation of its temperature). */
export function starColour(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
  const k = Math.max(1000, Math.min(40000, t)) / 100
  const r = k <= 66 ? 255 : 329.698727446 * (k - 60) ** -0.1332047592
  const g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661 : 288.1221695283 * (k - 60) ** -0.0755148492
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307
  const c = (x: number): number => Math.max(0, Math.min(255, x)) / 255
  return [c(r), c(g), c(b)]
}
