import { calendarsTool } from './calendars/CalendarsTool'
import { checksTool } from './checks/ChecksTool'
import { compareTool } from './compare/CompareTool'
import { culturesTool } from './cultures/CulturesTool'
import { defineTools } from './registry'
import { routesTool } from './routes/RoutesTool'
import { skyTool } from './sky/SkyTool'
import { approachTool } from './approach/ApproachTool'
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
  skyTool,
  approachTool,
  culturesTool,
  calendarsTool,
  compareTool,
  checksTool,
  worldTool
])
