/**
 * starfield@1: the faint stars the catalogue cannot see, one grid cell at a
 * time. The algorithm is @malevo/core's generateCell, the prototype's genCell
 * ported exactly; this registers it as a frozen generator so golden fixtures
 * pin its output.
 *
 * Unlike most generators, a cell's stream is seeded the prototype's way,
 * hashInts(seed, ix, iy, iz), not through keyedStream: that keeps prototype
 * star maps reproducible. It is still keyed (by seed and cell), never
 * sequential.
 */
import { generateCell, type StarRecord, type StarfieldParams } from '@malevo/core'
import { defineGenerator } from './generator'

export interface StarfieldInput {
  params: Omit<StarfieldParams, 'seed'>
  /** Overrides the world seed (a world's settings/stars.json may give one). */
  seed?: number
  cell: [number, number, number]
}

export const starfield = defineGenerator<StarfieldInput, StarRecord[]>({
  name: 'starfield',
  version: 1,
  description: 'Generated faint stars for one grid cell (the prototype star map’s generator, exactly).',
  frozen: true,
  generate(input, ctx) {
    return generateCell({ ...input.params, seed: input.seed ?? ctx.worldSeed }, ...input.cell)
  }
})
