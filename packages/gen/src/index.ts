import { generatorId, type Generator } from './generator'
import { placeholderNames } from './names'
import { planets } from './planets'
import { starfield } from './starfield'

export * from './generator'
export { PALETTES, nameFrom, placeholderNames, type NamesInput } from './names'
export { planets, planetsStream, radiusFromMass, type PlanetFile, type PlanetsInput } from './planets'
export { starfield, type StarfieldInput } from './starfield'

/** Every generator version the app knows. Frozen ones are never removed: locked records may name them. */
export const GENERATORS: readonly Generator<never, unknown>[] = [
  placeholderNames as Generator<never, unknown>,
  starfield as Generator<never, unknown>,
  planets as Generator<never, unknown>
]

export function findGenerator(id: string): Generator<never, unknown> | undefined {
  return GENERATORS.find((g) => generatorId(g) === id)
}
