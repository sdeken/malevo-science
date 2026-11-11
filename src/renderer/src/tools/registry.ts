/**
 * The tool host's registry. A tool is a module with an id, a title and a view
 * over the open world. Tools never touch the file system: they read the world
 * from the snapshot main pushes, and change it through window.malevo.world,
 * where every edit is unsaved until the user saves.
 */
import type { ComponentType } from 'react'
import type { WorldInfo, WorldSnapshot } from '../../../shared/types'

export interface ToolProps {
  world: WorldInfo
  snapshot: WorldSnapshot
  /** The global current date (universal seconds), shared by every tool. */
  now: number
  setNow(t: number): void
  /** The calendar dates are shown in. */
  displayCal: string | null
  setDisplayCal(id: string): void
  /** Open another tool beside this one, optionally pointing it at something (a system id, a star id). */
  navigate(toolId: string, focus?: string): void
  /** What another tool pointed this one at, if anything (the blade's `focus` parameter). */
  focus: string | null
  /** What this blade was opened on: its parameters (`focus` among them). */
  params: Record<string, string>
  /** Open a blade to the right of this one, in place of any already to its right. */
  open(spec: BladeSpec): void
}

/** A view to open: a tool's id, or one of the detail views ("body", "star", "route-to"), and what it is about. */
export interface BladeSpec {
  type: string
  params?: Record<string, string>
}

export interface ToolDefinition {
  /** Stable, lowercase, kebab-case. Used in saved UI state, so never renamed. */
  id: string
  title: string
  /** One line, shown as the sidebar tooltip. */
  description: string
  View: ComponentType<ToolProps>
}

const ID = /^[a-z][a-z0-9-]*$/

/** Validates a set of tools: well-formed, unique ids. Throws on a programming error. */
export function defineTools(tools: ToolDefinition[]): readonly ToolDefinition[] {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (!ID.test(tool.id)) throw new Error(`Tool id "${tool.id}" must be lowercase kebab-case.`)
    if (seen.has(tool.id)) throw new Error(`Two tools share the id "${tool.id}".`)
    seen.add(tool.id)
  }
  return Object.freeze([...tools])
}
