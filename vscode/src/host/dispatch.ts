/**
 * What the editors' screens ask for (the app's `window.malevo` calls), answered from a world session. It
 * knows nothing of VS Code: the host supplies what only it can do (asking before a delete, opening a tab,
 * the current date), so the same table serves VS Code and the tests.
 */
import type { WorldSession } from '../../../src/main/world'
import type { EditableKind } from '../../../src/shared/types'

export interface HostHooks {
  /** Ask before something that can't be taken back from the screen itself. */
  confirm(message: string): Promise<boolean>
  /** Open a body in its own tab. */
  openBody(id: string): Promise<void>
  /** Open a system in its own tab. */
  openSystem(id: string): Promise<void>
  /** A tool the app has that VS Code doesn't yet. */
  navigate(tool: string, focus?: string): void
  state(): { now: number; displayCal: string | null }
  setNow(t: number): void
  setDisplayCal(cal: string): void
}

const KINDS: readonly EditableKind[] = [
  'event',
  'calendar',
  'physics',
  'system',
  'body',
  'culture',
  'polity',
  'relation',
  'cultureSettings',
  'station',
  'nebula',
  'route',
  'viewpoint',
  'historySettings',
  'terrain',
  'city',
  'cityPlan',
  'ship',
  'traveller',
  'drifter',
  'landing',
  'itinerary'
]

function asKind(k: unknown): EditableKind {
  if (!KINDS.includes(k as EditableKind)) throw new Error(`"${String(k)}" cannot be edited.`)
  return k as EditableKind
}

const num = (x: unknown, fallback = 0): number => (Number.isFinite(Number(x)) ? Number(x) : fallback)

export type Dispatch = (method: string, args: unknown[]) => Promise<unknown>

export function makeDispatch(world: WorldSession, host: HostHooks): Dispatch {
  const table: Record<string, (...a: unknown[]) => unknown> = {
    'world.current': () => world.info(),
    'world.snapshot': () => world.snapshot(),
    'world.setEntity': (kind, id, value) => world.setEntity(asKind(kind), String(id), value),
    'world.renameEntity': (kind, from, to) => world.renameEntity(asKind(kind), String(from), String(to)),
    'world.deleteEntity': async (kind, id) => {
      if (await host.confirm(`Delete ${String(kind)} “${String(id)}”?`)) world.deleteEntity(asKind(kind), String(id))
    },
    'world.deleteEntities': async (items) => {
      const list = (Array.isArray(items) ? items : []).map((i) => ({
        kind: asKind((i as { kind: unknown }).kind),
        id: String((i as { id: unknown }).id)
      }))
      if (!list.length) return
      const what = list.length === 1 ? `${list[0].kind} “${list[0].id}”` : `${list.length} files (${list.map((i) => i.id).join(', ')})`
      if (await host.confirm(`Delete ${what}?`)) world.deleteEntities(list)
    },
    'world.addKnownPlanets': (sys, candidates) => world.addKnownPlanets(String(sys), candidates === true),
    'world.addSolarSystem': () => world.addSolarSystem(),
    'world.resetBuiltin': (kind, id) => world.resetBuiltin(asKind(kind), String(id)),
    'world.undo': () => undefined,
    'world.redo': () => undefined,
    'pages.read': (p) => world.pageText(String(p)),
    'calendar.ticks': (cal, t0, t1, target) => world.ticks(String(cal), num(t0), num(t1), num(target, 10)),
    'calendar.format': (cal, items) =>
      world.format(
        String(cal),
        (Array.isArray(items) ? items : []).map((i) => ({
          t: num((i as { t: unknown }).t),
          precision: (i as { precision?: string | null }).precision ?? null
        }))
      ),
    'calendar.parse': (cal, text) => world.parse(String(cal), String(text)),
    'stars.near': (center, radius, generated) =>
      world.starsNear(
        Array.isArray(center) && center.length === 3 ? (center.map(Number) as [number, number, number]) : [0, 0, 0],
        num(radius, 20),
        Boolean(generated)
      ),
    'stars.get': (id) => world.star(String(id)),
    'stars.search': (text) => world.searchStars(String(text)),
    'systems.roll': (id, roll) => world.roll(String(id), num(roll)),
    'systems.keep': (id, roll) => world.keep(String(id), num(roll)),
    'routes.plan': (from, to) => world.planRoute(String(from), String(to)),
    'settings.get': () => ({}),
    'settings.set': () => undefined,
    'app.info': () => ({ version: 'vscode', packaged: true }),
    // What only the host can do.
    'host.state': () => host.state(),
    'host.setNow': (t) => host.setNow(num(t)),
    'host.setDisplayCal': (cal) => host.setDisplayCal(String(cal)),
    'host.openBody': (id) => host.openBody(String(id)),
    'host.openSystem': (id) => host.openSystem(String(id)),
    'host.navigate': (tool, focus) => host.navigate(String(tool), focus === undefined ? undefined : String(focus))
  }
  return async (method, args) => {
    const f = table[method]
    if (!f) throw new Error(`${method} is not available in VS Code yet.`)
    return f(...args)
  }
}
