import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '@malevo/cli'
import { createWorld } from '@malevo/model/node'

let tmp: string
const lines: string[] = []
const io = (): { out: (l: string) => void; err: (l: string) => void; cwd: string } => ({
  out: (l) => lines.push(l),
  err: (l) => lines.push(`ERR ${l}`),
  cwd: tmp
})

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-cli-'))
  lines.length = 0
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('malevo check', () => {
  it('passes a new world, run from inside it', async () => {
    await createWorld(tmp, 'CLI World', 3)
    expect(await run(['check'], io())).toBe(0)
    expect(lines).toEqual([`Checking CLI World (${tmp})`, 'No problems found.'])
  })

  it('reports errors with exit status 1, and fixes only layout with --fix', async () => {
    await createWorld(path.join(tmp, 'w'), 'W', 3)
    await fs.writeFile(path.join(tmp, 'w', 'calendars', 'gregorian.json'), '{"kind":"gregorian","name":"G"}')
    await fs.writeFile(path.join(tmp, 'w', 'calendars', 'local.json'), '{"name":"L","kind":"offset","base":"missing","offset_s":60}')
    expect(await run(['check', 'w'], io())).toBe(1)
    expect(lines.join('\n')).toContain(
      'error    calendars/local.json › base: Refers to calendar "missing", which does not exist. [references/dangling-ref]'
    )
    expect(lines.at(-1)).toBe('2 errors, 0 warnings, 2 notes.')

    lines.length = 0
    expect(await run(['check', 'w', '--fix', '--json'], io())).toBe(1)
    const report = JSON.parse(lines.join('\n'))
    expect(report.fixed).toEqual(['calendars/gregorian.json', 'calendars/local.json'])
    expect(report.issues.map((i: { code: string }) => i.code)).toEqual(['bad-calendar', 'dangling-ref'])
    expect(JSON.parse(await fs.readFile(path.join(tmp, 'w', 'calendars', 'gregorian.json'), 'utf8'))).toEqual({
      name: 'G',
      kind: 'gregorian'
    })
  })

  it('refuses a folder that is not a world, and bad arguments, with status 2', async () => {
    expect(await run(['check'], io())).toBe(2)
    expect(lines[0]).toMatch(/^ERR .*world\.json/)
    expect(await run(['check', 'nowhere'], io())).toBe(2)
    expect(lines.at(-1)).toBe(`ERR ${path.join(tmp, 'nowhere')} does not exist.`)
    expect(await run(['check', '--frobnicate'], io())).toBe(2)
    expect(await run(['launch'], io())).toBe(2)
    expect(await run([], io())).toBe(2)
    expect(await run(['help'], io())).toBe(0)
  })
})

describe('malevo template', () => {
  it('adds missing template files only', async () => {
    await createWorld(tmp, 'T', 1)
    await fs.rm(path.join(tmp, 'settings'), { recursive: true })
    expect(await run(['template', '.'], io())).toBe(0)
    expect(lines).toEqual(['added settings/physics.json'])
    lines.length = 0
    expect(await run(['template'], io())).toBe(0)
    expect(lines).toEqual(['The world already has every template file.'])
  })
})
