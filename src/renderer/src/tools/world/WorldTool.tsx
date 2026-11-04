import type { ToolDefinition, ToolProps } from '../registry'

function WorldView({ world }: ToolProps): React.JSX.Element {
  const hex = world.seed.toString(16).toUpperCase().padStart(8, '0')
  return (
    <div className="tool-page">
      <h1>{world.name}</h1>
      <dl className="facts">
        <dt>Folder</dt>
        <dd>
          <code className="world-root">{world.root}</code>{' '}
          <button className="link" onClick={() => void window.malevo.world.reveal()}>
            Show in Explorer
          </button>
        </dd>
        <dt>Seed</dt>
        <dd>
          <code className="world-seed">{world.seed}</code> <span className="muted">(0x{hex})</span>
        </dd>
        <dt>Format</dt>
        <dd>
          <code>world.json</code> format {world.format}
        </dd>
      </dl>
      <p className="muted">
        The seed is the root of every procedural choice in this world and never changes. The world's physics lives in{' '}
        <code>settings/physics.json</code> and its calendars in <code>calendars/</code>. Tools for timelines, star systems, routes and the
        rest arrive in later phases.
      </p>
    </div>
  )
}

export const worldTool: ToolDefinition = {
  id: 'world',
  title: 'World',
  description: 'The open world: its name, folder and seed',
  View: WorldView
}
