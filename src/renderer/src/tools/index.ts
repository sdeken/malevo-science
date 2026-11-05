import { calendarsTool } from './calendars/CalendarsTool'
import { checksTool } from './checks/ChecksTool'
import { compareTool } from './compare/CompareTool'
import { defineTools } from './registry'
import { starsTool } from './stars/StarsTool'
import { systemsTool } from './systems/SystemsTool'
import { timelineTool } from './timeline/TimelineTool'
import { worldTool } from './world/WorldTool'

/** Every tool, in sidebar order. Later phases add Cultures, Routes, … here. */
export const TOOLS = defineTools([timelineTool, starsTool, systemsTool, calendarsTool, compareTool, checksTool, worldTool])
