import { describe, expect, it } from 'vitest'
import { formatSpan } from '@malevo/core'

describe('spans of time for people', () => {
  it('names the units, leaves out zeros, and keeps three', () => {
    expect(formatSpan(0.249 * 3600)).toBe('14m 56.4s')
    expect(formatSpan(8.539 * 86400)).toBe('1w 1d 13h')
    expect(formatSpan(30.56 * 86400)).toBe('4w 2d 13h')
    expect(formatSpan(2 * 86400 + 5)).toBe('2d')
    expect(formatSpan(3 * 3600 + 7 * 60)).toBe('3h 7m')
    expect(formatSpan(45)).toBe('45s')
    expect(formatSpan(59.96)).toBe('1m')
    expect(formatSpan(400 * 86400)).toBe('1y 4w 6d')
    expect(formatSpan(0)).toBe('0s')
    expect(formatSpan(-90)).toBe('−1m 30s')
    expect(formatSpan(Infinity)).toBe('never')
  })
})
