import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatFace,
  parseDuration,
  readTimeline,
  reading,
  schedule,
  toMarkdown,
  writeTimeline,
  type TimelineFile
} from '../src/timeline/model'

describe('durations', () => {
  it('read the ways they are written', () => {
    expect(parseDuration('0d 0h 4m 0s')).toBe(240)
    expect(parseDuration('1h 30m')).toBe(5400)
    expect(parseDuration('90s')).toBe(90)
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('2.5h')).toBe(9000)
    expect(parseDuration('-4m')).toBe(-240)
    expect(parseDuration('3d 14:05:00')).toBe(3 * 86400 + 14 * 3600 + 300)
    expect(parseDuration('14:05')).toBe(14 * 3600 + 300)
    expect(parseDuration('four minutes')).toBeNull()
    expect(parseDuration('4m and 3')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
  it('write as days, hours, minutes and seconds', () => {
    expect(formatDuration(240)).toBe('0d 0h 4m 0s')
    expect(formatDuration(90061)).toBe('1d 1h 1m 1s')
    expect(formatDuration(-61)).toBe('-0d 0h 1m 1s')
    expect(formatFace(3 * 86400 + 14 * 3600 + 305)).toBe('3d 14:05:05')
    expect(formatFace(30 * 3600, 26)).toBe('1d 04:00:00')
  })
})

const file: TimelineFile = {
  format: 1,
  title: 'Down to Bluff',
  clocks: [
    { id: 'ship', name: 'Ship', kind: 'ship', start: '2d 23h 50m 0s' },
    // A local hour of 1.5 standard hours, 20 of them a day.
    { id: 'bluff', name: 'Bluff', kind: 'local', start: '0d 19h 30m 0s', hour_h: 1.5, hoursPerDay: 20 },
    { id: 'since', name: 'Since the burn', kind: 'duration', startedBy: 'burn' },
    { id: 'land', name: 'To landing', kind: 'countdown', startedBy: 'burn', at: 'end', length: '0d 0h 30m 0s' }
  ],
  events: [
    { id: 'brief', name: 'Briefing', duration: '0d 0h 10m 0s' },
    { id: 'burn', name: 'Deorbit burn', duration: '0d 0h 4m 0s' },
    { id: 'coast', name: 'Coast', duration: '0d 0h 20m 0s' },
    { id: 'talk', name: 'Div and Kasinov talk', duration: '0d 0h 5m 0s', with: true, notes: 'over the | noise' },
    { id: 'chute', name: 'Chutes', duration: '0d 0h 12m 0s' }
  ]
}

describe('a scene timeline', () => {
  it('runs events one after another, or alongside the one before', () => {
    expect(schedule(file).map((s) => [s.start / 60, s.end / 60])).toEqual([
      [0, 10],
      [10, 14],
      [14, 34],
      [14, 19],
      [19, 31]
    ])
  })

  it('reads every clock at a moment', () => {
    const sched = schedule(file)
    const at = (t: number) => file.clocks.map((c) => reading(c, t, sched))
    expect(at(0)).toEqual(['2d 23:50:00', '0d 19:30:00', '—', '—'])
    // 15 standard minutes = 10 local minutes; the duration from the burn's start, the countdown from its end.
    expect(at(15 * 60)).toEqual(['3d 00:05:00', '0d 19:40:00', '0d 0h 5m 0s', 'T−0d 0h 29m 0s'])
    // A local day is 20 local hours: 19:30 plus 1 local hour rolls over.
    expect(at(90 * 60)).toEqual(['3d 01:20:00', '1d 00:30:00', '0d 1h 20m 0s', 'T+0d 0h 46m 0s'])
  })

  it('round-trips through its file, and tells what is wrong with a bad one', () => {
    const r = readTimeline(writeTimeline(file))
    expect('file' in r && r.file).toEqual(file)
    expect(readTimeline('{ nope')).toHaveProperty('error')
    expect(readTimeline('{"clocks": [{"kind": "sundial"}]}')).toHaveProperty('error')
    const blank = readTimeline('')
    expect('file' in blank && blank.file.clocks[0].kind).toBe('ship')
  })

  it('exports a Markdown table', () => {
    const md = toMarkdown(file)
    expect(md).toContain('## Down to Bluff')
    expect(md).toContain('| # | Event | Duration | Ship | Bluff | Since the burn | To landing | Notes |')
    expect(md).toContain('| 2 | Deorbit burn | 0d 0h 4m 0s | 3d 00:00:00 | 0d 19:36:40 | 0d 0h 0m 0s | — |  |')
    expect(md).toContain('over the \\| noise')
    expect(md).toContain('Ends after 0d 0h 34m 0s')
  })
})
