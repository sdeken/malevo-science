import { useEffect, useState } from 'react'
import type { WorldSnapshot } from '../../../shared/types'
import type { BladeSpec } from '../tools/registry'
import { entityActions, refFromElement, refKindLabel, refLabel, type Ref } from './entities'

const EVENT = 'malevo:entity-menu'

/**
 * Offer the actions for something at a point on screen, from a view that draws without elements to
 * right-click on (a 3D map): `from` is any element inside the blade it came from.
 */
export function showEntityMenu(ref: Ref, x: number, y: number, from: Element | null): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ref, x, y, from } }))
}

interface Open {
  ref: Ref
  x: number
  y: number
  blade: number
}

const bladeOf = (el: Element | null): number => {
  const b = el?.closest('[data-blade]') as HTMLElement | null
  return b ? Number(b.dataset.blade) : -1
}

/** Right-click anything the world tracks, in any blade, for what can be done with it. */
export function EntityMenu({
  snapshot,
  open,
  setNow
}: {
  snapshot: WorldSnapshot
  open(from: number, spec: BladeSpec): void
  setNow(t: number): void
}): React.JSX.Element | null {
  const [menu, setMenu] = useState<Open | null>(null)

  useEffect(() => {
    const onContext = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (!target?.closest('.blades')) return
      // Text fields keep their own menu (spelling, copy and paste).
      if (target.closest('input, textarea, select')) return
      const ref = refFromElement(target, snapshot)
      if (!ref || !entityActions(ref, snapshot, setNow).length) return
      e.preventDefault()
      setMenu({ ref, x: e.clientX, y: e.clientY, blade: bladeOf(target) })
    }
    const onShow = (e: Event): void => {
      const d = (e as CustomEvent<{ ref: Ref; x: number; y: number; from: Element | null }>).detail
      if (entityActions(d.ref, snapshot, setNow).length) setMenu({ ref: d.ref, x: d.x, y: d.y, blade: bladeOf(d.from) })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('contextmenu', onContext)
    window.addEventListener(EVENT, onShow)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('contextmenu', onContext)
      window.removeEventListener(EVENT, onShow)
      window.removeEventListener('keydown', onKey)
    }
  }, [snapshot, setNow])

  if (!menu) return null
  const actions = entityActions(menu.ref, snapshot, setNow)
  // Keep it on screen.
  const left = Math.min(menu.x, window.innerWidth - 260)
  const top = Math.min(menu.y, window.innerHeight - 40 - actions.length * 30)
  return (
    <div className="entity-menu-backdrop" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))}>
      <div className="entity-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()} role="menu" id="entityMenu">
        <div className="entity-menu-head">
          <strong>{refLabel(menu.ref, snapshot)}</strong> <span className="muted small">{refKindLabel(menu.ref, snapshot)}</span>
        </div>
        {actions.map((a) => (
          <button
            key={a.label}
            role="menuitem"
            className={a.primary ? 'primary-action' : undefined}
            onClick={() => {
              setMenu(null)
              if (a.spec) open(menu.blade, a.spec)
              else a.run?.()
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
