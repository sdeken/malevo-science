import { useEffect, useRef, useState } from 'react'
import type { WorldInfo, WorldSnapshot } from '../../../shared/types'
import type { BladeSpec } from '../tools/registry'
import { bladeDef, bladeTitle } from './index'
import { EntityMenu } from './EntityMenu'
import { close, openAfter, toggleCollapsed, type Blade } from './stack'

interface Props {
  world: WorldInfo
  snapshot: WorldSnapshot
  now: number
  setNow(t: number): void
  displayCal: string | null
  setDisplayCal(id: string): void
  stack: Blade[]
  setStack(s: Blade[]): void
}

/**
 * The open views, side by side. Each blade can open another to its right (a link, a button, a right-click
 * on anything the world tracks); the strip scrolls to show it. A blade can be folded to a strip, widened to
 * fill the window, or closed.
 */
export function BladeHost({ world, snapshot, now, setNow, displayCal, setDisplayCal, stack, setStack }: Props): React.JSX.Element {
  const [maximized, setMaximized] = useState<string | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const latest = useRef(stack)
  latest.current = stack
  const [reveal, setReveal] = useState<string | null>(null)

  const open = (from: number, spec: BladeSpec): void => {
    const next = openAfter(latest.current, from, spec)
    latest.current = next
    setStack(next)
    setMaximized(null)
    setReveal(next[Math.min(from + 1, next.length - 1)]?.key ?? null)
  }

  // Bring a newly opened blade into view.
  useEffect(() => {
    if (!reveal) return
    const el = strip.current?.querySelector<HTMLElement>(`[data-blade-key="${reveal}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' })
    setReveal(null)
  }, [reveal, stack])

  const only = stack.length === 1 || maximized !== null
  return (
    <div className="blades" ref={strip}>
      {stack.map((b, i) => {
        const def = bladeDef(b.type)
        if (!def) return null
        const hidden = maximized !== null && maximized !== b.key
        const title = bladeTitle(b, snapshot)
        return (
          <section
            key={b.key}
            className={`blade ${def.width}${b.collapsed ? ' collapsed' : ''}${only ? ' only' : ''}${hidden ? ' hidden' : ''}`}
            data-blade={i}
            data-blade-key={b.key}
            data-tool={b.type}
          >
            <header className="blade-head" onDoubleClick={() => setMaximized(maximized === b.key ? null : b.key)}>
              <button
                className="blade-fold"
                title={b.collapsed ? 'Unfold' : 'Fold to a strip'}
                onClick={() => setStack(toggleCollapsed(stack, b.key))}
              >
                {b.collapsed ? '▸' : '◂'}
              </button>
              <span className="blade-title" title={title}>
                {title}
              </span>
              {!b.collapsed && stack.length > 1 && (
                <button
                  className="blade-max"
                  title={maximized === b.key ? 'Back to side by side' : 'Fill the window'}
                  onClick={() => setMaximized(maximized === b.key ? null : b.key)}
                >
                  {maximized === b.key ? '⧉' : '⤢'}
                </button>
              )}
              {stack.length > 1 && (
                <button
                  className="blade-close"
                  title="Close"
                  onClick={() => {
                    if (maximized === b.key) setMaximized(null)
                    setStack(close(stack, b.key))
                  }}
                >
                  ×
                </button>
              )}
            </header>
            <div className="blade-body" hidden={b.collapsed}>
              <def.View
                world={world}
                snapshot={snapshot}
                now={now}
                setNow={setNow}
                displayCal={displayCal}
                setDisplayCal={setDisplayCal}
                params={b.params}
                focus={b.params.focus ?? null}
                navigate={(type, focus) => open(i, { type, params: focus ? { focus } : {} })}
                open={(spec) => open(i, spec)}
              />
            </div>
          </section>
        )
      })}
      <EntityMenu snapshot={snapshot} open={open} setNow={setNow} />
    </div>
  )
}
