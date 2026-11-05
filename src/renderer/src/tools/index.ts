import { calendarsTool } from './calendars/CalendarsTool'
import { checksTool } from './checks/ChecksTool'
import { compareTool } from './compare/CompareTool'
import { culturesTool } from './cultures/CulturesTool'
import { defineTools } from './registry'
import { routesTool } from './routes/RoutesTool'
import { starsTool } from './stars/StarsTool'
import { systemsTool } from './systems/SystemsTool'
import { timelineTool } from './timeline/TimelineTool'
import { worldTool } from './world/WorldTool'

/** Every tool, in sidebar order. */
export const TOOLS = defineTools([
  timelineTool,
  starsTool,
  systemsTool,
  routesTool,
  culturesTool,
  calendarsTool,
  compareTool,
  checksTool,
  worldTool
])
