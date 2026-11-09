/**
 * The Shipyard: a ship built from parts. What each part weighs, how much
 * power the torches put into the jet, how much heat is left over, and whether
 * the radiators can shed it. The results set the ship's dry mass, propellant,
 * engines, thrust and exhaust speed, which the trip planner flies.
 *
 * Every coefficient is a world setting (physics.design) with a default here.
 * The defaults are chosen so a five-torch freighter like the Sandpiper (about
 * 6,800 t dry, 750 TW) comes out about right; they are not canon.
 */
import { C } from '@malevo/core'
import type { PhysicsSettings, ShipFile } from './kinds'

const SIGMA = 5.670374419e-8

export interface DesignAssumptions {
  torch_t_per_TW: number
  torchEfficiency: number
  heatToExhaust: number
  plant_t_per_GW: number
  plantEfficiency: number
  radiator_kg_per_m2: number
  radiator_K: number
  tankFraction: number
  propellantDensity_kg_m3: number
  crew_t_each: number
  hotel_MW_each: number
  holdFraction: number
}

export const DESIGN_DEFAULTS: DesignAssumptions = {
  torch_t_per_TW: 2,
  torchEfficiency: 0.95,
  heatToExhaust: 0.999,
  plant_t_per_GW: 20,
  plantEfficiency: 0.6,
  radiator_kg_per_m2: 6,
  radiator_K: 1500,
  tankFraction: 0.12,
  propellantDensity_kg_m3: 71,
  crew_t_each: 15,
  hotel_MW_each: 0.05,
  holdFraction: 0.08
}

export const DESIGN_LABELS: Record<keyof DesignAssumptions, { label: string; unit: string }> = {
  torch_t_per_TW: { label: 'Torch mass', unit: 't per TW of jet' },
  torchEfficiency: { label: 'Torch efficiency', unit: 'share into the jet' },
  heatToExhaust: { label: 'Waste heat into the exhaust', unit: 'share' },
  plant_t_per_GW: { label: 'Power plant mass', unit: 't per GW' },
  plantEfficiency: { label: 'Power plant efficiency', unit: 'share' },
  radiator_kg_per_m2: { label: 'Radiator mass', unit: 'kg per m²' },
  radiator_K: { label: 'Radiator temperature', unit: 'K' },
  tankFraction: { label: 'Tank mass', unit: 'share of the propellant' },
  propellantDensity_kg_m3: { label: 'Propellant density', unit: 'kg/m³' },
  crew_t_each: { label: 'Per person aboard', unit: 't (living space, life support, stores)' },
  hotel_MW_each: { label: 'Hotel power per person', unit: 'MW' },
  holdFraction: { label: 'Hold structure', unit: 'share of the cargo it takes' }
}

export function designAssumptions(physics: PhysicsSettings | null | undefined): DesignAssumptions {
  const d = physics?.design ?? {}
  const out = { ...DESIGN_DEFAULTS }
  for (const k of Object.keys(out) as (keyof DesignAssumptions)[]) {
    const v = d[k]
    if (typeof v === 'number') out[k] = v
  }
  return out
}

export type ShipDesign = NonNullable<ShipFile['design']>

export interface DesignReport {
  /** Mass of each part, tonnes, largest first. */
  parts: { name: string; mass_t: number }[]
  dry_t: number
  propellant_t: number
  load_t: number
  full_t: number
  exhaust_c: number
  /** Total thrust, N. */
  thrust_N: number
  /** Jet power, all torches, W. */
  jetPower_W: number
  /** Fusion power the torches burn at full thrust, W. */
  torchFusion_W: number
  /** Heat left for the radiators at full thrust (torches, plant and hotel), W. */
  heatBurning_W: number
  /** Heat left for the radiators while coasting or in the foam (plant and hotel), W. */
  heatCoasting_W: number
  /** What the radiators can shed, W. */
  radiators_W: number
  /** Radiator area needed at full thrust, m². */
  radiatorsNeeded_m2: number
  /** Acceleration at full thrust: laden with full tanks, and empty with no load, m/s². */
  accelFull: number
  accelEmpty: number
  /** Velocity change on full tanks, laden, m/s. */
  dv: number
  /** Full-thrust burn time on a full tank, s. */
  burnTime: number
  tankVolume_m3: number
  /** Power the plant must supply (foam field and hotel), W. */
  plantDemand_W: number
  problems: string[]
}

export function designReport(design: ShipDesign, ship: Pick<ShipFile, 'foamPower_GW'>, physics: PhysicsSettings | null): DesignReport {
  const a = designAssumptions(physics)
  const exhaust_c = design.torches.exhaust_c ?? physics?.torch.exhaustSpeed_c ?? 0.05
  const ve = exhaust_c * C
  const thrust = design.torches.count * design.torches.thrust_MN * 1e6
  const jet = (thrust * ve) / 2
  const torchFusion = jet / a.torchEfficiency
  const torch_t = (jet / 1e12) * a.torch_t_per_TW
  const hotel = design.crew * a.hotel_MW_each * 1e6
  const plantDemand = (ship.foamPower_GW ?? 0) * 1e9 + hotel
  const plant_t = design.plant_GW * a.plant_t_per_GW
  const plantHeat = design.plant_GW * 1e9 * (1 / a.plantEfficiency - 1) + Math.min(plantDemand, design.plant_GW * 1e9)
  const torchHeat = (torchFusion - jet) * (1 - a.heatToExhaust)
  const radiatorFlux = 2 * 0.9 * SIGMA * a.radiator_K ** 4
  const radiators_W = design.radiators_m2 * radiatorFlux
  const radiators_t = (design.radiators_m2 * a.radiator_kg_per_m2) / 1000
  const tanks_t = design.tanks_t * a.tankFraction
  const crew_t = design.crew * a.crew_t_each
  const hold_t = design.cargo_t * a.holdFraction
  const parts = [
    { name: 'Hull and frame', mass_t: design.hull_t },
    { name: `Torches (${design.torches.count})`, mass_t: torch_t },
    { name: 'Tanks', mass_t: tanks_t },
    { name: 'Power plant', mass_t: plant_t },
    { name: 'Radiators', mass_t: radiators_t },
    { name: `Living space (${design.crew} aboard)`, mass_t: crew_t },
    { name: 'Hold', mass_t: hold_t },
    { name: 'Armour and shielding', mass_t: design.shielding_t ?? 0 },
    ...(design.extras ?? []).map((x) => ({ name: x.name, mass_t: x.mass_t }))
  ]
    .filter((p) => p.mass_t > 0)
    .sort((x, y) => y.mass_t - x.mass_t)
  const dry_t = parts.reduce((s, p) => s + p.mass_t, 0)
  const load_t = Math.min(design.load_t ?? 0, design.cargo_t)
  const full_t = dry_t + design.tanks_t + load_t
  const heatBurning = torchHeat + plantHeat
  const problems: string[] = []
  if (radiators_W < heatBurning)
    problems.push(
      `The radiators shed ${fmtW(radiators_W)}, but at full thrust there is ${fmtW(heatBurning)} of waste heat: it needs about ${Math.ceil(heatBurning / radiatorFlux).toLocaleString('en')} m² of radiators, or a burn shorter than the hull can soak.`
    )
  if (design.plant_GW * 1e9 < plantDemand)
    problems.push(`The power plant makes ${fmtW(design.plant_GW * 1e9)}, but the foam field and the hotel load need ${fmtW(plantDemand)}.`)
  if ((design.load_t ?? 0) > design.cargo_t)
    problems.push(`The load (${design.load_t} t) is more than the hold takes (${design.cargo_t} t).`)
  return {
    parts,
    dry_t,
    propellant_t: design.tanks_t,
    load_t,
    full_t,
    exhaust_c,
    thrust_N: thrust,
    jetPower_W: jet,
    torchFusion_W: torchFusion,
    heatBurning_W: heatBurning,
    heatCoasting_W: plantHeat,
    radiators_W,
    radiatorsNeeded_m2: heatBurning / radiatorFlux,
    accelFull: thrust / (full_t * 1000),
    accelEmpty: thrust / (dry_t * 1000),
    dv: ve * Math.log(full_t / (dry_t + load_t)),
    burnTime: (design.tanks_t * 1000 * ve) / thrust,
    tankVolume_m3: (design.tanks_t * 1000) / a.propellantDensity_kg_m3,
    plantDemand_W: plantDemand,
    problems
  }
}

function fmtW(w: number): string {
  const units: [number, string][] = [
    [1e15, 'PW'],
    [1e12, 'TW'],
    [1e9, 'GW'],
    [1e6, 'MW'],
    [1e3, 'kW']
  ]
  for (const [f, u] of units) if (Math.abs(w) >= f) return `${(w / f).toPrecision(3)} ${u}`
  return `${w.toPrecision(3)} W`
}

/**
 * The ship's flying numbers from its design: the fields the trip planner
 * reads. The load counts as dry mass for trips (it doesn't burn).
 */
export function applyDesign(ship: ShipFile, physics: PhysicsSettings | null): ShipFile {
  if (!ship.design) return ship
  const r = designReport(ship.design, ship, physics)
  const next: ShipFile = {
    ...ship,
    dryMass_t: round(r.dry_t + r.load_t),
    propellant_t: round(r.propellant_t),
    engines: ship.design.torches.count === 1 ? undefined : ship.design.torches.count,
    thrust_MN: ship.design.torches.thrust_MN
  }
  if (ship.design.torches.exhaust_c !== undefined) next.exhaustSpeed_c = ship.design.torches.exhaust_c
  else delete next.exhaustSpeed_c
  if (next.engines === undefined) delete next.engines
  return next
}

const round = (x: number): number => Number(x.toPrecision(6))

/** A starting design: roughly a Sandpiper-class freighter. */
export function newDesign(): ShipDesign {
  return {
    hull_t: 2000,
    crew: 12,
    cargo_t: 2000,
    load_t: 1500,
    tanks_t: 3900,
    torches: { count: 5, thrust_MN: 21 },
    plant_GW: 30,
    radiators_m2: 200000,
    shielding_t: 400
  }
}
