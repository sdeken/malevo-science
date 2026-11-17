import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyKind, systemKind } from '@malevo/model'
import { createWorld } from '@malevo/model/node'
import * as vscode from 'vscode'
import { VsEditor } from '../src/host/editor'

const fake = vscode as unknown as typeof import('./fake-vscode')

let root: string
beforeEach(async () => {
  fake.reset()
  root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-vs-')), 'w')
  await createWorld(root, 'W', 1)
})

describe("the extension's editor, over VS Code's documents", () => {
  it('makes edits as unsaved documents, seen at once, written only by Save', async () => {
    let applied = 0
    const ed = new VsEditor(root, () => applied++)
    await ed.load()
    ed.setEntity(systemKind, 'altaris', { name: 'Altaris', spect: 'K1V' })
    // Seen at once, before VS Code has it.
    expect(ed.world().entities.get('system/altaris')?.value).toMatchObject({ name: 'Altaris' })
    await ed.settled()
    expect(applied).toBe(1)
    expect(ed.dirty).toEqual(['systems/altaris.json'])
    await expect(fs.access(path.join(root, 'systems/altaris.json'))).rejects.toThrow()
    await ed.save()
    expect(JSON.parse(await fs.readFile(path.join(root, 'systems/altaris.json'), 'utf8')).spect).toBe('K1V')
    expect(ed.dirty).toEqual([])
  })

  it('edits an existing file through its document, and deletes files', async () => {
    const ed = new VsEditor(root, () => {})
    await ed.load()
    ed.setEntity(systemKind, 'altaris', { name: 'Altaris', spect: 'K1V' })
    await ed.settled()
    await ed.save()
    await ed.load()
    ed.setEntity(systemKind, 'altaris', { name: 'Altaris', spect: 'K2V' })
    await ed.settled()
    expect((ed.world().entities.get('system/altaris')?.value as { spect: string }).spect).toBe('K2V')
    expect(ed.dirty).toEqual(['systems/altaris.json'])
    ed.edit([{ path: 'systems/altaris.json', text: null }])
    expect(ed.world().entities.has('system/altaris')).toBe(false)
    await ed.settled()
    await ed.load()
    expect(ed.world().entities.has('system/altaris')).toBe(false)
    await expect(fs.access(path.join(root, 'systems/altaris.json'))).rejects.toThrow()
  })

  it('refuses paths outside the world format', async () => {
    const ed = new VsEditor(root, () => {})
    await ed.load()
    expect(() => ed.edit([{ path: 'notes/x.txt', text: 'x' }])).toThrow()
    expect(() => ed.setEntity(bodyKind, 'b', { name: 'B' } as never)).not.toThrow()
  })
})
