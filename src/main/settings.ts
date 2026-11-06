import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_PAGE, DEFAULT_SETTINGS, MAX_RECENT_WORLDS, type PageSettings, type Settings } from '../shared/types'

/** App settings in userData/settings.json. Never written into a world folder. */
export class SettingsStore {
  private data: Settings = { ...DEFAULT_SETTINGS }

  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Settings>
      this.data = sanitize({ ...DEFAULT_SETTINGS, ...raw })
    } catch {
      this.data = { ...DEFAULT_SETTINGS }
    }
    return this.get()
  }

  get(): Settings {
    return { ...this.data, recentWorlds: [...this.data.recentWorlds] }
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.data = sanitize({ ...this.data, ...patch })
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`)
    await fs.rename(tmp, this.file)
    return this.get()
  }

  /** Remember a world as the last one opened and move it to the top of the recent list. */
  async rememberWorld(root: string): Promise<Settings> {
    const recent = [root, ...this.data.recentWorlds.filter((p) => !samePath(p, root))]
    return this.set({ lastWorld: root, recentWorlds: recent })
  }

  async forgetWorld(root: string): Promise<Settings> {
    return this.set({
      recentWorlds: this.data.recentWorlds.filter((p) => !samePath(p, root)),
      lastWorld: this.data.lastWorld && samePath(this.data.lastWorld, root) ? null : this.data.lastWorld
    })
  }
}

function sanitize(s: Settings): Settings {
  const recent = Array.isArray(s.recentWorlds) ? s.recentWorlds.filter((p): p is string => typeof p === 'string' && p.length > 0) : []
  return {
    lastWorld: typeof s.lastWorld === 'string' && s.lastWorld ? s.lastWorld : null,
    recentWorlds: dedupe(recent).slice(0, MAX_RECENT_WORLDS),
    autoUpdate: typeof s.autoUpdate === 'boolean' ? s.autoUpdate : DEFAULT_SETTINGS.autoUpdate,
    page: sanitizePage(s.page)
  }
}

function dedupe(paths: string[]): string[] {
  const out: string[] = []
  for (const p of paths) if (!out.some((q) => samePath(p, q))) out.push(p)
  return out
}

/** Windows paths are case-insensitive. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const r = path.resolve(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

export function sanitizePage(p: unknown): PageSettings {
  const v = (p && typeof p === 'object' ? p : {}) as Partial<PageSettings>
  const num = (x: unknown, lo: number, hi: number, d: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d
  return {
    font: typeof v.font === 'string' ? v.font.replace(/["';{}<>]/g, '').slice(0, 100) : DEFAULT_PAGE.font,
    size: num(v.size, 10, 32, DEFAULT_PAGE.size),
    leading: num(v.leading, 1, 2.5, DEFAULT_PAGE.leading),
    oldstyle: typeof v.oldstyle === 'boolean' ? v.oldstyle : DEFAULT_PAGE.oldstyle,
    justify: typeof v.justify === 'boolean' ? v.justify : DEFAULT_PAGE.justify
  }
}
