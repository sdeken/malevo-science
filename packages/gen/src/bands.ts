/**
 * bands@1: the look of a gas or ice giant, evaluated at points on the unit
 * sphere (so every size of map reads the same), as colours.
 *
 * - Bands: the latitude, bent by turbulence, picks a place in the palette,
 *   so zones and belts alternate from pole to pole.
 * - Streaks: noise stretched along the bands, so the cloud tops look sheared
 *   by the winds.
 * - Storms: ovals at random places, wider than tall, with a swirl inside.
 * - Contrast scales how far colours stray from the palette's middle.
 *
 * The stream is keyed by the body and the roll, as terrain@1's is.
 */
import { fbm, perlin3, type Vec3 } from '@malevo/core'
import { defineGenerator } from './generator'

export interface BandsParams {
  /** How many bands from pole to pole. */
  bands: number
  /** 0–1: how strongly the colours differ. */
  contrast: number
  /** 0–1: how much the bands wander and break up. */
  turbulence: number
  /** How many large storms. */
  storms: number
  /** Colours the bands are drawn from, "#rrggbb", at least two. */
  palette: string[]
}

export const DEFAULT_BANDS: Record<'gas-giant' | 'ice-giant', BandsParams> = {
  'gas-giant': { bands: 14, contrast: 0.6, turbulence: 0.45, storms: 3, palette: ['#e9dcc0', '#c79a68', '#f2ead8', '#a87650', '#d8bf98'] },
  'ice-giant': { bands: 8, contrast: 0.25, turbulence: 0.3, storms: 1, palette: ['#a8d8e4', '#8cc4d6', '#c2e6ee', '#7fb4cc'] }
}

export interface BandsInput {
  body: string
  roll: number
  params: BandsParams
  points: Vec3[]
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

export interface BandsField {
  colour(p: Vec3): [number, number, number]
}

export function bandsField(params: BandsParams, stream: (purpose: string) => () => number): BandsField {
  const pal = (params.palette.length >= 2 ? params.palette : ['#d0c0a0', '#a08060']).map(hex)
  const warp = perlin3(stream('warp'))
  const streak = perlin3(stream('streak'))
  const r = stream('storms')
  const storms = Array.from({ length: Math.max(0, Math.min(20, Math.round(params.storms))) }, () => {
    const lat = (r() - 0.5) * 1.4
    const lon = r() * 2 * Math.PI
    const size = 0.06 + r() * 0.14
    return { lat, lon, a: size * 1.8, b: size, tone: r() < 0.5 ? 0 : pal.length - 1, spin: r() < 0.5 ? 1 : -1 }
  })
  const n = Math.max(1, params.bands)
  const contrast = Math.max(0, Math.min(1, params.contrast))
  const turb = Math.max(0, Math.min(1, params.turbulence))
  const mean = [0, 1, 2].map((k) => pal.reduce((s, c) => s + c[k], 0) / pal.length)

  return {
    colour(p) {
      let lat = Math.asin(Math.max(-1, Math.min(1, p[2])))
      let lon = Math.atan2(p[1], p[0])
      // Storms: inside an oval, swirl the coordinates and pull toward the storm's colour.
      let stormMix = 0
      let stormTone = 0
      for (const s of storms) {
        let dl = lon - s.lon
        dl = Math.atan2(Math.sin(dl), Math.cos(dl)) * Math.cos(s.lat)
        const q = (dl / s.a) ** 2 + ((lat - s.lat) / s.b) ** 2
        if (q < 2.5) {
          const w = Math.exp(-q * 1.4)
          const ang = s.spin * w * 3
          const dlat = lat - s.lat
          lat = s.lat + dlat * Math.cos(ang) - ((dl * s.b) / s.a) * Math.sin(ang)
          lon += ((dlat * s.a) / s.b) * Math.sin(ang) * 0.5
          if (w > stormMix) {
            stormMix = w
            stormTone = s.tone
          }
        }
      }
      const q: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
      const bent = lat + turb * 0.25 * fbm(warp, [q[0] * 1.5, q[1] * 1.5, q[2] * 4], 4, 1.5)
      // Where in the palette: bands alternate, with a little variety of shade within each.
      const u = (bent / Math.PI + 0.5) * n
      const band = Math.floor(u)
      const f = u - band
      const edge = 0.5 - 0.5 * Math.cos(Math.min(1, Math.max(0, (Math.min(f, 1 - f) * 2) / 0.4)) * Math.PI)
      const idx = (((band * 7) % pal.length) + pal.length) % pal.length
      const next = (idx + 1) % pal.length
      const base = pal[idx].map((c, k) => c * edge + ((pal[next][k] * (1 - edge) + c) / 2) * (1 - edge)) as [number, number, number]
      // Streaks along the bands.
      const st = fbm(streak, [q[0] * 3, q[1] * 3, q[2] * 22], 5, 1.2) * (0.35 + 0.65 * turb)
      let c = base.map((v, k) => mean[k] + (v - mean[k]) * (0.4 + 1.2 * contrast) + st * 60 * contrast) as [number, number, number]
      if (stormMix > 0)
        c = c.map((v, k) => v * (1 - stormMix * 0.8) + pal[stormTone][k] * stormMix * 0.8 * (stormTone === 0 ? 1 : 0.85)) as [
          number,
          number,
          number
        ]
      return c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number]
    }
  }
}

export const bands = defineGenerator<BandsInput, [number, number, number][]>({
  name: 'bands',
  version: 1,
  description: "A giant planet's cloud bands, streaks and storms on the sphere, as colours",
  frozen: true,
  generate(inp, ctx) {
    const field = bandsField(inp.params, (purpose) => ctx.stream(inp.body, `roll-${inp.roll}:${purpose}`))
    return inp.points.map((p) => field.colour(p))
  }
})
