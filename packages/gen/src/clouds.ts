/**
 * clouds@1: a cloud layer for a world with a surface, evaluated at points on
 * the unit sphere, as coverage from 0 (clear) to 1 (overcast).
 *
 * The clouds are weather, not record: they show what the sky over a world is
 * like, never how it looked at a particular moment.
 *
 * - Circulation cells: `cells` per hemisphere (Earth has three). Air rises
 *   and clouds over at the equator and at every second cell boundary, and
 *   sinks and clears at the others and at the poles, so a world with three
 *   cells is cloudy at the equator and near 60° and clear near 30°.
 * - Weather: noise read through a warp, so it curls into eddies, stretched
 *   east–west and broken up by turbulence.
 * - Storms: cyclones that wind the weather into spiral arms around a clear
 *   eye, turning the way their hemisphere's spin turns them.
 * - Cover: the threshold is set (on a soft ramp, so thin cloud is common) so the
 *   mean coverage over the sphere is `cover`, whatever the other settings are.
 *
 * The stream is keyed by the body and the roll, as terrain@1's is.
 */
import { fbm, fibonacciSphere, perlin3, type Vec3 } from '@malevo/core'
import { defineGenerator } from './generator'

export interface CloudsParams {
  /** 0–1: the fraction of the sky covered, on average. */
  cover: number
  /** Circulation cells from equator to pole (Earth 3; a slow rotator 1). */
  cells: number
  /** 0–1: how much the belts wander and break up. */
  turbulence: number
  /** How many cyclones. */
  storms: number
}

export const DEFAULT_CLOUDS: CloudsParams = { cover: 0.6, cells: 3, turbulence: 0.5, storms: 8 }

export interface CloudsInput {
  body: string
  roll: number
  params: CloudsParams
  points: Vec3[]
}

export interface CloudsField {
  /** Coverage, 0–1. */
  cover(p: Vec3): number
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function cloudsField(params: CloudsParams, stream: (purpose: string) => () => number): CloudsField {
  const warp = perlin3(stream('warp'))
  const weather = perlin3(stream('weather'))
  const fine = perlin3(stream('fine'))
  const r = stream('storms')
  const cells = Math.max(1, Math.min(9, Math.round(params.cells)))
  const turb = Math.max(0, Math.min(1, params.turbulence))
  const storms = Array.from({ length: Math.max(0, Math.min(40, Math.round(params.storms))) }, () => {
    const north = r() < 0.5
    // Mostly in the stormy middle latitudes, some in the tropics.
    const band = r() < 0.7 ? 0.6 + r() * 0.5 : 0.17 + r() * 0.3
    const lat = north ? band : -band
    return { lat, lon: r() * 2 * Math.PI, size: 0.08 + r() * 0.12, spin: north ? 1 : -1 }
  })

  const density = (p: Vec3): number => {
    let lat = Math.asin(Math.max(-1, Math.min(1, p[2])))
    let lon = Math.atan2(p[1], p[0])
    // Cyclones: turn the field around each centre, more near the middle, so the weather winds into arms.
    let storm = 0
    for (const s of storms) {
      let dl = lon - s.lon
      dl = Math.atan2(Math.sin(dl), Math.cos(dl)) * Math.cos(s.lat)
      const dy = lat - s.lat
      const d = Math.hypot(dl, dy) / s.size
      if (d > 3) continue
      const ang = s.spin * 5 * Math.exp(-d * d * 0.9)
      const c = Math.cos(ang)
      const sn = Math.sin(ang)
      lat = s.lat + dl * sn + dy * c
      lon = s.lon + (dl * c - dy * sn) / Math.max(0.05, Math.cos(s.lat))
      storm = Math.max(storm, Math.exp(-d * d * 0.6) * (1 - Math.exp(-((d / 0.15) ** 2))))
    }
    const q: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
    // Eddies: warp where the weather noise is read.
    const wx = fbm(warp, [q[0] * 2, q[1] * 2, q[2] * 2], 3, 1)
    const wy = fbm(warp, [q[0] * 2 + 5.2, q[1] * 2 + 1.3, q[2] * 2 + 2.8], 3, 1)
    const k = 0.25 + 0.5 * turb
    const r: Vec3 = [q[0] + wx * k, q[1] + wy * k, q[2] + (wx - wy) * k * 0.5]
    const bent = lat + turb * 0.3 * wx
    const u = (Math.abs(bent) / (Math.PI / 2)) * cells
    const belts = 0.5 + 0.5 * Math.cos(Math.PI * u)
    const streaks = fbm(weather, [r[0] * 3, r[1] * 3, r[2] * 6], 6, 1)
    const grain = fbm(fine, [r[0] * 12, r[1] * 12, r[2] * 16], 3, 1)
    return (0.32 - 0.12 * turb) * belts + 0.6 * streaks + 0.18 * grain + 0.5 * storm
  }

  // The threshold whose soft ramp covers `cover` of the sphere on average.
  const cover = Math.max(0, Math.min(1, params.cover))
  const sample = fibonacciSphere(2000).map(density)
  const lo = 0.05
  const hi = 0.22
  const meanAt = (th: number): number => sample.reduce((a, d) => a + smooth(th - lo, th + hi, d), 0) / sample.length
  let a = Math.min(...sample) - 1
  let b = Math.max(...sample) + 1
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    if (meanAt(m) > cover) a = m
    else b = m
  }
  const th = (a + b) / 2

  return {
    cover(p) {
      if (cover <= 0) return 0
      if (cover >= 1) return 1
      return smooth(th - lo, th + hi, density(p))
    }
  }
}

export const clouds = defineGenerator<CloudsInput, number[]>({
  name: 'clouds',
  version: 1,
  description: "A world's cloud layer on the sphere: circulation belts, streaks and cyclones, as coverage",
  frozen: true,
  generate(inp, ctx) {
    const field = cloudsField(inp.params, (purpose) => ctx.stream(inp.body, `roll-${inp.roll}:clouds:${purpose}`))
    return inp.points.map((p) => Math.round(field.cover(p) * 1000) / 1000)
  }
})
