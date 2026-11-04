import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MenuCommand } from '../../shared/ipc'
import type { Settings, UpdateStatus, WorldInfo, WorldSnapshot } from '../../shared/types'
import { AboutDialog } from './components/AboutDialog'
import { DateBar } from './components/DateBar'
import { NewWorldDialog } from './components/NewWorldDialog'
import { StatusBar } from './components/StatusBar'
import { Welcome } from './components/Welcome'
import { readPref, typingInto, useSnapshot, useWorldPref, writePref } from './state'
import { TOOLS } from './tools'

const TOOL_KEY = 'malevo.selectedTool'

function loadSelectedTool(): string {
  const saved = readPref<string | null>(TOOL_KEY, null)
  return saved && TOOLS.some((t) => t.id === saved) ? saved : TOOLS[0].id
}

/** Commit whatever field is being edited (fields save on blur) before a save or an undo. */
function commitFocusedField(): void {
  const el = document.activeElement as HTMLElement | null
  if (el && typingInto(el)) el.blur()
}

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [world, setWorld] = useState<WorldInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [dialog, setDialog] = useState<'new' | 'about' | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string; open?: string } | null>(null)
  const [toolId, setToolId] = useState(loadSelectedTool)
  const snapshot = useSnapshot(world !== null)

  useEffect(() => {
    void Promise.all([window.malevo.world.current(), window.malevo.settings.get(), window.malevo.updates.status()]).then(([w, s, u]) => {
      setWorld(w)
      setSettings(s)
      setUpdate(u)
      setLoaded(true)
    })
    const offWorld = window.malevo.world.onChanged((w) => {
      setWorld(w)
      setMessage(null)
      void window.malevo.settings.get().then(setSettings)
    })
    const offUpdate = window.malevo.updates.onStatus(setUpdate)
    return () => {
      offWorld()
      offUpdate()
    }
  }, [])

  const openPath = useCallback(async (dir: string) => {
    const result = await window.malevo.world.open(dir)
    if (result.ok) setMessage(null)
    else if (result.code !== 'cancelled') setMessage({ kind: 'error', text: result.message })
  }, [])

  const openChosen = useCallback(async () => {
    const dir = await window.malevo.world.chooseFolder('open')
    if (dir) await openPath(dir)
  }, [openPath])

  const create = useCallback(async (dir: string, name: string): Promise<string | null> => {
    const result = await window.malevo.world.create(dir, name)
    if (!result.ok) return result.code === 'cancelled' ? null : result.message
    setDialog(null)
    setMessage(null)
    return null
  }, [])

  const close = useCallback(async () => {
    if (await window.malevo.world.close()) setSettings(await window.malevo.settings.get())
  }, [])

  const save = useCallback(async () => {
    commitFocusedField()
    await window.malevo.world.save()
  }, [])

  const fork = useCallback(async () => {
    const dir = await window.malevo.world.chooseFolder('fork')
    if (!dir) return
    const result = await window.malevo.world.fork(dir)
    if (result.ok)
      setMessage({
        kind: 'ok',
        text: `Forked to ${result.world.root}. Unsaved changes stay here; the fork has the saved world.`,
        open: result.world.root
      })
    else setMessage({ kind: 'error', text: result.message })
  }, [])

  useEffect(
    () =>
      window.malevo.app.onMenu((command: MenuCommand) => {
        if (command === 'new-world') setDialog('new')
        else if (command === 'open-world') void openChosen()
        else if (command === 'close-world') void close()
        else if (command === 'about') setDialog('about')
        else if (command === 'save') void save()
        else if (command === 'undo') void window.malevo.world.undo()
        else if (command === 'redo') void window.malevo.world.redo()
        else if (command === 'fork-world') void fork()
      }),
    [openChosen, close, save, fork]
  )

  // Ctrl+Z / Ctrl+Y undo and redo world changes, except while typing in a field (where they undo typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typingInto(document.activeElement)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        void window.malevo.world.undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        void window.malevo.world.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selectTool = (id: string): void => {
    setToolId(id)
    writePref(TOOL_KEY, id)
  }

  if (!loaded) return <div className="app" />

  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]

  return (
    <div className="app">
      {message && (
        <div className={`banner ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
          <span>
            {message.open && (
              <button className="link" onClick={() => void openPath(message.open!)}>
                Open it
              </button>
            )}{' '}
            <button className="link" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </span>
        </div>
      )}
      {world ? (
        <div className="workspace">
          <nav className="sidebar">
            <div className="sidebar-world" title={world.root}>
              {world.name}
            </div>
            <ul className="tool-list">
              {TOOLS.map((t) => (
                <li key={t.id}>
                  <button
                    className={t.id === tool.id ? 'tool-link is-current' : 'tool-link'}
                    title={t.description}
                    onClick={() => selectTool(t.id)}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {snapshot && snapshot.world.root === world.root ? (
            <WorldPane snapshot={snapshot} world={world} toolId={tool.id} />
          ) : (
            <main className="tool-pane" />
          )}
        </div>
      ) : (
        <Welcome
          recent={settings?.recentWorlds ?? []}
          onNew={() => setDialog('new')}
          onOpen={() => void openChosen()}
          onOpenPath={(dir) => void openPath(dir)}
          onForget={(dir) => void window.malevo.world.forgetRecent(dir).then(setSettings)}
        />
      )}
      <StatusBar
        world={world}
        snapshot={world ? snapshot : null}
        update={update}
        onSave={() => void save()}
        onDiscard={() => window.confirm('Discard every unsaved change? (Ctrl+Z brings them back.)') && void window.malevo.world.discard()}
        onShowChecks={() => selectTool('checks')}
      />
      {dialog === 'new' && <NewWorldDialog onCancel={() => setDialog(null)} onCreate={create} />}
      {dialog === 'about' && <AboutDialog update={update} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** The current date bar and the selected tool, for the open world. */
function WorldPane({ snapshot, world, toolId }: { snapshot: WorldSnapshot; world: WorldInfo; toolId: string }): React.JSX.Element {
  const usable = useMemo(() => snapshot.calendars.filter((c) => !c.error).map((c) => c.id), [snapshot.calendars])
  const [storedCal, setDisplayCal] = useWorldPref<string | null>(world.root, 'displayCalendar', null)
  const displayCal = storedCal && usable.includes(storedCal) ? storedCal : usable.includes('gregorian') ? 'gregorian' : (usable[0] ?? null)
  const firstStory = snapshot.events.find((e) => e.value?.type === 'story' && e.start)?.start?.t
  const [storedNow, setNow] = useWorldPref<number | null>(world.root, 'now', null)
  const now = storedNow ?? firstStory ?? 0
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]
  return (
    <main className="tool-pane" data-tool={tool.id}>
      <DateBar snapshot={snapshot} now={now} setNow={setNow} displayCal={displayCal} setDisplayCal={setDisplayCal} />
      <div className="tool-body">
        <tool.View world={world} snapshot={snapshot} now={now} setNow={setNow} displayCal={displayCal} setDisplayCal={setDisplayCal} />
      </div>
    </main>
  )
}
