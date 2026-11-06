/**
 * Renderer-side state shared by every tool: the world snapshot (pushed by
 * main), the global "current date" and the calendar dates are shown in. The
 * current date and the display calendar are per-world UI preferences, kept in
 * localStorage, never in the world folder.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorldSnapshot } from '../../shared/types'

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/** A value remembered per world. */
export function useWorldPref<T>(root: string, name: string, fallback: T): [T, (v: T) => void] {
  const key = `malevo.${name}:${root}`
  const [value, setValue] = useState<T>(() => readPref(key, fallback))
  useEffect(() => setValue(readPref(key, fallback)), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback(
    (v: T) => {
      setValue(v)
      writePref(key, v)
    },
    [key]
  )
  return [value, set]
}

/** The latest world snapshot, kept current by main. */
export function useSnapshot(active: boolean): WorldSnapshot | null {
  const [snap, setSnap] = useState<WorldSnapshot | null>(null)
  useEffect(() => {
    if (!active) {
      setSnap(null)
      return
    }
    let live = true
    const off = window.malevo.world.onSnapshot((s) => {
      if (live) setSnap((prev) => (s && prev && s.version < prev.version && s.world.root === prev.world.root ? prev : s))
    })
    void window.malevo.world.snapshot().then((s) => live && setSnap((prev) => prev ?? s))
    return () => {
      live = false
      off()
    }
  }, [active])
  return snap
}

/**
 * Format many instants in one calendar, batched through main. Returns the
 * strings (null while loading or when unreadable), recomputed when the
 * inputs change.
 */
export function useFormatted(cal: string | null, items: { t: number; precision?: string | null }[], version = 0): (string | null)[] {
  const key = JSON.stringify(items)
  const [out, setOut] = useState<(string | null)[]>(() => items.map(() => null))
  const req = useRef(0)
  useEffect(() => {
    if (!cal) {
      setOut(items.map(() => null))
      return
    }
    const id = ++req.current
    void window.malevo.calendar.format(cal, items).then((res) => {
      if (id === req.current) setOut(res)
    })
  }, [cal, key, version]) // eslint-disable-line react-hooks/exhaustive-deps
  return out
}

export function useFormattedOne(cal: string | null, t: number | null, precision?: string | null, version = 0): string | null {
  const items = t === null ? [] : [{ t, precision }]
  return useFormatted(cal, items, version)[0] ?? null
}

/** A readable id from a name, unique among `taken`: "Accord Charter" → "accord-charter", then "accord-charter-2". */
export function slugId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Is focus in something that takes typing? */
export function typingInto(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}
