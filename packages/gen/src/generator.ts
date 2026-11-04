/**
 * Generators (docs/PLAN.md §3.2–3.3).
 *
 * A generator is a pure function from (input, world seed) to output, named
 * `name@version`. It draws randomness only from keyed streams, so each
 * entity's result depends only on its own key, never on what else was
 * generated or in what order.
 *
 * Once a version is frozen, its output for any input must never change: a
 * locked record names the version that made it and may be regenerated from
 * it at any time. Golden fixtures (packages/gen/golden/) pin the output
 * hashes of every frozen version, and CI fails if one moves. A fix or an
 * improvement is a new version alongside the old one.
 *
 * The stream key uses the generator's *name*, not its version, so a new
 * version draws the same numbers wherever its logic is unchanged.
 */
import { keyedStream, type Random } from '@malevo/core'

export interface GenContext {
  worldSeed: number
  /** The random stream for one entity and purpose. */
  stream(entityId: string, purpose?: string): Random
}

export interface Generator<I, O> {
  /** Lowercase kebab-case. Part of every stream key, so never renamed. */
  name: string
  /** A positive integer. */
  version: number
  description: string
  /** Frozen versions are pinned by golden fixtures and must never change their output. */
  frozen: boolean
  generate(input: I, ctx: GenContext): O
}

const NAME = /^[a-z][a-z0-9-]*$/

export function defineGenerator<I, O>(g: Generator<I, O>): Generator<I, O> {
  if (!NAME.test(g.name)) throw new Error(`Generator name "${g.name}" must be lowercase kebab-case.`)
  if (!Number.isInteger(g.version) || g.version < 1) throw new Error(`Generator ${g.name} needs a whole version number of 1 or more.`)
  return Object.freeze({ ...g })
}

export function generatorId(g: Pick<Generator<unknown, unknown>, 'name' | 'version'>): string {
  return `${g.name}@${g.version}`
}

export function contextFor(g: Pick<Generator<unknown, unknown>, 'name'>, worldSeed: number): GenContext {
  return { worldSeed, stream: (entityId, purpose = '') => keyedStream(worldSeed, g.name, entityId, purpose) }
}

export function runGenerator<I, O>(g: Generator<I, O>, input: I, worldSeed: number): O {
  return g.generate(input, contextFor(g, worldSeed))
}
