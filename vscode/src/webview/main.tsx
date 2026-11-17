/**
 * A system or body editor in VS Code: the app's own screens, with the current date bar on top.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorldSnapshot } from '../../../src/shared/types'
import { DateBar } from '../../../src/renderer/src/components/DateBar'
import { useSnapshot } from '../../../src/renderer/src/state'
import { SystemDetail } from '../../../src/renderer/src/tools/systems/SystemsTool'
import { BodyEditor } from '../../../src/renderer/src/tools/systems/BodyEditor'
import { call, installBridge, on } from './bridge'

interface Boot {
  kind: 'system' | 'body'
  id: string
  root: string
}
interface HostState {
  now: number
  displayCal: string | null
}

installBridge()
const boot = JSON.parse(document.getElementById('boot')!.textContent!) as Boot

function Root(): React.JSX.Element {
  const snapshot = useSnapshot(true)
  const [st, setSt] = useState<HostState | null>(null)
  // While the date is being scrubbed here, the host's echoes of earlier dates lag behind it: keep ours.
  const local = useRef<{ now: number; until: number } | null>(null)
  useEffect(() => {
    const take = (s: HostState): void => {
      const l = local.current
      setSt(l && Date.now() < l.until ? { ...s, now: l.now } : s)
    }
    void call('host.state').then((s) => take(s as HostState))
    return on('host.state', (s) => take(s as HostState))
  }, [])
  if (!snapshot || !st) return <p className="muted vs-loading">Opening…</p>
  const setNow = (t: number): void => {
    local.current = { now: t, until: Date.now() + 400 }
    setSt({ ...st, now: t })
    void call('host.setNow', [t])
  }
  const setDisplayCal = (cal: string): void => {
    setSt({ ...st, displayCal: cal })
    void call('host.setDisplayCal', [cal])
  }
  return (
    <div className="vs-page" data-vs-editor={`${boot.kind}:${boot.id}`}>
      <DateBar snapshot={snapshot} now={st.now} setNow={setNow} displayCal={st.displayCal} setDisplayCal={setDisplayCal} />
      <div className="vs-body">
        {boot.kind === 'system' ? (
          <SystemPage snapshot={snapshot} now={st.now} displayCal={st.displayCal} />
        ) : (
          <BodyPage snapshot={snapshot} displayCal={st.displayCal} />
        )}
      </div>
    </div>
  )
}

const navigate = (tool: string, focus?: string): void => void call('host.navigate', [tool, focus])

function SystemPage({ snapshot, now, displayCal }: { snapshot: WorldSnapshot; now: number; displayCal: string | null }): React.JSX.Element {
  const system = snapshot.systems.find((s) => s.id === boot.id)
  if (!system)
    return (
      <div className="tool-page">
        <p className="error">This file doesn’t read as a system right now (see the Problems, or reopen it with the text editor).</p>
      </div>
    )
  return (
    <SystemDetail
      key={system.id}
      system={system}
      snapshotVersion={snapshot.version}
      now={now}
      displayCal={displayCal}
      calendars={snapshot.calendars}
      navigate={navigate}
      open={(spec) => (spec.type === 'body' && spec.params?.id ? void call('host.openBody', [spec.params.id]) : navigate(spec.type))}
      focusBody={null}
      snapshot={snapshot}
      onRenamed={() => {}}
      onOpenBody={(id) => void call('host.openBody', [id])}
    />
  )
}

function BodyPage({ snapshot, displayCal }: { snapshot: WorldSnapshot; displayCal: string | null }): React.JSX.Element {
  const system = snapshot.systems.find((s) => s.bodies.some((b) => b.id === boot.id))
  const body = system?.bodies.find((b) => b.id === boot.id)
  if (!system || !body)
    return (
      <div className="tool-page">
        <p className="error">
          This file doesn’t read as a body in any system right now (its system may be missing, or the file has errors: see the Problems, or
          reopen it with the text editor).
        </p>
      </div>
    )
  return (
    <div className="tool-page wide">
      <p className="vs-crumb small">
        <button className="link" onClick={() => void call('host.openSystem', [system.id])} id="openSystem">
          {system.name}
        </button>{' '}
        › {body.name}
      </p>
      {displayCal ? (
        <BodyEditor
          key={body.id}
          body={body}
          system={system}
          calendars={snapshot.calendars}
          displayCal={displayCal}
          version={snapshot.version}
          bodyIds={snapshot.systems.flatMap((s) => s.bodies.map((b) => b.id))}
          origin={snapshot.origins[`body/${body.id}`]}
          origins={snapshot.origins}
          onDeleted={() => {}}
          onRenamed={() => {}}
          onOpenBody={(id) => void call('host.openBody', [id])}
        />
      ) : (
        <p className="muted">This world has no usable calendar.</p>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
