/**
 * Units. Everything inside the library is SI (metres, kilograms, seconds).
 * These constants convert at the edges: file fields carry their unit in the
 * key name (`semiMajorAxis_au`), and the model converts with these on load.
 *
 * Physical constants are the IAU/CODATA nominal values. Nothing here is a
 * property of any particular setting.
 */

// Exact or nominal SI constants
export const C = 299_792_458 // m/s, exact
export const G = 6.6743e-11 // m^3 kg^-1 s^-2 (CODATA 2018)
export const G0 = 9.80665 // m/s^2, standard gravity, exact

// Time
export const SECOND = 1
export const MINUTE = 60
export const HOUR = 3600
/** The app's standard day: exactly 86,400 s. A worldbuilding unit, not an in-universe standard. */
export const DAY = 86_400
export const WEEK = 7 * DAY
/** Julian year, 365.25 standard days: the unit behind the light-year. */
export const JULIAN_YEAR = 365.25 * DAY

// Length
export const KM = 1000
export const AU = 149_597_870_700 // m, exact (IAU 2012)
export const LY = C * JULIAN_YEAR // m, IAU light-year
export const PC = (648_000 / Math.PI) * AU // m, exact by definition (IAU 2015)

// Mass (IAU 2015 nominal parameters, via GM where GM is the better-known quantity)
export const GM_SUN = 1.3271244e20 // m^3/s^2
export const GM_EARTH = 3.986004e14 // m^3/s^2
export const GM_JUPITER = 1.2668653e17 // m^3/s^2
export const M_SUN = GM_SUN / G // kg
export const M_EARTH = GM_EARTH / G // kg
export const M_JUPITER = GM_JUPITER / G // kg

// Radius and luminosity (IAU 2015 nominal)
export const R_SUN = 6.957e8 // m
export const R_EARTH = 6.3781e6 // m, equatorial
export const R_JUPITER = 7.1492e7 // m, equatorial
export const L_SUN = 3.828e26 // W
/** Solar constant at 1 AU, W/m^2 (IAU 2015 nominal total solar irradiance). */
export const SOLAR_CONSTANT = 1361

// Angles
export const DEG = Math.PI / 180
export const ARCSEC = DEG / 3600

/** Unit symbols the formatter and the model's key suffixes understand, with their size in SI. */
export const UNITS = {
  m: 1,
  km: KM,
  au: AU,
  ly: LY,
  pc: PC,
  s: SECOND,
  min: MINUTE,
  h: HOUR,
  d: DAY,
  w: WEEK,
  y: JULIAN_YEAR,
  kg: 1,
  t: 1000,
  msun: M_SUN,
  mearth: M_EARTH,
  mjup: M_JUPITER,
  rsun: R_SUN,
  rearth: R_EARTH,
  rjup: R_JUPITER,
  lsun: L_SUN,
  mps: 1,
  kmps: KM,
  kmh: KM / HOUR,
  c: C,
  mps2: 1,
  g: G0,
  deg: DEG,
  rad: 1,
  arcsec: ARCSEC
} as const

export type UnitSymbol = keyof typeof UNITS

export function toSI(value: number, unit: UnitSymbol): number {
  return value * UNITS[unit]
}

export function fromSI(value: number, unit: UnitSymbol): number {
  return value / UNITS[unit]
}

export function convert(value: number, from: UnitSymbol, to: UnitSymbol): number {
  return (value * UNITS[from]) / UNITS[to]
}

/** Round to `sig` significant digits, returning a number (not a string). */
export function roundSig(value: number, sig: number): number {
  if (!Number.isFinite(value) || value === 0) return value
  return Number(value.toPrecision(sig))
}

/** "1.52 AU", "6,500 c": a value in SI shown in the given unit with `sig` significant digits. */
export function formatQuantity(si: number, unit: UnitSymbol, sig = 4): string {
  const v = roundSig(fromSI(si, unit), sig)
  const label = UNIT_LABELS[unit] ?? unit
  return `${formatNumber(v)} ${label}`
}

const UNIT_LABELS: Partial<Record<UnitSymbol, string>> = {
  au: 'AU',
  msun: 'M☉',
  mearth: 'M⊕',
  mjup: 'M♃',
  rsun: 'R☉',
  rearth: 'R⊕',
  rjup: 'R♃',
  lsun: 'L☉',
  mps: 'm/s',
  kmps: 'km/s',
  kmh: 'km/h',
  mps2: 'm/s²',
  deg: '°',
  arcsec: '″'
}

/** Thousands separators for large magnitudes, plain otherwise; never exponent notation in the useful range. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const abs = Math.abs(v)
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e15)) return v.toExponential(3).replace('e+', 'e')
  const [int, frac] = String(v).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/** "3 d 4 h 05 m" style durations (standard days). Seconds are shown only under a minute. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds)
  const sign = seconds < 0 ? '−' : ''
  let s = Math.abs(seconds)
  if (s < 60) return `${sign}${roundSig(s, 3)} s`
  let m = Math.round(s / 60)
  const d = Math.floor(m / 1440)
  m -= d * 1440
  const h = Math.floor(m / 60)
  m -= h * 60
  s = 0
  const parts: string[] = []
  if (d) parts.push(`${formatNumber(d)} d`)
  if (d || h) parts.push(`${h} h`)
  parts.push(`${String(m).padStart(d || h ? 2 : 1, '0')} m`)
  return sign + parts.join(' ')
}
