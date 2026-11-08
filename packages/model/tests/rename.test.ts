import { describe, expect, it } from 'vitest'
import {
  bodyKind,
  newTerrain,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  systemKind,
  templateFiles,
  type WorldFile
} from '@malevo/model'
import { fieldPath, renamePlan } from '@malevo/model/node'

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const files = (): WorldFile[] => [
  { path: 'world.json', text: '{"format": 1, "name": "R", "seed": 2}' },
  ...templateFiles(),
  ...sol(),
  { path: 'bodies/earth.md', text: 'Notes about Earth.\n' },
  json('terrains/earth.json', newTerrain('earth', 'rocky')),
  json('cities/bluff.json', { name: 'Bluff', body: 'earth', lat_deg: 10, lon_deg: 20 })
]
/** Apply a plan's changes to a file list. */
const apply = (list: WorldFile[], changes: { path: string; text: string | null }[]): WorldFile[] => {
  const m = new Map(list.map((f) => [f.path, f.text]))
  for (const c of changes) {
    if (c.text === null) m.delete(c.path)
    else m.set(c.path, c.text)
  }
  return [...m].map(([p, text]) => ({ path: p, text }))
}

describe('renaming an entity', () => {
  it('reads field paths', () => {
    expect(fieldPath('waypoints[2].system')).toEqual(['waypoints', 2, 'system'])
    expect(fieldPath('body')).toEqual(['body'])
  })

  it('moves the files, the same-named terrain, and rewrites every reference', () => {
    const before = files()
    const w = readWorld(before)
    const plan = renamePlan(w, new Map(before.map((f) => [f.path, f.text])), bodyKind, 'earth', 'altaris')
    if ('error' in plan) throw new Error(plan.error)
    const after = apply(before, plan.changes)
    const paths = new Set(after.map((f) => f.path))
    expect(paths.has('bodies/altaris.json') && paths.has('bodies/altaris.md') && !paths.has('bodies/earth.json')).toBe(true)
    expect(paths.has('terrains/altaris.json') && !paths.has('terrains/earth.json')).toBe(true)
    const w2 = readWorld(after)
    expect((w2.entities.get('city/bluff')?.value as { body: string }).body).toBe('altaris')
    expect((w2.entities.get('terrain/altaris')?.value as { body: string }).body).toBe('altaris')
    // The Moon orbits it, and a calendar may count its days: nothing still points at "earth".
    for (const e of w2.entities.values()) expect(e.refs.some((r) => r.kind === 'body' && r.id === 'earth')).toBe(false)
    expect(plan.updated).toContain('city/bluff')
    const problems = runChecks(w2).filter((i) => /earth/.test(i.message))
    expect(problems).toEqual([])
  })

  it('refuses ids that are taken or malformed', () => {
    const f = files()
    const m = new Map(f.map((x) => [x.path, x.text]))
    const w = readWorld(f)
    expect(renamePlan(w, m, bodyKind, 'earth', 'mars')).toMatchObject({ error: expect.stringMatching(/already/) })
    expect(renamePlan(w, m, bodyKind, 'earth', 'Not An Id')).toMatchObject({ error: expect.stringMatching(/can't be an id/) })
    expect(renamePlan(w, m, systemKind, 'nowhere', 'x')).toMatchObject({ error: expect.stringMatching(/no system/) })
  })
})
