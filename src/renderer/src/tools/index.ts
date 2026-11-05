import { calendarsTool } from './calendars/CalendarsTool'
import { checksTool } from './checks/ChecksTool'
import { compareTool } from './compare/CompareTool'
import { culturesTool } from './cultures/CulturesTool'
import { defineTools } from './registry'
import { routesTool } from './routes/RoutesTool'
import { skyTool } from './sky/SkyTool'
import { approachTool } from './approach/ApproachTool'
import { historyTool } from './history/HistoryTool'
import { terrainTool } from './terrain/TerrainTool'
import { cityPlanTool } from './cityplan/CityPlanTool'
import { populationTool } from './population/PopulationTool'
import { starsTool } from './stars/StarsTool'
import { systemsTool } from './systems/SystemsTool'
import { timelineTool } from './timeline/TimelineTool'
import { worldTool } from './world/WorldTool'

/** Every tool, in sidebar order. */
export const TOOLS = defineTools([
  timelineTool,
  starsTool,
  systemsTool,
  terrainTool,
  populationTool,
  cityPlanTool,
  routesTool,
  skyTool,
  approachTool,
  culturesTool,
  historyTool,
  calendarsTool,
  compareTool,
  checksTool,
  worldTool
])
