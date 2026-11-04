/**
 * The tool host's registry. A tool is a module with an id, a title and a view
 * over the open world; later phases add the entity kinds it edits and its
 * commands (docs/PLAN.md §2). Tools never touch the file system: they read and
 * write the world through the shared model, via the preload API.
 */
import type { ComponentType } from 'react'
import type { WorldInfo } from '../../../shared/types'

export interface ToolProps {
  world: WorldInfo
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
