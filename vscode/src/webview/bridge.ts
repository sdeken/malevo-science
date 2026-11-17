/**
 * The app's `window.malevo`, in a VS Code webview: every call goes to the extension as a message and comes
 * back as its answer; every `onX` subscribes to an event the extension pushes. The screens don't know the
 * difference.
 */
interface VsApi {
  postMessage(m: unknown): void
}
declare function acquireVsCodeApi(): VsApi

type Listener = (payload: unknown) => void

const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
const listeners = new Map<string, Set<Listener>>()
let nextId = 1
let vs: VsApi | null = null

export function call(method: string, args: unknown[] = []): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    vs!.postMessage({ type: 'call', id, method, args })
  })
}

export function on(name: string, cb: Listener): () => void {
  let set = listeners.get(name)
  if (!set) listeners.set(name, (set = new Set()))
  set.add(cb)
  return () => set!.delete(cb)
}

export function installBridge(): void {
  vs = acquireVsCodeApi()
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type: string; id?: number; value?: unknown; error?: string; name?: string; payload?: unknown }
    if (m.type === 'result' && m.id !== undefined) {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error !== undefined) p.reject(new Error(m.error))
      else p.resolve(m.value)
    } else if (m.type === 'event' && m.name) for (const cb of listeners.get(m.name) ?? []) cb(m.payload)
  })
  // window.malevo.<area>.<method>(...): a call; window.malevo.<area>.onThing(cb): the "<area>.thing" event.
  const area = (ns: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (/^on[A-Z]/.test(prop)) return (cb: Listener) => on(`${ns}.${prop[2].toLowerCase()}${prop.slice(3)}`, cb)
          return (...args: unknown[]) => call(`${ns}.${prop}`, args)
        }
      }
    )
  ;(window as unknown as { malevo: unknown }).malevo = new Proxy({}, { get: (_t, ns: string) => area(ns) })
  // VS Code webviews can't show the browser's own dialogs; the extension asks instead (before a delete).
  window.confirm = () => true
}
