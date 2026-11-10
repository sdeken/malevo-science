/**
 * Built-in entities: the real Solar System and the planets found around real
 * stars. They are astronomy, not anyone's setting, so they live in the app
 * rather than in the world's files. A built-in gets a file only when it is
 * changed; the file then overrides it. Deleting one hides it (in
 * settings/builtins.json), and deleting its file brings the built-in back.
 *
 * Built-ins follow the app: a later version with better data changes the
 * built-ins of every world that has not overridden them.
 */
import { canonicalJson } from './canonical'
import type { FileChange } from './editor'
import { contentHash } from './hash'
import {
  bodyKind,
  builtinSettingsKind,
  entityKey,
  entityPath,
  systemKind,
  type BodyFile,
  type BuiltinSettings,
  type KindDef,
  type SystemFile
} from './kinds'
import { knownSystemOf } from './knownPlanets'
import type { Entity, WorldData } from './load'
import { parseWith } from './schema'
import { solarSystem } from './solarSystem'

export const SOL_STAR = 'hyg.0'

export function builtinSettings(world: WorldData): BuiltinSettings {
  return (world.entities.get(builtinSettingsKind.kind)?.value as BuiltinSettings | undefined) ?? {}
}

interface Candidate {
  kind: KindDef
  id: string
  value: unknown
}

/** What the built-ins are for this world's files and settings (overridden or not, hidden ones left out). */
function builtinCandidates(world: WorldData): Candidate[] {
  const settings = builtinSettings(world)
  const hidden = new Set(settings.hidden ?? [])
  const fileSystems = [...world.entities.values()].filter(
    (e): e is Entity & { value: SystemFile } => e.kind.kind === systemKind.kind && e.value !== undefined
  )
  const out: Candidate[] = []
  const systems: { id: string; star: string }[] = fileSystems.map((e) => ({ id: e.id, star: e.value.star }))

  if (settings.solarSystem !== false) {
    // The bodies join whatever system sits on the Sun; without one, the built-in Sol (unless it was deleted or its id is taken).
    const onSun = fileSystems.find((e) => e.value.star === SOL_STAR)
    const solKey = entityKey(systemKind as KindDef, 'sol')
    const systemId = onSun?.id ?? (hidden.has(solKey) || world.entities.has(solKey) ? null : 'sol')
    if (systemId) {
      for (const f of solarSystem(systemId)) {
        if (f.kind.kind === systemKind.kind && onSun) continue
        if (hidden.has(entityKey(f.kind, f.id))) continue
        out.push(f)
      }
      if (!onSun) systems.push({ id: systemId, star: SOL_STAR })
    }
  }

  if (settings.knownPlanets !== false) {
    for (const sys of systems) {
      const known = knownSystemOf(sys.star)
      if (!known) continue
      known.planets.forEach((p, k) => {
        if (p.candidate && !settings.candidates) return
        if (hidden.has(entityKey(bodyKind as KindDef, p.id))) return
        const body: BodyFile = {
          name: p.name,
          system: sys.id,
          class: p.cls,
          orbit: { a_au: p.a_au, e: p.e, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: (k * 137) % 360, epoch: { t_s: 0 } },
          mass_mearth: p.msini_mearth,
          radius_km: p.radius_km,
          rotation: p.locked ? { locked: true, tilt_deg: 0 } : { period_h: p.period_h ?? 17, tilt_deg: 0 }
        }
        out.push({ kind: bodyKind as KindDef, id: p.id, value: body })
      })
    }
  }
  return out
}

/**
 * Add the built-ins to a world read from its files: those without a file
 * become entities (origin "builtin"); files that stand in for one are marked
 * "override". A file of the same id that is not about the same thing (a body
 * of that id in another system) wins, and the built-in is left out.
 */
export function addBuiltins(world: WorldData): WorldData {
  world.builtins = new Map()
  if (!world.kinds.includes(systemKind as KindDef) || !world.kinds.includes(bodyKind as KindDef)) return world
  for (const c of builtinCandidates(world)) {
    const parsed = parseWith(c.kind.schema, c.value)
    if (parsed.value === undefined) continue
    const key = entityKey(c.kind, c.id)
    const canonical = canonicalJson(c.kind.schema.toJson(parsed.value))
    const file = world.entities.get(key)
    if (file) {
      const sys = (v: unknown): unknown => (v as { system?: unknown } | undefined)?.system
      if (c.kind.kind === bodyKind.kind && file.value !== undefined && sys(file.value) !== sys(c.value)) continue
      file.origin = 'override'
      world.builtins.set(key, canonical)
      continue
    }
    world.builtins.set(key, canonical)
    world.entities.set(key, {
      key,
      kind: c.kind,
      id: c.id,
      path: entityPath(c.kind, c.id),
      value: parsed.value,
      text: canonical,
      canonical,
      hash: contentHash(canonical),
      refs: parsed.refs,
      origin: 'builtin'
    })
  }
  // A note beside a built-in (bodies/earth.md with no earth.json) belongs to it.
  const notes = new Set([...world.entities.values()].filter((e) => e.origin === 'builtin').map((e) => e.path.replace(/\.json$/, '.md')))
  world.issues = world.issues.filter((i) => !(i.code === 'orphan-note' && i.path && notes.has(i.path)))
  return world
}

function settingsChange(world: WorldData, next: BuiltinSettings): FileChange {
  const clean: BuiltinSettings = { ...next }
  if (clean.hidden && !clean.hidden.length) delete clean.hidden
  if (clean.solarSystem === true) delete clean.solarSystem
  if (clean.knownPlanets === true) delete clean.knownPlanets
  if (clean.candidates === false) delete clean.candidates
  const path = builtinSettingsKind.file!
  if (!Object.keys(clean).length) return { path, text: null }
  return { path, text: canonicalJson(builtinSettingsKind.schema.toJson(clean)) }
}

/** The change that hides these built-ins (keys that are not built-ins are ignored); null if none are. */
export function hideBuiltins(world: WorldData, keys: readonly string[]): FileChange | null {
  const add = keys.filter((k) => world.builtins?.has(k))
  if (!add.length) return null
  const s = builtinSettings(world)
  const hidden = [...new Set([...(s.hidden ?? []), ...add])].sort()
  return settingsChange(world, { ...s, hidden })
}

/** Change the built-in settings: turn groups on or off, or bring hidden ones back (all, or those matching). */
export function changeBuiltins(
  world: WorldData,
  set: { solarSystem?: boolean; knownPlanets?: boolean; candidates?: boolean; unhide?: (key: string) => boolean }
): FileChange | null {
  const s = builtinSettings(world)
  const next: BuiltinSettings = { ...s }
  if (set.solarSystem !== undefined) next.solarSystem = set.solarSystem
  if (set.knownPlanets !== undefined) next.knownPlanets = set.knownPlanets
  if (set.candidates !== undefined) next.candidates = set.candidates
  if (set.unhide) next.hidden = (s.hidden ?? []).filter((k) => !set.unhide!(k))
  const change = settingsChange(world, next)
  const current = world.entities.get(builtinSettingsKind.kind)
  const now = current ? current.text : null
  return change.text === now ? null : change
}

/** Files that say exactly what the built-in they override says: deleting them changes nothing but the file count. */
export function redundantBuiltinFiles(world: WorldData, files: ReadonlyMap<string, string | null>): FileChange[] {
  const out: FileChange[] = []
  for (const e of world.entities.values()) {
    if (e.origin !== 'override' || e.canonical === null || e.canonical !== world.builtins?.get(e.key)) continue
    // A note beside it stays, and belongs to the built-in.
    if (typeof files.get(e.path) !== 'string') continue
    out.push({ path: e.path, text: null })
  }
  return out
}
