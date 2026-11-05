/**
 * The sky view: a look-around picture of the sky from a point on a body,
 * drawn from a scene in the observer's local frame (x east, y north, z up).
 *
 * The background is @malevo/core's sky model, evaluated per pixel at reduced
 * resolution and scaled up: the same physics the checks and tests use, with
 * no separate shader copy. Points of light (stars, torches, bodies) are drawn
 * by one rule relative to the local limiting magnitude, after extinction, as
 * the prototype torchlight did: equal magnitudes look equal, and torches fade
 * at dawn where they would. Projection is stereographic about the view
 * direction.
 */
import {
  DEG,
  airParams,
  luminanceOf,
  refraction,
  skyModel,
  toneMap,
  type Atmosphere,
  type Instrument,
  type SkyModel,
  type Vec3
} from '@malevo/core'

export type PointKind = 'star' | 'torch' | 'body' | 'sun'

export interface SkyPoint {
  id: string
  kind: PointKind
  /** Unit direction, local frame. */
  dir: Vec3
  mag: number
  /** Display colour, 0–255. */
  color: [number, number, number]
  label?: string
  /** Angular radius, radians, for bodies big enough to show a disc. */
  radius?: number
  /** For a disc: unit direction toward its light source, local frame, and its phase angle. */
  lit?: Vec3
  phase?: number
}

export interface SkyPicture {
  sun: Vec3
  atmosphere: Atmosphere | null
  galPole: Vec3
  galCentre: Vec3
  points: SkyPoint[]
  /** Labels to show for the brightest stars, by id. */
  starLabels?: number
}

export interface SkyCamera {
  /** Radians, from north toward east. */
  az: number
  alt: number
  /** Horizontal field of view, radians. */
  fov: number
}

export interface SkyPick {
  point: SkyPoint
  /** Apparent magnitude after extinction, and the limit there. */
  seen: number
  limit: number
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2])
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** A star's display colour from its B−V index. */
export function starColor(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
  const k = clamp(t, 1000, 40000) / 100
  const r = k <= 66 ? 255 : 329.698727446 * (k - 60) ** -0.1332047592
  const g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661 : 288.1221695283 * (k - 60) ** -0.0755148492
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)].map(Math.round) as [number, number, number]
}

/** The camera's forward, right and up vectors. */
export function cameraAxes(c: SkyCamera): { F: Vec3; R: Vec3; U: Vec3 } {
  const F: Vec3 = [Math.sin(c.az) * Math.cos(c.alt), Math.cos(c.az) * Math.cos(c.alt), Math.sin(c.alt)]
  const R: Vec3 = [Math.cos(c.az), -Math.sin(c.az), 0]
  const U: Vec3 = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]]
  return { F, R, U }
}

/** Stereographic projection: a direction to pixel offsets from the centre, or null behind the viewer. */
export function project(d: Vec3, axes: ReturnType<typeof cameraAxes>, scale: number): [number, number] | null {
  const cz = dot(d, axes.F)
  if (cz < -0.2) return null
  const x = dot(d, axes.R)
  const y = dot(d, axes.U)
  const s = Math.hypot(x, y)
  if (s < 1e-12) return [0, 0]
  const th = Math.atan2(s, cz)
  const rr = 2 * Math.tan(th / 2) * scale
  return [(x / s) * rr, (-y / s) * rr]
}

export function unproject(px: number, py: number, axes: ReturnType<typeof cameraAxes>, scale: number): Vec3 {
  const rr = Math.hypot(px, py) / scale
  const th = 2 * Math.atan(rr / 2)
  if (rr < 1e-12) return axes.F
  const ux = px / Math.hypot(px, py)
  const uy = -py / Math.hypot(px, py)
  return norm([
    Math.cos(th) * axes.F[0] + Math.sin(th) * (ux * axes.R[0] + uy * axes.U[0]),
    Math.cos(th) * axes.F[1] + Math.sin(th) * (ux * axes.R[1] + uy * axes.U[1]),
    Math.cos(th) * axes.F[2] + Math.sin(th) * (ux * axes.R[2] + uy * axes.U[2])
  ])
}

/** Pixels per unit of stereographic radius for a horizontal field of view across `width` pixels. */
export const projectionScale = (width: number, fov: number): number => width / 2 / (2 * Math.tan(fov / 4))

/** The sky model for a picture (cache it per picture: building it costs a few milliseconds). */
export function pictureModel(p: SkyPicture): SkyModel {
  const air = p.atmosphere ? airParams(p.atmosphere) : airParams({ radius: 6.4e6, column: 0, scaleHeight: 8000, light: 1 })
  const moon = p.points.filter((x) => x.kind === 'body' && x.dir[2] > 0 && x.mag < -4).sort((a, b) => a.mag - b.mag)[0]
  return skyModel({
    air,
    column: p.atmosphere?.column ?? 0,
    sun: p.sun,
    galPole: p.galPole,
    galCentre: p.galCentre,
    moon: moon ? { dir: moon.dir, mag: moon.mag } : null
  })
}

/** How a point of light looks against the sky: its magnitude after extinction and the limit there. */
export function seenMagnitude(model: SkyModel, p: SkyPoint, instrument: Instrument | null): { seen: number; limit: number } {
  return { seen: p.mag + model.extinction(p.dir), limit: model.limitingMagnitude(p.dir, instrument) }
}

/** Instrument for a field of view, as the prototype chose: the eye above 15°, binoculars to 3°, a telescope below. */
export function instrumentFor(fov: number): { name: string; instrument: Instrument | null } {
  if (fov >= 15 * DEG) return { name: 'Naked eye', instrument: null }
  if (fov >= 3 * DEG) return { name: '10×50 binoculars', instrument: { aperture: 50, magnification: 10, transmission: 0.85 } }
  return { name: '100 mm telescope', instrument: { aperture: 100, magnification: clamp(50 / (fov / DEG), 20, 250), transmission: 0.8 } }
}

/**
 * Draw the picture into a 2D canvas context of size w × h (CSS pixels, with
 * `dpr` device pixels each). Returns the drawn points' screen positions for
 * picking.
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  pic: SkyPicture,
  model: SkyModel,
  cam: SkyCamera,
  opts: { resolution?: number; labels?: boolean; refract?: boolean } = {}
): { x: number; y: number; pick: SkyPick }[] {
  const axes = cameraAxes(cam)
  const scale = projectionScale(w, cam.fov)
  const { instrument } = instrumentFor(cam.fov)
  const column = pic.atmosphere?.column ?? 0

  // ---- background ----
  const step = opts.resolution ?? 6
  const bw = Math.max(2, Math.ceil(w / step))
  const bh = Math.max(2, Math.ceil(h / step))
  const img = new ImageData(bw, bh)
  for (let j = 0; j < bh; j++)
    for (let i = 0; i < bw; i++) {
      const d = unproject((i + 0.5) * step - w / 2, (j + 0.5) * step - h / 2, axes, scale)
      // Below the horizon the ground is drawn crisply afterwards; carry the sky down so its edge blends.
      const t = toneMap(model.light(d[2] < 0 ? [d[0], d[1], 0] : d))
      const c = [t[0] * 255, t[1] * 255, t[2] * 255]
      const k = (j * bw + i) * 4
      img.data[k] = c[0]
      img.data[k + 1] = c[1]
      img.data[k + 2] = c[2]
      img.data[k + 3] = 255
    }
  const tmp = new OffscreenCanvas(bw, bh)
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tmp, 0, 0, bw * step, bh * step)

  // ---- the ground, at full resolution: per column, find where the horizon crosses ----
  const groundL = luminanceOf(model.light([axes.F[0], axes.F[1], 0.03])) * 0.06
  const gt = toneMap([groundL * 0.95, groundL * 0.9, groundL * 0.75])
  const ground = `rgb(${Math.round(gt[0] * 255 + 10)},${Math.round(gt[1] * 255 + 11)},${Math.round(gt[2] * 255 + 13)})`
  const zAt = (x: number, y: number): number => unproject(x - w / 2, y - h / 2, axes, scale)[2]
  ctx.fillStyle = ground
  for (let x = 0; x < w; x++) {
    const cx = x + 0.5
    if (zAt(cx, h) >= 0) continue
    let lo = 0
    let hi = h
    if (zAt(cx, 0) < 0) hi = 0
    else
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2
        if (zAt(cx, m) < 0) hi = m
        else lo = m
      }
    const top = Math.floor(hi)
    ctx.globalAlpha = 1 - (hi - top)
    ctx.fillRect(x, top, 1, 1)
    ctx.globalAlpha = 1
    ctx.fillRect(x, top + 1, 1, h - top)
  }

  // ---- points of light ----
  const drawn: { x: number; y: number; pick: SkyPick }[] = []
  const toScreen = (d: Vec3): [number, number] | null => {
    let dir = d
    if (opts.refract !== false && column > 0) {
      const alt = Math.asin(clamp(d[2], -1, 1))
      const a2 = alt + refraction(alt, column)
      const ch = Math.hypot(d[0], d[1]) || 1
      dir = [(d[0] / ch) * Math.cos(a2), (d[1] / ch) * Math.cos(a2), Math.sin(a2)]
    }
    if (dir[2] < -0.002) return null
    const p = project(dir, axes, scale)
    if (!p) return null
    const x = p[0] + w / 2
    const y = p[1] + h / 2
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return null
    return [x, y]
  }
  const sorted = [...pic.points].sort((a, b) => b.mag - a.mag)
  for (const p of sorted) {
    const at = toScreen(p.dir)
    if (!at) continue
    const { seen, limit } = seenMagnitude(model, p, instrument)
    const discPx = p.radius ? p.radius * scale * 2 : 0
    if (p.kind === 'sun' || discPx > 2.5) {
      if (seen > limit + 3 && p.kind !== 'sun') continue
      drawDisc(ctx, at[0], at[1], Math.max(discPx, 3), p, axes, scale)
      drawn.push({ x: at[0], y: at[1], pick: { point: p, seen, limit } })
      continue
    }
    // Relative to the local limit: what is just visible is drawn as just visible.
    const m = seen - (limit - 6.5)
    if (m > 6.6) continue
    drawPoint(ctx, at[0], at[1], m, p.color, p.kind === 'star')
    drawn.push({ x: at[0], y: at[1], pick: { point: p, seen, limit } })
  }

  // ---- horizon and compass ----
  ctx.strokeStyle = 'rgba(160,180,210,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  let first = true
  for (let a = 0; a <= 360; a += 2) {
    const p = project([Math.sin(a * DEG), Math.cos(a * DEG), 0], axes, scale)
    if (!p) {
      first = true
      continue
    }
    if (first) ctx.moveTo(p[0] + w / 2, p[1] + h / 2)
    else ctx.lineTo(p[0] + w / 2, p[1] + h / 2)
    first = false
  }
  ctx.stroke()
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const [label, a] of [
    ['N', 0],
    ['NE', 45],
    ['E', 90],
    ['SE', 135],
    ['S', 180],
    ['SW', 225],
    ['W', 270],
    ['NW', 315]
  ] as const) {
    const p = project([Math.sin(a * DEG), Math.cos(a * DEG), 0], axes, scale)
    if (!p) continue
    ctx.fillStyle = label.length === 1 ? 'rgba(230,236,245,0.9)' : 'rgba(200,210,225,0.55)'
    ctx.fillText(label, p[0] + w / 2, p[1] + h / 2 + 16)
  }

  // ---- labels ----
  if (opts.labels !== false) {
    ctx.textAlign = 'left'
    ctx.font = '11px system-ui, sans-serif'
    const starLabels = pic.starLabels ?? 12
    let stars = 0
    for (const d of [...drawn].sort((a, b) => a.pick.seen - b.pick.seen)) {
      const p = d.pick.point
      if (!p.label) continue
      if (p.kind === 'star' && (stars >= starLabels || d.pick.seen > d.pick.limit - 1)) continue
      if (p.kind === 'star') stars++
      if (p.kind === 'torch') continue
      ctx.fillStyle = p.kind === 'star' ? 'rgba(190,205,225,0.75)' : 'rgba(255,226,170,0.9)'
      ctx.fillText(p.label, d.x + 7, d.y - 6)
    }
  }
  ctx.restore()
  return drawn
}

function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number, m: number, col: [number, number, number], real: boolean): void {
  let c = col
  if (real) {
    const sat = clamp((1.5 - m) / 5, 0, 1)
    c = col.map((v) => Math.round(255 + (v - 255) * sat)) as [number, number, number]
  }
  const rgb = c.join(',')
  const f = 10 ** (-0.4 * (m - 6.5))
  const lf = Math.log10(Math.max(f, 1))
  const a = Math.min(1, 0.22 + 0.26 * lf)
  const core = Math.min(3.2, 0.7 + 0.35 * lf)
  if (m < 1) {
    const gr = Math.min(26, 3 * 10 ** (-0.12 * (m - 1)))
    const g = ctx.createRadialGradient(x, y, core, x, y, gr)
    g.addColorStop(0, `rgba(${rgb},0.38)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, gr, 0, 2 * Math.PI)
    ctx.fill()
  }
  ctx.fillStyle = `rgba(${rgb},${a})`
  ctx.beginPath()
  ctx.arc(x, y, core, 0, 2 * Math.PI)
  ctx.fill()
}

/** A disc with its lit side toward its light (the Sun is all lit). */
function drawDisc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  diameter: number,
  p: SkyPoint,
  axes: ReturnType<typeof cameraAxes>,
  scale: number
): void {
  const r = diameter / 2
  const rgb = p.color.join(',')
  if (p.kind === 'sun') {
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 8 + 20)
    g.addColorStop(0, `rgba(${rgb},0.55)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 8 + 20, 0, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = `rgb(${rgb})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fill()
    return
  }
  // The dark side, faintly.
  ctx.fillStyle = 'rgba(40,44,52,0.85)'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, 2 * Math.PI)
  ctx.fill()
  if (!p.lit || p.phase === undefined) return
  // Which way the lit side faces on screen: project a point a little toward the light.
  const tip: Vec3 = norm([p.dir[0] + p.lit[0] * 0.01, p.dir[1] + p.lit[1] * 0.01, p.dir[2] + p.lit[2] * 0.01])
  const a = project(p.dir, axes, scale)
  const b = project(tip, axes, scale)
  const ang = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0
  const k = Math.cos(p.phase)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.fillStyle = `rgb(${rgb})`
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2)
  ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, (3 * Math.PI) / 2, k < 0)
  ctx.fill()
  ctx.restore()
}
