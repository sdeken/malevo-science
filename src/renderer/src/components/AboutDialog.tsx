import { useEffect, useState } from 'react'
import type { AppInfo, Settings, UpdateStatus } from '../../../shared/types'

interface Props {
  update: UpdateStatus | null
  onClose: () => void
}

export function AboutDialog({ update, onClose }: Props): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void window.malevo.app.info().then(setInfo)
    void window.malevo.settings.get().then(setSettings)
  }, [])

  const toggle = async (autoUpdate: boolean): Promise<void> => setSettings(await window.malevo.settings.set({ autoUpdate }))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Malevo Science</h2>
        {info && (
          <dl className="facts">
            <dt>Version</dt>
            <dd>{info.version}</dd>
            <dt>World format</dt>
            <dd>{info.worldFormat}</dd>
            <dt>Electron</dt>
            <dd>{info.electron}</dd>
          </dl>
        )}
        <h3>Updates</h3>
        {update?.state === 'unavailable' ? (
          <p className="muted">This is a development build; it does not update itself.</p>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" checked={settings?.autoUpdate ?? true} onChange={(e) => void toggle(e.target.checked)} />
              Install updates automatically when the app is idle
            </label>
            <p className="muted small">
              {update?.checkedAt ? `Last checked ${new Date(update.checkedAt).toLocaleString()}.` : 'Not checked yet.'}{' '}
              <button className="link" onClick={() => void window.malevo.updates.check()}>
                Check now
              </button>
            </p>
          </>
        )}
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
