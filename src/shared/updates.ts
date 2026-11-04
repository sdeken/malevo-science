/**
 * When is it safe to restart into a downloaded update? Pure policy so it can
 * be tested; the main process feeds it live signals once a minute.
 * (Ported from devlog.)
 */
export interface InstallContext {
  enabled: boolean
  downloaded: boolean
  /** ms timestamps */
  now: number
  startedAt: number
  downloadedAt: number
  windowVisible: boolean
  windowFocused: boolean
  /** Seconds since the last keyboard/mouse input (from powerMonitor). */
  idleSeconds: number
  locked: boolean
  /** A tool holds unsaved changes. */
  busy: boolean
}

export interface InstallDecision {
  install: boolean
  reason: string
}

const MIN = 60_000
const HOUR = 60 * MIN

export const SETTLE_MS = 2 * MIN
export const OVERDUE_MS = 24 * HOUR

export function shouldInstallNow(ctx: InstallContext): InstallDecision {
  if (!ctx.enabled) return { install: false, reason: 'auto-update disabled' }
  if (!ctx.downloaded) return { install: false, reason: 'nothing downloaded' }
  if (ctx.now - ctx.startedAt < SETTLE_MS) return { install: false, reason: 'just started' }
  if (ctx.busy) return { install: false, reason: 'unsaved changes' }

  const pending = ctx.now - ctx.downloadedAt
  if (ctx.locked) return { install: true, reason: 'screen locked' }
  if (!ctx.windowVisible && ctx.idleSeconds >= 120) return { install: true, reason: 'window hidden and input idle' }
  if (!ctx.windowVisible && pending >= 15 * MIN) return { install: true, reason: 'window hidden for a while' }
  if (ctx.windowVisible && !ctx.windowFocused && ctx.idleSeconds >= 10 * 60) return { install: true, reason: 'window unfocused and idle' }
  if (ctx.idleSeconds >= 15 * 60) return { install: true, reason: 'input idle 15 min' }
  if (pending >= OVERDUE_MS && ctx.idleSeconds >= 60) return { install: true, reason: 'update overdue' }
  return { install: false, reason: 'in use' }
}
