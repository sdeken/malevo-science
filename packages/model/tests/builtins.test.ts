import { describe, expect, it } from 'vitest'
import {
  addBuiltins,
  changeBuiltins,
  hideBuiltins,
  readWorld,
  redundantBuiltinFiles,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  type WorldFile
} from '@malevo/model'
import { renamePlan, nodeEnv } from '@malevo/model/node'
import { bodyKind, systemKind } from '@malevo/model'

const base = (): WorldFile[] => [{ path: 'world.json', text: '{"format": 1, "name": "B", "seed": 3}' }, ...templateFiles()]
const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const read = (files: WorldFile[]): ReturnType<typeof readWorld> => addBuiltins(readWorld(files))
const apply = (list: WorldFile[], changes: { path: string; text: string | null }[]): WorldFile[] => {
  const m = new Map(list.map((f) => [f.path, f.text]))
  for (const c of changes) {
    if (c.text === null) m.delete(c.path)
    else m.set(c.path, c.text)
  }
  return [...m].map(([p, text]) => ({ path: p, text }))
}
const fileMap = (list: WorldFile[]): Map<string, string | null> => new Map(list.map((f) => [f.path, f.text]))

describe('built-in astronomy', () => {
  it('gives a new world the Solar System without a single file for it', () => {
    const w = read(base())
    expect(w.entities.get('system/sol')?.origin).toBe('builtin')
    expect(w.entities.get('body/earth')?.origin).toBe('builtin')
    expect([...w.entities.values()].filter((e) => e.origin === 'builtin')).toHaveLength(solarSystem().length)
    // Built-ins are canonical and pass the checks like files would.
    const errors = runChecks(w, nodeEnv).filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it('lets a file stand in for a built-in, and finds files that change nothing', () => {
    const earth = solarSystem().find((f) => f.id === 'earth')!
    const same = { path: 'bodies/earth.json', text: serializeEntity(bodyKind, earth.value as never) }
    const changed = json('bodies/mars.json', { ...(solarSystem().find((f) => f.id === 'mars')!.value as object), name: 'Barsoom' })
    const files = [...base(), same, changed]
    const w = read(files)
    expect(w.entities.get('body/earth')?.origin).toBe('override')
    expect(w.entities.get('body/mars')?.origin).toBe('override')
    expect((w.entities.get('body/mars')?.value as { name: string }).name).toBe('Barsoom')
    expect(redundantBuiltinFiles(w, fileMap(files))).toEqual([{ path: 'bodies/earth.json', text: null }])
  })

  it('keeps a note on a built-in without a file for it', () => {
    const w = read([...base(), { path: 'bodies/earth.md', text: 'Home.\n' }])
    expect(w.issues.filter((i) => i.code === 'orphan-note')).toEqual([])
    expect(w.entities.get('body/earth')?.origin).toBe('builtin')
  })

  it('hides a deleted built-in, and brings it back', () => {
    const w = read(base())
    const hide = hideBuiltins(w, ['body/pluto', 'culture/nope'])!
    expect(hide.path).toBe('settings/builtins.json')
    const after = read(apply(base(), [hide]))
    expect(after.entities.has('body/pluto')).toBe(false)
    expect(after.entities.has('body/earth')).toBe(true)
    const back = changeBuiltins(after, { unhide: () => true })!
    expect(back).toEqual({ path: 'settings/builtins.json', text: null })
  })

  it('drops the Solar System when it is turned off or its system is deleted', () => {
    const off = read(apply(base(), [changeBuiltins(read(base()), { solarSystem: false })!]))
    expect([...off.entities.values()].some((e) => e.origin)).toBe(false)
    const gone = read(apply(base(), [hideBuiltins(read(base()), ['system/sol'])!]))
    expect(gone.entities.has('body/earth')).toBe(false)
  })

  it('puts the known planets in a system made on their star', () => {
    const files = [...base(), json('systems/proxima.json', { name: 'Proxima', star: 'hip.70890' })]
    const w = read(files)
    expect(w.entities.get('body/proxima-b')?.origin).toBe('builtin')
    expect((w.entities.get('body/proxima-b')?.value as { system: string }).system).toBe('proxima')
    // Candidates only when asked.
    expect(w.entities.has('body/proxima-c')).toBe(false)
    const withC = read(apply(files, [changeBuiltins(w, { candidates: true })!]))
    expect(withC.entities.has('body/proxima-c')).toBe(true)
  })

  it('renames a built-in by writing it under its new id and hiding the old one', () => {
    const files = base()
    const w = read(files)
    const plan = renamePlan(w, fileMap(files), bodyKind, 'earth', 'terra')
    if ('error' in plan) throw new Error(plan.error)
    const after = read(apply(files, plan.changes))
    expect(after.entities.has('body/earth')).toBe(false)
    expect(after.entities.get('body/terra')?.origin).toBeUndefined()
    // The Moon (a built-in that refers to Earth) gets a file of its own pointing at the new id.
    expect((after.entities.get('body/moon')?.value as { parent: string }).parent).toBe('terra')
    expect(after.entities.get('body/moon')?.origin).toBe('override')
  })

  it("renames Sol's system without writing every body: they follow the system on the Sun", () => {
    const files = base()
    const w = read(files)
    const plan = renamePlan(w, fileMap(files), systemKind, 'sol', 'home')
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.changes.map((c) => c.path).sort()).toEqual(['settings/builtins.json', 'systems/home.json'])
    const after = read(apply(files, plan.changes))
    expect((after.entities.get('body/earth')?.value as { system: string }).system).toBe('home')
    expect(after.entities.get('body/earth')?.origin).toBe('builtin')
    expect(after.entities.has('system/sol')).toBe(false)
  })
})
