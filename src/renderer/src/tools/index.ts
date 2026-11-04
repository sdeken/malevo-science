import { calendarsTool } from './calendars/CalendarsTool'
import { checksTool } from './checks/ChecksTool'
import { compareTool } from './compare/CompareTool'
import { defineTools } from './registry'
import { timelineTool } from './timeline/TimelineTool'
import { worldTool } from './world/WorldTool'

/** Every tool, in sidebar order. Later phases add Systems, Routes, … here. */
export const TOOLS = defineTools([timelineTool, calendarsTool, compareTool, checksTool, worldTool])
