import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAY, buildCalendars, formatInstant } from '@malevo/core'
import {
  KINDS,
  arr,
  calendarDefs,
  calendarKind,
  canonicalFixes,
  canonicalJson,
  contentHash,
  dependencyGraph,
  dict,
  entitiesOf,
  extrasOf,
  foamSettings,
  lockSchema,
  num,
  obj,
  oneOf,
  opt,
  parseWith,
  physicsKind,
  readWorld,
  ref,
  roundForFile,
  runChecks,
  str,
  tagged,
  templateFiles,
  type KindDef,
  type WorldFile
} from '@malevo/model'
import { addMissingTemplateFiles, applyFixes, createWorld, loadWorld, saveEntity } from '@malevo/model/node'

describe('schemas', () => {
  const thing = obj({
    name: str({ min: 1 }),
    mass_kg: num({ sig: 4, above: 0 }),
    pos_au: arr(num({ sig: 6 }), { min: 3, max: 3 }),
    kind: oneOf(['rock', 'ice']),
    parent: opt(ref('thing')),
    tags: opt(dict(num()))
  })

  it('parses, collects references and reports problems with paths', () => {
    const ok = parseWith(thing, { name: 'A', mass_kg: 1.23456, pos_au: [1, 2, 3], kind: 'rock', parent: 'b-1' })
    expect(ok.issues).toEqual([])
    expect(ok.refs).toEqual([{ kind: 'thing', id: 'b-1', field: 'parent' }])
    const bad = parseWith(thing, { name: '', mass_kg: -1, pos_au: [1, 'x'], kind: 'gas', parent: 'Not An Id' })
    expect(bad.value).toBeUndefined()
    expect(bad.issues.map((i) => i.field)).toEqual(['name', 'mass_kg', 'pos_au', 'kind', 'parent'])
    expect(parseWith(thing, { name: 'A' }).issues.map((i) => i.message)).toContain('"mass_kg" is missing.')
  })

  it('writes keys in schema order and rounds to the declared precision', () => {
    const parsed = parseWith(thing, {
      tags: { b: 2, a: 1 },
      kind: 'ice',
      pos_au: [0.1 + 0.2, -0, 1 / 3],
      mass_kg: 5.972168e24,
      name: 'Ball'
    }).value!
    expect(canonicalJson(thing.toJson(parsed))).toBe(
      '{\n  "name": "Ball",\n  "mass_kg": 5.972e+24,\n  "pos_au": [0.3, 0, 0.333333],\n  "kind": "ice",\n  "tags": {\n    "a": 1,\n    "b": 2\n  }\n}\n'
    )
    expect(roundForFile(123456789, 3)).toBe(123456789) // integers are exact
    expect(roundForFile(-0, 3)).toBe(0)
  })

  it('keeps unknown keys, after the known ones, and says so', () => {
    const parsed = parseWith(thing, { zeta: [1], name: 'A', mass_kg: 1, pos_au: [0, 0, 0], kind: 'rock', alpha: true })
    expect(parsed.issues.map((i) => [i.severity, i.code, i.field])).toEqual([
      ['info', 'unknown-field', 'zeta'],
      ['info', 'unknown-field', 'alpha']
    ])
    expect(extrasOf(parsed.value!)).toEqual({ zeta: [1], alpha: true })
    expect(Object.keys(thing.toJson(parsed.value!) as object)).toEqual(['name', 'mass_kg', 'pos_au', 'kind', 'zeta', 'alpha'])
    expect(JSON.stringify(parsed.value)).not.toContain('zeta') // extras never leak into the value itself
  })

  it('tells tagged variants apart', () => {
    const shape = tagged('kind', { a: obj({ kind: oneOf(['a']), x: num() }), b: obj({ kind: oneOf(['b']), y: str() }) })
    expect(parseWith(shape, { kind: 'b', y: 'hi' }).value).toEqual({ kind: 'b', y: 'hi' })
    expect(parseWith(shape, { kind: 'c' }).issues[0].field).toBe('kind')
  })
})

describe('canonical JSON', () => {
  it('lays out arrays by what they hold and how long they are', () => {
    expect(
      canonicalJson({
        a: [],
        b: {},
        c: [
          [1, 2],
          [3, 4]
        ],
        d: Array.from({ length: 40 }, (_, i) => i * 1000)
      })
    ).toBe(
      `{\n  "a": [],\n  "b": {},\n  "c": [\n    [1, 2],\n    [3, 4]\n  ],\n  "d": [\n${Array.from({ length: 40 }, (_, i) => `    ${i * 1000}`).join(',\n')}\n  ]\n}\n`
    )
    expect(() => canonicalJson({ x: NaN })).toThrow()
  })

  it('is stable: canonical text parses back to text that is identical', () => {
    for (const f of templateFiles()) {
      expect(canonicalJson(JSON.parse(f.text))).toBe(f.text)
    }
  })
})

// A test-only kind that references calendars and can be locked.
const noteKind: KindDef = {
  kind: 'note',
  label: 'note',
  folder: 'notes',
  schema: obj({ name: str({ min: 1 }), calendar: opt(ref('calendar')), lock: opt(lockSchema) })
}
const kinds = [...KINDS, noteKind]

function worldFiles(extra: WorldFile[] = []): WorldFile[] {
  return [{ path: 'world.json', text: '{"format": 1, "name": "T", "seed": 1}' }, ...templateFiles(), ...extra]
}

describe('reading a world', () => {
  it('reads the template cleanly', () => {
    const world = readWorld(worldFiles())
    expect(world.issues).toEqual([])
    expect([...world.entities.keys()].sort()).toEqual(['calendar/gregorian', 'physics'])
    expect(runChecks(world)).toEqual([])
    const foam = foamSettings(world.entities.get('physics')!.value as never)
    expect(foam.rule).toBe('max-eigen')
  })

  it('reports bad JSON, schema errors, bad ids and stray files, and ignores files outside the format', () => {
    const world = readWorld(
      worldFiles([
        { path: 'calendars/broken.json', text: '{ nope' },
        { path: 'calendars/wrong.json', text: '{"name": "W", "kind": "lunar"}' },
        { path: 'calendars/Bad Id.json', text: '{}' },
        { path: 'calendars/picture.png', text: null },
        { path: 'calendars/gregorian.md', text: '# notes' },
        { path: 'calendars/lonely.md', text: '# orphan' },
        { path: 'settings/other.json', text: '{}' },
        { path: 'README.md', text: '# my world' },
        { path: 'drafts/idea.json', text: '{}' }
      ])
    )
    const codes = world.issues.map((i) => `${i.path} ${i.code}`)
    expect(codes).toEqual([
      'calendars/Bad Id.json bad-id',
      'calendars/broken.json invalid-json',
      'calendars/lonely.md orphan-note',
      'calendars/picture.png unexpected-file',
      'calendars/wrong.json schema',
      'settings/other.json unexpected-file'
    ])
    expect(world.ignored).toEqual(['README.md', 'drafts/idea.json'])
  })

  it('refuses a missing or future world.json as an issue, not an exception', () => {
    expect(readWorld([]).issues[0].code).toBe('no-manifest')
    expect(readWorld([{ path: 'world.json', text: '{"format": 9, "name": "F", "seed": 1}' }]).issues[0].code).toBe('format-too-new')
  })
})

describe('checks', () => {
  it('finds dangling references', () => {
    const world = readWorld(worldFiles([{ path: 'notes/a.json', text: '{"name": "A", "calendar": "nope"}' }]), kinds)
    const issues = runChecks(world).filter((i) => i.severity !== 'info')
    expect(issues.map((i) => [i.code, i.path, i.field])).toEqual([['dangling-ref', 'notes/a.json', 'calendar']])
  })

  it('reports missing physics settings', () => {
    const world = readWorld(worldFiles().filter((f) => f.path !== 'settings/physics.json'))
    expect(runChecks(world).map((i) => i.code)).toEqual(['no-physics'])
  })

  it('reports calendars that cannot be built, and dates that no longer read as entered', () => {
    const t = 1000 * DAY
    const greg = buildCalendars({ g: { kind: 'gregorian' } }).get('g')!
    const entered = formatInstant(greg, t)
    const local = (epochText: string): string =>
      JSON.stringify({
        name: 'Local',
        kind: 'fixed',
        epoch: { t_s: t, cal: 'gregorian', text: epochText },
        epochYear: 1,
        units: [{ name: 'year' }, { name: 'day', per: 400 }],
        smallestUnit_s: DAY
      })
    const good = readWorld(worldFiles([{ path: 'calendars/local.json', text: local(entered) }]))
    expect(runChecks(good).filter((i) => i.severity !== 'info')).toEqual([])
    expect(Object.keys(calendarDefs(good)).sort()).toEqual(['gregorian', 'local'])

    const drifted = readWorld(worldFiles([{ path: 'calendars/local.json', text: local('2002-09-28 12:00') }]))
    const issue = runChecks(drifted).find((i) => i.code === 'entered-text-drift')!
    expect(issue.message).toContain(`now writes the stored time as "${formatInstant(greg, t, 'second')}"`)

    const cyclic = readWorld(
      worldFiles([
        { path: 'calendars/a.json', text: '{"name": "A", "kind": "offset", "base": "b", "offset_s": 1}' },
        { path: 'calendars/b.json', text: '{"name": "B", "kind": "offset", "base": "a", "offset_s": 1}' }
      ])
    )
    expect(
      runChecks(cyclic)
        .filter((i) => i.code === 'bad-calendar')
        .map((i) => i.path)
    ).toEqual(['calendars/a.json', 'calendars/b.json'])
  })

  it('flags files that are not canonical, and fixes only their layout', () => {
    const messy = '{"kind":"gregorian","name":"Gregorian"}'
    const world = readWorld(worldFiles().map((f) => (f.path === 'calendars/gregorian.json' ? { ...f, text: messy } : f)))
    expect(runChecks(world).map((i) => [i.severity, i.code])).toEqual([['info', 'not-canonical']])
    const fixes = canonicalFixes(world)
    expect(fixes).toEqual([{ path: 'calendars/gregorian.json', text: '{\n  "name": "Gregorian",\n  "kind": "gregorian"\n}\n' }])
    expect(JSON.parse(fixes[0].text)).toEqual(JSON.parse(messy))
  })
})

describe('dependencies and staleness', () => {
  const build = (lockHash: string): ReturnType<typeof readWorld> => {
    const files = worldFiles([
      {
        path: 'calendars/era.json',
        text: '{"name": "E", "kind": "era", "base": "gregorian", "epochYear": 2500, "firstYear": 0, "direction": "forward", "prefix": "E ", "suffix": ""}'
      },
      {
        path: 'notes/a.json',
        text: JSON.stringify({ name: 'A', calendar: 'era', lock: { gen: 'notes@1', inputs: { physics: lockHash } } })
      }
    ])
    return readWorld(files, kinds)
  }

  it('builds the graph from references and lock inputs', () => {
    const world = build('0'.repeat(14))
    const g = dependencyGraph(world)
    expect(g.dependsOn('note/a')).toEqual(['calendar/era', 'physics'])
    expect(g.dependents('calendar/gregorian')).toEqual(['calendar/era'])
    expect(g.affectedBy('calendar/gregorian')).toEqual(['calendar/era', 'note/a'])
    expect(g.affectedBy('physics')).toEqual(['note/a'])
    expect(g.affectedBy('note/a')).toEqual([])
  })

  it('flags locks whose inputs changed, and not those whose inputs did not', () => {
    const physicsHash = readWorld(worldFiles()).entities.get('physics')!.hash
    expect(runChecks(build(physicsHash)).filter((i) => i.check === 'locks')).toEqual([])
    const stale = runChecks(build('0'.repeat(14))).filter((i) => i.check === 'locks')
    expect(stale.map((i) => [i.code, i.path])).toEqual([['stale-lock', 'notes/a.json']])
  })

  it('hashes the canonical text, so layout-only edits never make a lock stale', () => {
    const a = readWorld(worldFiles()).entities.get('calendar/gregorian')!.hash
    const b = readWorld(
      worldFiles().map((f) => (f.path === 'calendars/gregorian.json' ? { ...f, text: '{"kind":"gregorian","name":"Gregorian"}' } : f))
    ).entities.get('calendar/gregorian')!.hash
    expect(a).toBe(b)
    expect(contentHash('a')).not.toBe(contentHash('b'))
    expect(contentHash('a')).toMatch(/^[0-9a-f]{14}$/)
  })
})

describe('world folders on disk', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-model2-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('loads a new world with no issues at all', async () => {
    await createWorld(tmp, 'New', 7)
    const world = await loadWorld(tmp)
    expect(runChecks(world)).toEqual([])
    expect(entitiesOf(world, calendarKind).map((e) => e.id)).toEqual(['gregorian'])
    expect(entitiesOf(world, physicsKind)[0].value.foam.loadRule).toBe('max-eigen')
  })

  it('skips dot folders, and writes only what changed', async () => {
    await createWorld(tmp, 'New', 7)
    await fs.mkdir(path.join(tmp, '.git'))
    await fs.writeFile(path.join(tmp, '.git', 'config'), 'x')
    expect((await loadWorld(tmp)).ignored).toEqual([])

    const file = path.join(tmp, 'calendars', 'gregorian.json')
    const before = (await fs.stat(file)).mtimeMs
    expect(await saveEntity(tmp, calendarKind, 'gregorian', { name: 'Gregorian', kind: 'gregorian' })).toBe(false)
    expect((await fs.stat(file)).mtimeMs).toBe(before)
    expect(await saveEntity(tmp, calendarKind, 'gregorian', { name: 'Earth', kind: 'gregorian' })).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe('{\n  "name": "Earth",\n  "kind": "gregorian"\n}\n')
  })

  it('applies format fixes, and adds missing template files without touching existing ones', async () => {
    await createWorld(tmp, 'New', 7)
    await fs.writeFile(path.join(tmp, 'calendars', 'gregorian.json'), '{"kind":"gregorian","name":"Mine"}')
    await fs.rm(path.join(tmp, 'settings'), { recursive: true })
    const changed = await applyFixes(tmp, canonicalFixes(await loadWorld(tmp)))
    expect(changed).toEqual(['calendars/gregorian.json'])
    expect(await applyFixes(tmp, canonicalFixes(await loadWorld(tmp)))).toEqual([])
    expect(await addMissingTemplateFiles(tmp)).toEqual(['settings/physics.json'])
    expect(await addMissingTemplateFiles(tmp)).toEqual([])
    expect(JSON.parse(await fs.readFile(path.join(tmp, 'calendars', 'gregorian.json'), 'utf8')).name).toBe('Mine')
    expect(runChecks(await loadWorld(tmp))).toEqual([])
  })
})
