import { generatorId, type Generator } from './generator'
import { placeholderNames } from './names'

export * from './generator'
export { PALETTES, nameFrom, placeholderNames, type NamesInput } from './names'

/** Every generator version the app knows. Frozen ones are never removed: locked records may name them. */
export const GENERATORS: readonly Generator<never, unknown>[] = [placeholderNames as Generator<never, unknown>]

export function findGenerator(id: string): Generator<never, unknown> | undefined {
  return GENERATORS.find((g) => generatorId(g) === id)
}
