import { generatorId, type Generator } from './generator'
import { history } from './history'
import { terrain } from './terrain'
import { bands } from './bands'
import { placeholderNames } from './names'
import { planets } from './planets'
import { starfield } from './starfield'

export * from './generator'
export { PALETTES, nameFrom, placeholderNames, type NamesInput } from './names'
export { planets, planetsStream, radiusFromMass, type PlanetFile, type PlanetsInput } from './planets'
export { starfield, type StarfieldInput } from './starfield'
export { bands, bandsField, DEFAULT_BANDS, type BandsInput, type BandsParams, type BandsField } from './bands'
export { terrain, terrainField, DEFAULT_TERRAIN, type TerrainInput, type TerrainParams, type TerrainField } from './terrain'
export {
  history,
  type HistoryInput,
  type HistoryOutput,
  type HistoryStar,
  type HistorySystem,
  type HistoryCulture,
  type FixedSettlement
} from './history'

/** Every generator version the app knows. Frozen ones are never removed: locked records may name them. */
export const GENERATORS: readonly Generator<never, unknown>[] = [
  placeholderNames as Generator<never, unknown>,
  starfield as Generator<never, unknown>,
  planets as Generator<never, unknown>,
  history as Generator<never, unknown>,
  terrain as Generator<never, unknown>,
  bands as Generator<never, unknown>
]

export function findGenerator(id: string): Generator<never, unknown> | undefined {
  return GENERATORS.find((g) => generatorId(g) === id)
}
