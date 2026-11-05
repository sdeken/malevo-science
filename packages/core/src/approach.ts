/**
 * Approach-scale planning, generalized from the prototype lee-planner: a ship
 * comes in through the foam on a straight line, drops where the foam first
 * collapses (or where it chooses to cut, earlier), and crawls by torch to its
 * port, flipping halfway. Moving the aim, or a giant planet's tide partly
 * cancelling the star's (its "lee"), moves the drop and so the crawl.
 */
import { firstCollapseAlong, type FoamSettings, type MassPoint } from './foam'
import { flipAndBurnTime } from './torch'
import { distance, type Vec3 } from './vec'

export interface ApproachLine {
  /** The point the line is aimed through, m (system frame). */
  aim: Vec3
  /** Unit vector from the aim back toward where the ship comes from. */
  back: Vec3
}

export interface ApproachResult {
  /** Where the foam collapses, m; null if it holds the whole way along the line. */
  drop: Vec3 | null
  /** Distance from the drop to the port, m. */
  crawlDistance: number | null
  /** Flip-and-burn time from the drop to the port, s. */
  crawl: number | null
}

/**
 * Drop and crawl for one line. `reach` is how far back along the line to
 * start looking (a few collapse radii); `steps` sets the scan resolution.
 * The ship crawls to `port` at `accel`.
 */
export function approachAlong(
  line: ApproachLine,
  bodies: readonly MassPoint[],
  foam: Pick<FoamSettings, 'collapseRadius' | 'rule'>,
  port: Vec3,
  accel: number,
  reach: number,
  steps = 600
): ApproachResult {
  const s = firstCollapseAlong(line.aim, line.back, bodies, foam, reach, -reach, (2 * reach) / steps)
  if (s === null) return { drop: null, crawlDistance: null, crawl: null }
  const drop: Vec3 = [line.aim[0] + s * line.back[0], line.aim[1] + s * line.back[1], line.aim[2] + s * line.back[2]]
  const d = distance(drop, port)
  return { drop, crawlDistance: d, crawl: flipAndBurnTime(d, accel) }
}

/** Two unit vectors spanning the plane perpendicular to `back`: the aim plane's axes. */
export function aimPlane(back: Vec3): { x: Vec3; y: Vec3 } {
  const ref: Vec3 = Math.abs(back[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const x0: Vec3 = [ref[1] * back[2] - ref[2] * back[1], ref[2] * back[0] - ref[0] * back[2], ref[0] * back[1] - ref[1] * back[0]]
  const n = Math.hypot(x0[0], x0[1], x0[2])
  const x: Vec3 = [x0[0] / n, x0[1] / n, x0[2] / n]
  const y: Vec3 = [back[1] * x[2] - back[2] * x[1], back[2] * x[0] - back[0] * x[2], back[0] * x[1] - back[1] * x[0]]
  return { x, y }
}

/** The line aimed `dx`, `dy` metres off `aim` in the aim plane. */
export function offsetLine(line: ApproachLine, dx: number, dy: number): ApproachLine {
  const { x, y } = aimPlane(line.back)
  return {
    aim: [line.aim[0] + dx * x[0] + dy * y[0], line.aim[1] + dx * x[1] + dy * y[1], line.aim[2] + dx * x[2] + dy * y[2]],
    back: line.back
  }
}

/**
 * Best and worst crawl for every deflection within `margin` of the aim
 * (sampled on the circle and the centre), as a navigator plans for.
 */
export function marginRange(
  line: ApproachLine,
  margin: number,
  run: (l: ApproachLine) => ApproachResult,
  samples = 45
): { best: number | null; worst: number | null } {
  const results = [run(line)]
  for (let k = 0; k < samples && margin > 0; k++) {
    const a = (2 * Math.PI * k) / samples
    results.push(run(offsetLine(line, margin * Math.cos(a), margin * Math.sin(a))))
  }
  const crawls = results.map((r) => r.crawl)
  if (crawls.some((c) => c === null)) return { best: null, worst: null }
  return { best: Math.min(...(crawls as number[])), worst: Math.max(...(crawls as number[])) }
}
