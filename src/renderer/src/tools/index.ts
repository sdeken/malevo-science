import { defineTools } from './registry'
import { worldTool } from './world/WorldTool'

/** Every tool, in sidebar order. Later phases add Timeline, Systems, Routes, … here. */
export const TOOLS = defineTools([worldTool])
