/**
 * What the model needs from outside a world folder: a way to run script
 * calendars (Node only) and the star catalogue (an app asset). Without them,
 * the model still works and reports script calendars and catalogue stars as
 * unavailable.
 */
import type { ScriptCalendarImpl, StarRecord } from '@malevo/core'

/** Compiles a script calendar's code into a sandboxed implementation; throws with a readable message on failure. */
export type ScriptLoader = (code: string, path: string) => ScriptCalendarImpl

/** The real stars, by id. */
export interface StarCatalog {
  get(id: string): StarRecord | undefined
  /** Every catalogue star (Sol included), in a fixed order. */
  stars: readonly StarRecord[]
}

export interface WorldEnv {
  loadScript?: ScriptLoader
  catalog?: StarCatalog
}

/** A catalogue from records (the node entry builds one from the asset file). */
export function catalogFrom(stars: readonly StarRecord[]): StarCatalog {
  const byId = new Map(stars.map((s) => [s.id, s]))
  return { stars, get: (id) => byId.get(id) }
}
