/**
 * Ship traffic as directed flows (docs/PLAN.md §6).
 *
 * Traffic is entered two ways, which both resolve to per-edge numbers:
 * - edge flows: ships per day on one directed edge (A → B and B → A are
 *   independent);
 * - itineraries: a one-way path through several stops at some frequency
 *   (A → R → B at 17 a day), which makes through traffic explicit.
 *
 * Balance is checked, not forced. At each node, average arrivals should equal
 * average departures, except for a declared net imbalance (a ship graveyard is
 * a sink, a shipyard a source). Every edge leaves one node and enters another,
 * so across the whole network arrivals always equal departures: declared sinks
 * must be matched by sources somewhere, and the report says when they are not.
 *
 * Rates are ships per standard day (86,400 s).
 */
import { DAY } from './units'
import { compareStrings } from './strings'

export interface EdgeFlow {
  from: string
  to: string
  perDay: number
}

export interface Itinerary {
  id: string
  /** At least two stops; consecutive stops must differ. */
  stops: string[]
  perDay: number
}

export interface FlowNetwork {
  edges: readonly EdgeFlow[]
  itineraries: readonly Itinerary[]
  /** Declared net imbalance per node, ships/day: positive for a sink (more arrive than leave), negative for a source. */
  declared?: Readonly<Record<string, number>>
}

export interface EdgeTotal {
  from: string
  to: string
  perDay: number
  /** Of which entered directly as edge flows. */
  direct: number
  /** Of which from itineraries. */
  viaItineraries: number
}

export interface NodeBalance {
  node: string
  arrivals: number
  departures: number
  /** arrivals − departures. */
  net: number
  declared: number
  /** net − declared: what the checker cares about. */
  imbalance: number
  /** Itinerary ships passing through (arriving and leaving again). */
  through: number
}

export interface BalanceTolerance {
  /** Fraction of the node's total traffic (arrivals + departures). */
  fraction: number
  /** Absolute floor, ships/day. */
  perDay: number
}

export const edgeKey = (from: string, to: string): string => `${from}→${to}`

/** Per-edge totals, sorted by key so results never depend on input order. */
export function edgeTotals(net: FlowNetwork): EdgeTotal[] {
  const map = new Map<string, EdgeTotal>()
  const get = (from: string, to: string): EdgeTotal => {
    const k = edgeKey(from, to)
    let e = map.get(k)
    if (!e) map.set(k, (e = { from, to, perDay: 0, direct: 0, viaItineraries: 0 }))
    return e
  }
  for (const e of net.edges) {
    const t = get(e.from, e.to)
    t.direct += e.perDay
    t.perDay += e.perDay
  }
  for (const it of net.itineraries) {
    for (let i = 0; i < it.stops.length - 1; i++) {
      const t = get(it.stops[i], it.stops[i + 1])
      t.viaItineraries += it.perDay
      t.perDay += it.perDay
    }
  }
  return [...map.keys()].sort().map((k) => map.get(k)!)
}

/** Arrivals, departures and imbalance at every node that has traffic or a declaration, sorted by node id. */
export function nodeBalances(net: FlowNetwork): NodeBalance[] {
  const nodes = new Map<string, NodeBalance>()
  const get = (n: string): NodeBalance => {
    let b = nodes.get(n)
    if (!b) nodes.set(n, (b = { node: n, arrivals: 0, departures: 0, net: 0, declared: 0, imbalance: 0, through: 0 }))
    return b
  }
  for (const e of edgeTotals(net)) {
    get(e.from).departures += e.perDay
    get(e.to).arrivals += e.perDay
  }
  for (const it of net.itineraries) for (let i = 1; i < it.stops.length - 1; i++) get(it.stops[i]).through += it.perDay
  for (const [n, d] of Object.entries(net.declared ?? {})) get(n).declared = d
  for (const b of nodes.values()) {
    b.net = b.arrivals - b.departures
    b.imbalance = b.net - b.declared
  }
  return [...nodes.keys()].sort().map((k) => nodes.get(k)!)
}

/** The largest imbalance a node may carry without a warning. */
export function allowedImbalance(b: NodeBalance, tol: BalanceTolerance): number {
  return Math.max(tol.fraction * (b.arrivals + b.departures), tol.perDay)
}

export interface BalanceReport {
  nodes: NodeBalance[]
  /** Nodes whose imbalance exceeds the tolerance. */
  unbalanced: NodeBalance[]
  /** Σ declared imbalances: should be 0, since the network's arrivals and departures always match overall. */
  declaredTotal: number
}

export function balanceReport(net: FlowNetwork, tol: BalanceTolerance): BalanceReport {
  const nodes = nodeBalances(net)
  return {
    nodes,
    unbalanced: nodes.filter((b) => Math.abs(b.imbalance) > allowedImbalance(b, tol)),
    declaredTotal: nodes.reduce((s, b) => s + b.declared, 0)
  }
}

export interface CandidateEdge {
  from: string
  to: string
  /** Cost per ship, in any consistent unit (trip time, say). Must be ≥ 0. */
  cost: number
}

export interface BalanceProposal {
  /** Flows to add, ships/day, sorted by edge. */
  additions: EdgeFlow[]
  /** Total cost of the additions. */
  cost: number
  /** Imbalance that could not be removed (no route, or declarations that do not cancel), by node. */
  remaining: Record<string, number>
}

/**
 * The cheapest set of added flows, on the candidate edges, that brings every
 * node to its declared imbalance (a minimum-cost flow, by successive shortest
 * paths). It only proposes; nothing is applied.
 */
export function proposeBalancing(net: FlowNetwork, candidates: readonly CandidateEdge[], epsilon = 1e-9): BalanceProposal {
  // supply > 0: the node receives too many ships, so it needs extra departures.
  const supply = new Map<string, number>()
  for (const b of nodeBalances(net)) if (Math.abs(b.imbalance) > epsilon) supply.set(b.node, b.imbalance)
  const nodes = [...new Set([...supply.keys(), ...candidates.flatMap((c) => [c.from, c.to])])].sort()
  const index = new Map(nodes.map((n, i) => [n, i]))
  const cands = [...candidates]
    .filter((c) => c.from !== c.to && c.cost >= 0)
    .sort((a, b) => compareStrings(edgeKey(a.from, a.to), edgeKey(b.from, b.to)))
  const added = new Array<number>(cands.length).fill(0)
  // Sources no candidate route can relieve are set aside here.
  const stuck = new Map<string, number>()

  for (let guard = 0; guard < 10_000; guard++) {
    const source = nodes.find((n) => (supply.get(n) ?? 0) > epsilon)
    if (!source) break
    // Bellman–Ford from the source over the residual graph: forward edges (cost c, unbounded), backward along added flow (cost −c).
    const dist = new Array<number>(nodes.length).fill(Infinity)
    const via = new Array<{ edge: number; forward: boolean } | null>(nodes.length).fill(null)
    dist[index.get(source)!] = 0
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false
      cands.forEach((c, k) => {
        const u = index.get(c.from)!
        const v = index.get(c.to)!
        if (dist[u] + c.cost < dist[v] - 1e-12) {
          dist[v] = dist[u] + c.cost
          via[v] = { edge: k, forward: true }
          changed = true
        }
        if (added[k] > epsilon && dist[v] - c.cost < dist[u] - 1e-12) {
          dist[u] = dist[v] - c.cost
          via[u] = { edge: k, forward: false }
          changed = true
        }
      })
      if (!changed) break
    }
    // The nearest node that needs arrivals.
    let sink = -1
    nodes.forEach((n, i) => {
      if ((supply.get(n) ?? 0) < -epsilon && dist[i] < Infinity && (sink < 0 || dist[i] < dist[sink])) sink = i
    })
    if (sink < 0) {
      stuck.set(source, supply.get(source)!)
      supply.set(source, 0)
      continue
    }
    // Walk back, finding the bottleneck.
    let amount = Math.min(supply.get(source)!, -supply.get(nodes[sink])!)
    for (let v = sink; v !== index.get(source);) {
      const step = via[v]!
      const c = cands[step.edge]
      if (!step.forward) amount = Math.min(amount, added[step.edge])
      v = index.get(step.forward ? c.from : c.to)!
    }
    for (let v = sink; v !== index.get(source);) {
      const step = via[v]!
      const c = cands[step.edge]
      added[step.edge] += step.forward ? amount : -amount
      v = index.get(step.forward ? c.from : c.to)!
    }
    supply.set(source, supply.get(source)! - amount)
    supply.set(nodes[sink], supply.get(nodes[sink])! + amount)
  }

  const remaining: Record<string, number> = {}
  for (const [n, s] of supply) if (Math.abs(s) > epsilon) remaining[n] = s
  for (const [n, s] of stuck) remaining[n] = (remaining[n] ?? 0) + s
  const additions: EdgeFlow[] = []
  let cost = 0
  cands.forEach((c, k) => {
    if (added[k] > epsilon) {
      additions.push({ from: c.from, to: c.to, perDay: added[k] })
      cost += added[k] * c.cost
    }
  })
  return { additions, cost, remaining }
}

// ---- Little's law ----

/** Ships under way on an edge: flow × trip time. */
export function shipsInTransit(perDay: number, tripTime_s: number): number {
  return (perDay * tripTime_s) / DAY
}

/**
 * Ships tied up by one itinerary: its frequency times its whole duration
 * (every leg plus every intermediate dwell). `legTime(from, to)` and
 * `dwell(node)` are in seconds.
 */
export function itineraryFleet(it: Itinerary, legTime: (from: string, to: string) => number, dwell: (node: string) => number): number {
  let T = 0
  for (let i = 0; i < it.stops.length - 1; i++) T += legTime(it.stops[i], it.stops[i + 1])
  for (let i = 1; i < it.stops.length - 1; i++) T += dwell(it.stops[i])
  return (it.perDay * T) / DAY
}
