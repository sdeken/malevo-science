import { useCallback, useEffect, useState } from 'react'
import type { MenuCommand } from '../../shared/ipc'
import type { Settings, UpdateStatus, WorldInfo } from '../../shared/types'
import { AboutDialog } from './components/AboutDialog'
import { NewWorldDialog } from './components/NewWorldDialog'
import { StatusBar } from './components/StatusBar'
import { Welcome } from './components/Welcome'
import { TOOLS } from './tools'

const TOOL_KEY = 'malevo.selectedTool'

function loadSelectedTool(): string {
  try {
    const saved = localStorage.getItem(TOOL_KEY)
    if (saved && TOOLS.some((t) => t.id === saved)) return saved
  } catch {
    /* storage unavailable */
  }
  return TOOLS[0].id
}

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [world, setWorld] = useState<WorldInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [dialog, setDialog] = useState<'new' | 'about' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toolId, setToolId] = useState(loadSelectedTool)

  useEffect(() => {
    void Promise.all([window.malevo.world.current(), window.malevo.settings.get(), window.malevo.updates.status()]).then(([w, s, u]) => {
      setWorld(w)
      setSettings(s)
      setUpdate(u)
      setLoaded(true)
    })
    const offWorld = window.malevo.world.onChanged((w) => {
      setWorld(w)
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
    if (result.ok) setError(null)
    else setError(result.message)
  }, [])

  const openChosen = useCallback(async () => {
    const dir = await window.malevo.world.chooseFolder('open')
    if (dir) await openPath(dir)
  }, [openPath])

  const create = useCallback(async (dir: string, name: string): Promise<string | null> => {
    const result = await window.malevo.world.create(dir, name)
    if (!result.ok) return result.message
    setDialog(null)
    setError(null)
    return null
  }, [])

  const close = useCallback(async () => {
    await window.malevo.world.close()
    setSettings(await window.malevo.settings.get())
  }, [])

  useEffect(
    () =>
      window.malevo.app.onMenu((command: MenuCommand) => {
        if (command === 'new-world') setDialog('new')
        else if (command === 'open-world') void openChosen()
        else if (command === 'close-world') void close()
        else if (command === 'about') setDialog('about')
      }),
    [openChosen, close]
  )

  const selectTool = (id: string): void => {
    setToolId(id)
    try {
      localStorage.setItem(TOOL_KEY, id)
    } catch {
      /* storage unavailable */
    }
  }

  if (!loaded) return <div className="app" />

  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]

  return (
    <div className="app">
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
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
          <main className="tool-pane" data-tool={tool.id}>
            <tool.View world={world} />
          </main>
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
      <StatusBar world={world} update={update} />
      {dialog === 'new' && <NewWorldDialog onCancel={() => setDialog(null)} onCreate={create} />}
      {dialog === 'about' && <AboutDialog update={update} onClose={() => setDialog(null)} />}
    </div>
  )
}
