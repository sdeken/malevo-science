import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, MAX_RECENT_WORLDS, type Settings } from '../shared/types'

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
    autoUpdate: typeof s.autoUpdate === 'boolean' ? s.autoUpdate : DEFAULT_SETTINGS.autoUpdate
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
