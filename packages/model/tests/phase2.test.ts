import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAY, buildCalendars, formatInstant, mulberry32, parseInstant } from '@malevo/core'
import {
  compareWorlds,
  eventKind,
  readWorld,
  resolveEvents,
  runChecks,
  templateFiles,
  worldCalendars,
  type EventFile,
  type WorldFile
} from '@malevo/model'
import { WorldEditor, createWorld, loadWorld, nodeEnv, sandboxedCalendar } from '@malevo/model/node'

const greg = buildCalendars({ g: { kind: 'gregorian' } }).get('g')!
const at = (text: string): number => parseInstant(greg, text)!

const files = (extra: WorldFile[]): WorldFile[] => [
  { path: 'world.json', text: '{"format": 1, "name": "T", "seed": 1}' },
  ...templateFiles(),
  ...extra
]
const ev = (id: string, value: EventFile): WorldFile => ({ path: `events/${id}.json`, text: JSON.stringify(value) })
const atGreg = (text: string): EventFile['when'] => ({ at: { t_s: at(text), cal: 'gregorian', text } })

describe('event resolution', () => {
  const world = readWorld(
    files([
      ev('charter', { name: 'Charter', type: 'event', when: atGreg('2700-06') }),
      ev('founding', { name: 'Founding', type: 'event', when: { after: 'charter', cal: 'gregorian', offset: { year: 130 } } }),
      ev('later', { name: 'Later', type: 'event', when: { after: 'founding', offset_s: 3 * DAY, precision: 'day', cal: 'gregorian' } }),
      ev('boom', {
        name: 'Boom',
        type: 'period',
        when: { after: 'founding' },
        until: { after: 'founding', cal: 'gregorian', offset: { year: 70 }, circa: true }
      }),
      ev('after-boom', {
        name: 'After the boom',
        type: 'event',
        when: { after: 'boom', from: 'end', cal: 'gregorian', offset: { month: 1 } }
      }),
      ev('loop-a', { name: 'A', type: 'event', when: { after: 'loop-b' } }),
      ev('loop-b', { name: 'B', type: 'event', when: { after: 'loop-a' } }),
      ev('orphan', { name: 'Orphan', type: 'event', when: { after: 'nobody' } }),
      ev('both', { name: 'Both', type: 'event', when: { ...atGreg('2700'), after: 'charter' } }),
      ev('badunit', { name: 'Bad unit', type: 'event', when: { after: 'charter', cal: 'gregorian', offset: { fortnight: 2 } } }),
      ev('story', { name: 'A story', type: 'story', when: atGreg('2900-01-01') }),
      ev('lasting', {
        name: 'Lasting',
        type: 'period',
        when: atGreg('2800'),
        until: { after: 'lasting', cal: 'gregorian', offset: { year: 70 } }
      }),
      ev('selfish', { name: 'Selfish', type: 'event', when: { after: 'selfish' } })
    ])
  )
  const cals = worldCalendars(world, nodeEnv)
  const r = resolveEvents(world, cals)

  it('resolves instants and infers their precision from the entered text', () => {
    const c = r.get('charter')!
    expect(c.errors).toEqual([])
    expect(c.start!.t).toBe(at('2700-06'))
    expect(c.start!.precision).toBe('month')
    expect(c.start!.range).toEqual([at('2700-06'), at('2700-07')])
  })

  it('anchors with calendar-unit offsets, exact offsets, and ends', () => {
    expect(formatInstant(greg, r.get('founding')!.start!.t)).toBe('2830-06-01 00:00')
    expect(r.get('founding')!.start!.precision).toBe('month') // inherited from the anchor
    expect(formatInstant(greg, r.get('later')!.start!.t)).toBe('2830-06-04 00:00')
    expect(r.get('later')!.start!.precision).toBe('day')
    const boom = r.get('boom')!
    expect(formatInstant(greg, boom.end!.t, 'month')).toBe('2900-06')
    expect(boom.end!.circa).toBe(true)
    expect(formatInstant(greg, r.get('after-boom')!.start!.t, 'month')).toBe('2900-07')
    expect(r.get('after-boom')!.start!.circa).toBe(true) // uncertainty carries through anchors
  })

  it('reports cycles, missing anchors, ambiguous dates and unknown units on the event, not as exceptions', () => {
    expect(r.get('loop-a')!.errors[0]).toMatch(/cycle/)
    expect(r.get('loop-b')!.errors[0]).toMatch(/cycle|no start/)
    expect(r.get('orphan')!.errors[0]).toMatch(/does not exist/)
    expect(r.get('both')!.errors[0]).toMatch(/either "at"/)
    expect(r.get('badunit')!.errors[0]).toMatch(/no unit "fortnight"/)
    expect(r.get('story')!.warnings[0]).toMatch(/usually has an "until"/)
    expect(formatInstant(greg, r.get('lasting')!.end!.t, 'year')).toBe('2870') // an end measured from its own start
    expect(r.get('lasting')!.errors).toEqual([])
    expect(r.get('selfish')!.errors[0]).toMatch(/only measure its end from its own start/)
  })

  it('moves everything anchored when the anchor moves', () => {
    const moved = readWorld(
      world.entities.get('event/charter')
        ? files([
            ...[...world.entities.values()]
              .filter((e) => e.kind.kind === 'event' && e.id !== 'charter')
              .map((e) => ({ path: e.path, text: e.text })),
            ev('charter', { name: 'Charter', type: 'event', when: atGreg('2750-06') })
          ])
        : []
    )
    const r2 = resolveEvents(moved, worldCalendars(moved, nodeEnv))
    expect(formatInstant(greg, r2.get('founding')!.start!.t, 'month')).toBe('2880-06')
    expect(formatInstant(greg, r2.get('after-boom')!.start!.t, 'month')).toBe('2950-07')
  })

  it('surfaces all of it through the checks', () => {
    const codes = runChecks(world, nodeEnv).map((i) => `${i.path} ${i.code}`)
    expect(codes).toContain('events/loop-a.json unresolved-event')
    expect(codes).toContain('events/orphan.json dangling-ref')
    expect(codes).toContain('events/story.json event-span')
  })
})

describe('the script calendar sandbox', () => {
  const tenDay = `
    module.exports = {
      toFields(t, h) {
        const days = Math.floor(t / h.DAY), cycle = h.floorDiv(days, 360), inYear = days - cycle * 360
        return { cycle, week: Math.floor(inYear / 10) + 1, day: (inYear % 10) + 1 + (t / h.DAY - days) } // the smallest unit carries the fraction
      },
      fromFields(f, h) { return (f.cycle * 360 + (f.week - 1) * 10 + (f.day - 1)) * h.DAY },
      yearLabel(y) { return 'C' + y },
      parseYearLabel(s) { return /^C-?\\d+$/.test(s) ? Number(s.slice(1)) : null }
    }`

  it('runs a script calendar end to end through the world', () => {
    const world = readWorld(
      files([
        {
          path: 'calendars/ten.json',
          text: '{"name": "Ten", "kind": "script", "units": [{"name": "cycle"}, {"name": "week"}, {"name": "day"}]}'
        },
        { path: 'calendars/ten.js', text: tenDay },
        ev('e', { name: 'E', type: 'event', when: { at: { t_s: 400 * DAY, cal: 'ten', text: 'C1-05-01' } } })
      ])
    )
    expect(
      runChecks(world, nodeEnv)
        .filter((i) => i.severity !== 'info')
        .map((i) => i.message)
    ).toEqual([])
    const cal = worldCalendars(world, nodeEnv).set.get('ten')!
    expect(formatInstant(cal, 400 * DAY)).toBe('C1-05-01')
    expect(resolveEvents(world, worldCalendars(world, nodeEnv)).get('e')!.start!.precision).toBe('day')
    // Without a sandbox (the renderer), script calendars are reported, not run.
    expect(runChecks(world).map((i) => i.code)).toContain('bad-calendar')
  })

  it('has no clock, no randomness, no require, no process and no eval', () => {
    const probe = (expr: string): string => {
      const impl = sandboxedCalendar(`module.exports = { toFields() { return { year: ${expr} } }, fromFields() { return 0 } }`, 'probe.js')
      try {
        return String(impl.toFields(0).year)
      } catch (err) {
        return `threw: ${(err as Error).message}`
      }
    }
    expect(probe('typeof Date')).toBe('undefined') // Date is gone
    expect(probe('new Date().getTime()')).toMatch(/threw: .*Date is not defined/)
    expect(probe('Math.random()')).toMatch(/Math.random is not available/)
    expect(probe("typeof require === 'undefined' ? 1 : 0")).toBe('1')
    expect(probe("typeof process === 'undefined' ? 1 : 0")).toBe('1')
    expect(probe("eval('1')")).toMatch(/threw/)
    expect(probe("(function(){}).constructor('return 1')()")).toMatch(/threw/)
    expect(probe("__h.gregorian.toFields.constructor('return 1')()")).toMatch(/threw/)
  })

  it('stops endless loops and reports script errors as messages', () => {
    const loop = sandboxedCalendar('module.exports = { toFields() { for (;;) {} }, fromFields() { return 0 } }', 'loop.js', {
      timeoutMs: 30
    })
    expect(() => loop.toFields(0)).toThrow(/took too long/)
    expect(() => sandboxedCalendar('module.exports = {', 'bad.js')).toThrow(/failed to load/)
    expect(() => sandboxedCalendar('module.exports = { toFields() {} }', 'half.js')).toThrow(/fromFields/)
    expect(() => sandboxedCalendar('for(;;){}', 'hang.js', { timeoutMs: 30 })).toThrow(/took too long/)
  })

  it('gives scripts Gregorian helpers that agree with the built-in calendar', () => {
    const viaHelper = sandboxedCalendar(
      `module.exports = { toFields(t, h) { return h.gregorian.toFields(t) }, fromFields(f, h) { return h.gregorian.fromFields(f) } }`,
      'g.js'
    )
    const r = mulberry32(3)
    for (let i = 0; i < 300; i++) {
      const t = Math.floor((r() * 2 - 1) * 2e11)
      expect(viaHelper.toFields(t)).toEqual(greg.toFields(t))
      expect(viaHelper.fromFields(greg.toFields(t))).toBe(t)
    }
  })

  it('flags a script that does not read back what it writes', () => {
    const world = readWorld(
      files([
        { path: 'calendars/off.json', text: '{"name": "Off", "kind": "script", "units": [{"name": "year"}]}' },
        {
          path: 'calendars/off.js',
          text: 'module.exports = { toFields(t) { return { year: Math.floor(t / 1e7) } }, fromFields(f) { return f.year * 1e7 } }'
        },
        { path: 'calendars/stray.js', text: '' }
      ])
    )
    const codes = runChecks(world, nodeEnv).map((i) => `${i.path} ${i.code}`)
    expect(codes).toContain('calendars/off.js script-round-trip')
    expect(codes).toContain('calendars/stray.js unused-script')
  })
})

describe('comparing worlds', () => {
  it('lists added, removed and changed entities with field-level changes, ignoring layout', () => {
    const base = readWorld(
      files([ev('a', { name: 'A', type: 'event', when: atGreg('2700') }), ev('b', { name: 'B', type: 'event', when: atGreg('2701') })])
    )
    const other = readWorld(
      files([
        { path: 'events/a.json', text: JSON.stringify({ type: 'event', name: 'A', when: atGreg('2700') }, null, 7) },
        ev('b', { name: 'B!', type: 'event', when: { after: 'a', cal: 'gregorian', offset: { year: 2 } }, tags: ['x'] }),
        ev('c', { name: 'C', type: 'event', when: atGreg('2702') })
      ])
    )
    const cmp = compareWorlds(base, other)
    expect(cmp.added.map((e) => e.key)).toEqual(['event/c'])
    expect(cmp.removed).toEqual([])
    expect(cmp.changed.map((c) => c.key)).toEqual(['event/b'])
    expect(cmp.changed[0].fields.map((f) => f.field)).toEqual(['name', 'tags', 'when.after', 'when.at', 'when.cal', 'when.offset'])
    expect(compareWorlds(other, base).removed.map((e) => e.key)).toEqual(['event/c'])
  })
})

describe('the editor', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-editor-'))
    await createWorld(tmp, 'Edited', 1)
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('shows edits everywhere without writing, then saves exactly the pending files', async () => {
    const ed = new WorldEditor(tmp)
    await ed.load()
    ed.setEntity(eventKind, 'first', { name: 'First', type: 'event', when: atGreg('2700') })
    expect(ed.dirty).toEqual(['events/first.json'])
    expect(ed.world().entities.has('event/first')).toBe(true)
    await expect(fs.access(path.join(tmp, 'events'))).rejects.toThrow()
    expect(await ed.save()).toEqual(['events/first.json'])
    expect(ed.dirty).toEqual([])
    expect((await loadWorld(tmp)).entities.has('event/first')).toBe(true)
    expect(runChecks(await loadWorld(tmp), nodeEnv)).toEqual([])
  })

  it('undoes and redoes, and forgets edits that return a file to what is on disk', async () => {
    const ed = new WorldEditor(tmp)
    await ed.load()
    const original = ed.diskText('calendars/gregorian.json')!
    ed.edit([{ path: 'calendars/gregorian.json', text: original.replace('Gregorian', 'Earth') }])
    ed.edit([{ path: 'calendars/gregorian.json', text: null }])
    expect(ed.world().entities.has('calendar/gregorian')).toBe(false)
    ed.undo()
    expect(ed.world().entities.get('calendar/gregorian')!.text).toContain('Earth')
    ed.undo()
    expect(ed.dirty).toEqual([])
    expect(ed.canUndo).toBe(false)
    ed.redo()
    expect(ed.dirty).toEqual(['calendars/gregorian.json'])
    ed.edit([{ path: 'calendars/gregorian.json', text: original }])
    expect(ed.dirty).toEqual([])
    ed.discard()
    expect(ed.canUndo).toBe(true)
  })

  it('deletes on save, keeps invalid values visible, and refuses paths outside the format', async () => {
    const ed = new WorldEditor(tmp)
    await ed.load()
    ed.edit([{ path: 'calendars/gregorian.json', text: null }])
    await ed.save()
    await expect(fs.access(path.join(tmp, 'calendars', 'gregorian.json'))).rejects.toThrow()
    ed.setEntity(eventKind, 'bad', { name: '', type: 'event', when: {} } as EventFile)
    expect(ed.diskText('events/bad.json')).toBeNull()
    expect(ed.world().issues.some((i) => i.path === 'events/bad.json')).toBe(true)
    for (const p of ['../escape.json', 'world.json', 'events/sub/x.json', 'notes.txt', 'events/x.js', 'events/Bad Id.json']) {
      expect(() => ed.edit([{ path: p, text: '{}' }]), p).toThrow(/not a file the world format owns/)
    }
  })
})
