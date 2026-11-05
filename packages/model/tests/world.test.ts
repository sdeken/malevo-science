import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WORLD_FORMAT,
  WorldError,
  newWorldManifest,
  parseWorldManifest,
  serializeWorldManifest,
  solarSystem,
  templateFiles
} from '@malevo/model'
import { createWorld, inspectFolder, openWorld } from '@malevo/model/node'

describe('world.json', () => {
  it('serializes canonically: schema key order, two-space indent, LF, trailing newline', () => {
    const text = serializeWorldManifest(newWorldManifest('  Scratch   world ', 2718281828))
    expect(text).toBe('{\n  "format": 1,\n  "name": "Scratch world",\n  "seed": 2718281828\n}\n')
  })

  it('round-trips, keeping unknown keys after the known ones', () => {
    const text = '{\n  "notes": "hand edit",\n  "seed": 7,\n  "name": "W",\n  "format": 1\n}\n'
    const manifest = parseWorldManifest(text)
    expect(manifest.extra).toEqual({ notes: 'hand edit' })
    expect(serializeWorldManifest(manifest)).toBe('{\n  "format": 1,\n  "name": "W",\n  "seed": 7,\n  "notes": "hand edit"\n}\n')
  })

  it('refuses formats it does not understand, older or newer', () => {
    const code = (text: string): string | undefined => {
      try {
        parseWorldManifest(text)
      } catch (err) {
        return (err as WorldError).code
      }
    }
    expect(code(`{"format": ${WORLD_FORMAT + 1}, "name": "W", "seed": 1}`)).toBe('format-too-new')
    expect(code('{"format": 0, "name": "W", "seed": 1}')).toBe('invalid-manifest')
    expect(code('{"name": "W", "seed": 1}')).toBe('invalid-manifest')
    expect(code('not json')).toBe('invalid-json')
    expect(code('[]')).toBe('invalid-manifest')
  })

  it('validates name and seed', () => {
    expect(() => newWorldManifest('   ', 1)).toThrow(WorldError)
    expect(() => newWorldManifest('W', -1)).toThrow(WorldError)
    expect(() => newWorldManifest('W', 2 ** 32)).toThrow(WorldError)
    expect(() => newWorldManifest('W', 1.5)).toThrow(WorldError)
    expect(() => parseWorldManifest('{"format": 1, "name": "W", "seed": "12"}')).toThrow(WorldError)
  })
})

describe('world folders', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-model-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('creates a world holding world.json and the new-world template, nothing else', async () => {
    const dir = path.join(tmp, 'new', 'world')
    const world = await createWorld(dir, 'Scratch', 42)
    expect(world.manifest.seed).toBe(42)
    expect((await fs.readdir(dir)).sort()).toEqual(['bodies', 'calendars', 'settings', 'systems', 'world.json'])
    // The real Solar System comes with every new world.
    expect(await fs.readdir(path.join(dir, 'systems'))).toEqual(['sol.json'])
    expect((await fs.readdir(path.join(dir, 'bodies'))).length).toBe(solarSystem().length - 1)
    expect((await fs.readdir(path.join(dir, 'settings'))).sort()).toEqual(
      templateFiles()
        .map((f) => f.path)
        .filter((p) => p.startsWith('settings/'))
        .map((p) => p.slice('settings/'.length))
        .sort()
    )
    expect(await fs.readdir(path.join(dir, 'calendars'))).toEqual(['gregorian.json'])
    expect((await openWorld(dir)).manifest.name).toBe('Scratch')
  })

  it('creates into an empty folder but refuses a non-empty one or an existing world', async () => {
    await createWorld(tmp, 'Here', 1)
    await expect(createWorld(tmp, 'Again', 2)).rejects.toMatchObject({ code: 'not-empty' })
    const other = path.join(tmp, 'other')
    await fs.mkdir(other)
    await fs.writeFile(path.join(other, 'notes.txt'), 'x')
    await expect(createWorld(other, 'W', 3)).rejects.toMatchObject({ code: 'not-empty' })
  })

  it('opening never writes', async () => {
    await createWorld(tmp, 'W', 9)
    const file = path.join(tmp, 'world.json')
    const before = await fs.stat(file)
    const text = await fs.readFile(file, 'utf8')
    await openWorld(tmp)
    await inspectFolder(tmp)
    const after = await fs.stat(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(await fs.readFile(file, 'utf8')).toBe(text)
    expect((await fs.readdir(tmp)).sort()).toEqual(['bodies', 'calendars', 'settings', 'systems', 'world.json'])
  })

  it('reports what a folder is', async () => {
    expect((await inspectFolder(path.join(tmp, 'nope'))).kind).toBe('missing')
    expect((await inspectFolder(tmp)).kind).toBe('empty')
    await fs.writeFile(path.join(tmp, 'readme.txt'), 'x')
    expect((await inspectFolder(tmp)).kind).toBe('not-a-world')
    await fs.writeFile(path.join(tmp, 'world.json'), '{"format": 99, "name": "W", "seed": 1}')
    const found = await inspectFolder(tmp)
    expect(found.kind).toBe('invalid')
    expect(found.kind === 'invalid' && found.error.code).toBe('format-too-new')
    await expect(openWorld(tmp)).rejects.toMatchObject({ code: 'format-too-new' })
    await expect(openWorld(path.join(tmp, 'nope'))).rejects.toMatchObject({ code: 'not-a-world' })
  })
})
