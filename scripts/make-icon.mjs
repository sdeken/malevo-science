/**
 * Draws build/icon.png (512×512): a lit planet crossed by a tilted orbit, on a
 * dark rounded square. Pure Node, no image libraries; rerun with `npm run icon`.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'

const N = 512
const SS = 4 // supersamples per axis
const px = new Float64Array(N * N * 4)

const mix = (a, b, t) => a + (b - a) * t
const clamp = (x) => Math.max(0, Math.min(1, x))

function sample(x, y) {
  // Rounded square background.
  const r = 96
  const qx = Math.max(Math.abs(x - 256) - (256 - r), 0)
  const qy = Math.max(Math.abs(y - 256) - (256 - r), 0)
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0]
  const g = y / N
  let c = [mix(22, 10, g), mix(28, 14, g), mix(46, 26, g)]

  // Orbit ellipse, tilted; the back half is drawn behind the planet.
  const ang = (-24 * Math.PI) / 180
  const dx = x - 256
  const dy = y - 262
  const u = dx * Math.cos(ang) - dy * Math.sin(ang)
  const v = dx * Math.sin(ang) + dy * Math.cos(ang)
  const e = Math.hypot(u / 214, v / 74)
  const ring = clamp(1 - Math.abs(e - 1) * 60)
  const front = v > 0

  const drawRing = (col) => {
    const rc = [150, 200, 255]
    return col.map((ch, i) => mix(ch, rc[i], ring * 0.9))
  }
  if (!front) c = drawRing(c)

  // Planet.
  const pr = 132
  const px0 = x - 256
  const py0 = y - 256
  const d = Math.hypot(px0, py0)
  if (d < pr + 1) {
    const cover = clamp(pr + 0.5 - d)
    const nz = Math.sqrt(Math.max(0, 1 - (d / pr) ** 2))
    const nx = px0 / pr
    const ny = py0 / pr
    const light = clamp(nx * -0.55 + ny * -0.45 + nz * 0.7)
    // Bands of "terrain" by latitude, gently warped.
    const lat = ny + 0.08 * Math.sin(nx * 7.0)
    const band = 0.5 + 0.5 * Math.sin(lat * 13)
    const ocean = [36, 92, 160]
    const land = [96, 150, 110]
    const base = ocean.map((o, i) => mix(o, land[i], band > 0.72 ? 0.85 : 0))
    const lit = base.map((b) => b * (0.12 + 1.05 * light))
    const rim = clamp((d / pr - 0.86) * 7) * 0.35
    const shaded = lit.map((ch, i) => mix(ch, [120, 180, 255][i], rim))
    c = c.map((ch, i) => mix(ch, shaded[i], cover))
  }
  if (front) c = drawRing(c)

  // A small star.
  const sd = Math.hypot(x - 410, y - 108)
  const star = clamp(1 - sd / 9) + 0.35 * clamp(1 - sd / 26) ** 2
  c = c.map((ch) => mix(ch, 255, clamp(star)))
  return [c[0], c[1], c[2], 255]
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        for (let i = 0; i < 4; i++) acc[i] += s[i] * (i < 3 ? s[3] / 255 : 1)
      }
    }
    const a = acc[3] / (SS * SS)
    const o = (y * N + x) * 4
    for (let i = 0; i < 3; i++) px[o + i] = a > 0 ? acc[i] / (SS * SS) / (a / 255) : 0
    px[o + 3] = a
  }
}

// Encode PNG (RGBA, 8-bit).
const raw = Buffer.alloc(N * (N * 4 + 1))
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  for (let x = 0; x < N * 4; x++) raw[y * (N * 4 + 1) + 1 + x] = Math.round(Math.max(0, Math.min(255, px[y * N * 4 + x])))
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/icon.png')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
