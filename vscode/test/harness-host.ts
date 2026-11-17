/**
 * The extension's side of the editors, for testing in a plain browser: the real world session and call
 * table over a world folder, with the app's own file editor standing in for VS Code's documents, and the
 * VS Code bits (asking, opening tabs) recorded instead.
 */
import { WorldSession } from '../../src/main/world'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'
import { makeDispatch } from '../src/host/dispatch'

export interface Harness {
  call(method: string, args: unknown[]): Promise<unknown>
  onEvent(cb: (name: string, payload: unknown) => void): void
  opened: string[]
  navigated: string[]
  session: WorldSession
}

export async function startHost(root: string, catalog: string): Promise<Harness> {
  const session = new WorldSession(nodeEnvWith(await loadCatalog(catalog)))
  const r = await session.open(root)
  if (!r.ok) throw new Error(r.message)
  const listeners: ((name: string, payload: unknown) => void)[] = []
  const emit = (name: string, payload: unknown): void => listeners.forEach((l) => l(name, payload))
  let now = 0
  let displayCal: string | null = 'gregorian'
  const h: Harness = {
    opened: [],
    navigated: [],
    session,
    call: (m, a) => dispatch(m, a),
    onEvent: (cb) => void listeners.push(cb)
  }
  const dispatch = makeDispatch(session, {
    confirm: async () => true,
    openBody: async (id) => void h.opened.push(`body:${id}`),
    openSystem: async (id) => void h.opened.push(`system:${id}`),
    navigate: (tool) => void h.navigated.push(tool),
    state: () => ({ now, displayCal }),
    setNow: (t) => {
      now = t
      emit('host.state', { now, displayCal })
    },
    setDisplayCal: (c) => {
      displayCal = c
      emit('host.state', { now, displayCal })
    }
  })
  session.on('snapshot', () => setTimeout(() => emit('world.snapshot', session.snapshot()), 10))
  session.on('renamed', (x) => emit('world.renamed', x))
  return h
}
