import { newLanding, type LandingFile, type LandingReport } from '@malevo/model'
import { useEffect, useState } from 'react'
import type { CalendarInfo, WorldSnapshot } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useFormatted, useWorldPref } from '../../state'
import { RideChart, RideFacts, fmtT } from './RideChart'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The landing planner: a hull, or its sections, brought down from orbit with a
 * ballute and chemical rockets, onto a pad or into the sea, then towed in and
 * beached on the tide. Works back from the touchdown time. Files: landings/<id>.json.
 */
function LandingsView({ world, snapshot, now, displayCal, focus }: ToolProps): React.JSX.Element {
  const [sel, setSel] = useWorldPref<string | null>(world.root, 'landing', null)
  // Opened on one: select it.
  useEffect(() => {
    if (focus) setSel(focus)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const landing = snapshot.landings.find((l) => l.id === sel) ?? snapshot.landings[0] ?? null
  const cal = displayCal ?? snapshot.calendars[0]?.id ?? 'gregorian'
  return (
    <div className="split-tool landings">
      <nav className="split-list">
        <h2>Landings</h2>
        <ul>
          {snapshot.landings.map((l) => (
            <li key={l.id}>
              <button
                className={l.id === landing?.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setSel(l.id)}
                data-landing={l.id}
              >
                <span>{String(l.value?.name ?? l.id)}</span>
                <span className="muted small">
                  {l.value
                    ? `${sig(Number(l.value.mass_t), 3)} t, ${l.value.sections} section${l.value.sections === 1 ? '' : 's'}`
                    : 'has errors'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <NewLanding snapshot={snapshot} now={now} onMade={setSel} />
      </nav>
      <div className="tool-page wide">
        {!landing?.value ? (
          <>
            <h1>Landings</h1>
            <p className="muted">
              Bring a hull down from orbit: a ballute takes the heat high up, chemical rockets do the last few hundred metres per second and
              the landing, onto a pad or into the sea. Split it into sections and they come down seconds apart along a line; tugs bring them
              in and the tide beaches them. Set the touchdown time and the planner works back to the deorbit burn.
            </p>
          </>
        ) : (
          <LandingEditor key={landing.id} id={landing.id} file={landing.value as unknown as LandingFile} snapshot={snapshot} cal={cal} />
        )}
      </div>
    </div>
  )
}

function NewLanding({ snapshot, now, onMade }: { snapshot: WorldSnapshot; now: number; onMade(id: string): void }): React.JSX.Element {
  const [name, setName] = useState('')
  const bodies = snapshot.systems.flatMap((s) => s.bodies)
  const body = bodies.find((b) => b.id === 'earth') ?? bodies.find((b) => (b.value as { atmosphere?: unknown }).atmosphere) ?? bodies[0]
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !body) return
        const id = slugId(
          name,
          snapshot.landings.map((l) => l.id)
        )
        void window.malevo.world.setEntity('landing', id, newLanding(name.trim(), body.id, now)).then(() => onMade(id))
        setName('')
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={body ? 'New landing…' : 'Add a planet first'}
        disabled={!body}
        id="newLandingName"
      />
      <button type="submit" disabled={!name.trim() || !body} id="newLanding">
        Add
      </button>
    </form>
  )
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function LandingEditor({
  id,
  file,
  snapshot,
  cal
}: {
  id: string
  file: LandingFile
  snapshot: WorldSnapshot
  cal: string
}): React.JSX.Element {
  const save = (next: LandingFile): void => void window.malevo.world.setEntity('landing', id, clean(next))
  const set = (patch: Partial<LandingFile>): void => save({ ...file, ...patch })
  const [report, setReport] = useState<LandingReport | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.landings.plan(id).then((r) => live && setReport(r))
    return () => {
      live = false
    }
  }, [id, snapshot.version])
  const r = report && !('error' in report) ? report : null
  const bodies = snapshot.systems.flatMap((s) =>
    s.bodies.filter((b) => b.cls !== 'belt').map((b) => ({ id: b.id, name: `${b.name} (${s.name})` }))
  )
  const cities = snapshot.cities.filter((c) => c.value?.body === file.body)
  const T = file.touchdown.t_s
  const when = useFormatted(
    cal,
    (r?.timeline ?? []).map((e) => ({ t: T + e.t, precision: 'minute' })),
    snapshot.version
  )
  const touchText = useFormatted(cal, [{ t: T, precision: 'minute' }], snapshot.version)[0]
  const trackAt = useFormatted(cal, file.track ? [{ t: file.track.at.t_s, precision: 'minute' }] : [], snapshot.version)[0]
  const orderAt = useFormatted(cal, file.track?.order ? [{ t: file.track.order.t_s, precision: 'minute' }] : [], snapshot.version)[0]
  const chanceText = useFormatted(
    cal,
    (r?.chances ?? []).flatMap((c) => [
      { t: c.burn, precision: 'minute' },
      { t: c.touchdown, precision: 'minute' }
    ]),
    snapshot.version
  )
  const climbFrom = useFormatted(cal, file.climb?.from ? [{ t: file.climb.from.t_s, precision: 'minute' }] : [], snapshot.version)[0]
  const slotText = useFormatted(
    cal,
    (r?.slots ?? []).flatMap((x) => [
      { t: x.open, precision: 'minute' },
      { t: x.best, precision: 'minute' },
      { t: x.close, precision: 'minute' },
      { t: x.best + x.alongside_s, precision: 'minute' }
    ]),
    snapshot.version
  )
  const pos = (f: (x: number) => void) => (x: number | undefined) => x !== undefined && x > 0 && f(x)
  return (
    <section className="landing" id="landingEditor">
      <div className="field-row">
        <TextField label="Landing" value={file.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} id="landingName" />
        <label className="field">
          On
          <select value={file.body} onChange={(e) => set({ body: e.target.value, city: undefined })} id="landingBody">
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Near (for the tides)
          <select value={file.city ?? ''} onChange={(e) => set({ city: e.target.value || undefined })} id="landingCity">
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.value?.name ?? c.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          First touchdown
          <DateInput
            calendars={snapshot.calendars as CalendarInfo[]}
            cal={file.touchdown.cal ?? cal}
            text={file.touchdown.text ?? touchText ?? ''}
            onCommit={(d) => set({ touchdown: { t_s: d.t, cal: d.cal, text: d.text } })}
            id="landingTouchdown"
          />
        </label>
      </div>
      <div className="field-row">
        <NumberField
          label="Coming down, t"
          value={file.mass_t}
          onCommit={pos((mass_t) => set({ mass_t }))}
          id="landingMass"
          hint="hull and cargo, torch cores out"
        />
        <ShipMass snapshot={snapshot} onPick={(mass_t) => set({ mass_t })} />
        <NumberField
          label="In sections"
          value={file.sections}
          onCommit={(x) => x !== undefined && x >= 1 && set({ sections: Math.round(x) })}
          id="landingSections"
        />
        {file.sections > 1 && (
          <NumberField
            label="Apart in orbit, km"
            value={file.spacing_km ?? 20}
            onCommit={(x) => x !== undefined && x >= 0 && set({ spacing_km: x })}
            id="landingSpacing"
          />
        )}
        <NumberField label="Orbit, km up" value={file.orbit_km} onCommit={pos((orbit_km) => set({ orbit_km }))} id="landingOrbit" />
      </div>
      <div className="field-row">
        <label className="field">
          Onto
          <select
            value={file.mode}
            onChange={(e) =>
              set({
                mode: e.target.value as 'pad' | 'splash',
                rockets: { ...file.rockets, touchdown_ms: e.target.value === 'splash' ? 5 : 2 },
                tow: e.target.value === 'splash' ? (file.tow ?? { offshore_km: 50, knots: 5 }) : undefined
              })
            }
            id="landingMode"
          >
            <option value="pad">a pad</option>
            <option value="splash">the sea, then towed in</option>
          </select>
        </label>
        {file.mode === 'splash' && (
          <>
            <NumberField
              label="Offshore, km"
              value={file.tow?.offshore_km ?? 50}
              onCommit={(x) => x !== undefined && x >= 0 && set({ tow: { offshore_km: x, knots: file.tow?.knots ?? 5 } })}
              id="landingOffshore"
            />
            <NumberField
              label="Tow speed, knots"
              value={file.tow?.knots ?? 5}
              onCommit={pos((knots) => set({ tow: { offshore_km: file.tow?.offshore_km ?? 50, knots } }))}
              id="landingKnots"
            />
          </>
        )}
      </div>
      <details className="kit">
        <summary>The descent kit</summary>
        <div className="field-row">
          <NumberField
            label="Ballute, kg per m²"
            value={file.ballute.beta_kg_m2}
            onCommit={pos((beta_kg_m2) => set({ ballute: { ...file.ballute, beta_kg_m2 } }))}
            hint="lower: bigger and gentler"
          />
          <NumberField
            label="Ballute lets go at, km"
            value={file.ballute.release_km}
            onCommit={(x) => x !== undefined && x >= 0 && set({ ballute: { ...file.ballute, release_km: x } })}
          />
          <NumberField
            label="Hull alone, kg per m²"
            value={file.hullBeta_kg_m2}
            onCommit={pos((hullBeta_kg_m2) => set({ hullBeta_kg_m2 }))}
            hint="how fast it falls without the ballute"
          />
          <NumberField
            label="Rocket exhaust, km/s"
            value={file.rockets.exhaust_kms}
            onCommit={pos((exhaust_kms) => set({ rockets: { ...file.rockets, exhaust_kms } }))}
            hint="chemical: about 3"
          />
          <NumberField
            label="Rocket thrust, g"
            value={file.rockets.thrust_g}
            onCommit={pos((thrust_g) => set({ rockets: { ...file.rockets, thrust_g } }))}
          />
          <NumberField
            label="Touchdown, m/s"
            value={file.rockets.touchdown_ms}
            onCommit={pos((touchdown_ms) => set({ rockets: { ...file.rockets, touchdown_ms } }))}
          />
        </div>
      </details>

      <details className="kit" open={Boolean(file.entry)} id="landingEntry">
        <summary>How hard it comes in</summary>
        <div className="field-row">
          <NumberField
            label="Aim the low point at, km"
            value={file.entry?.perigee_km}
            optional
            placeholder="about 50 (gentle)"
            onCommit={(x) => set({ entry: { ...file.entry, perigee_km: x } })}
            hint="below zero: into the ground, steeper and faster"
            id="landingPerigee"
          />
          <NumberField
            label="Lift over drag"
            value={file.entry?.lift}
            optional
            placeholder="0"
            onCommit={(x) => set({ entry: { ...file.entry, lift: x === undefined ? undefined : Math.max(0, Math.min(3, x)) } })}
            hint="0 falls like a stone; a capsule about 0.3"
            id="landingLift"
          />
          <label className="check">
            <input
              type="checkbox"
              checked={file.entry?.noBallute === true}
              onChange={(e) => set({ entry: { ...file.entry, noBallute: e.target.checked || undefined } })}
              id="landingPod"
            />
            No ballute: a pod with a heat shield
          </label>
          {file.entry?.noBallute && (
            <NumberField
              label="Shield nose radius, m"
              value={file.entry?.nose_m}
              optional
              placeholder="1"
              onCommit={(x) => set({ entry: { ...file.entry, nose_m: x !== undefined && x > 0 ? x : undefined } })}
            />
          )}
        </div>
      </details>

      <details className="kit" open={Boolean(file.track)} id="landingTrackBox">
        <summary>From the ship’s orbit: when can they go?</summary>
        {file.track ? (
          <>
            <div className="field-row">
              <NumberField
                label="Orbit tilt to the equator, °"
                value={file.track.inclination_deg}
                onCommit={(x) => x !== undefined && x >= 0 && x <= 180 && set({ track: { ...file.track!, inclination_deg: x } })}
                id="landingIncl"
              />
              <NumberField
                label="Crosses the equator northbound at, ° east"
                value={file.track.node_lon_deg}
                onCommit={(x) => x !== undefined && set({ track: { ...file.track!, node_lon_deg: ((x % 360) + 360) % 360 } })}
                id="landingNode"
              />
              <NumberField
                label="Ship this far past the crossing, °"
                value={file.track.arg_deg}
                onCommit={(x) => x !== undefined && set({ track: { ...file.track!, arg_deg: ((x % 360) + 360) % 360 } })}
                id="landingArg"
              />
            </div>
            <div className="field-row">
              <label className="field">
                At
                <DateInput
                  calendars={snapshot.calendars as CalendarInfo[]}
                  cal={file.track.at.cal ?? cal}
                  text={file.track.at.text ?? trackAt ?? ''}
                  onCommit={(d) => set({ track: { ...file.track!, at: { t_s: d.t, cal: d.cal, text: d.text } } })}
                />
              </label>
              <label className="field">
                The order comes
                <DateInput
                  calendars={snapshot.calendars as CalendarInfo[]}
                  cal={file.track.order?.cal ?? cal}
                  text={file.track.order?.text ?? orderAt ?? ''}
                  onCommit={(d) => set({ track: { ...file.track!, order: { t_s: d.t, cal: d.cal, text: d.text } } })}
                  id="landingOrder"
                />
              </label>
              <NumberField
                label="Can steer off the track, km"
                value={file.track.reach_km}
                optional
                placeholder={String(Math.round(25 + 400 * (file.entry?.lift ?? 0)))}
                onCommit={(x) => set({ track: { ...file.track!, reach_km: x } })}
              />
            </div>
            <div className="field-row">
              <NumberField
                label="Site latitude, °"
                value={file.site?.lat_deg}
                optional
                placeholder={file.city ? 'the city' : '—'}
                onCommit={(x) =>
                  set({ site: x === undefined ? undefined : { lat_deg: Math.max(-90, Math.min(90, x)), lon_deg: file.site?.lon_deg ?? 0 } })
                }
                id="landingSiteLat"
              />
              <NumberField
                label="Site longitude, ° east"
                value={file.site?.lon_deg}
                optional
                placeholder={file.city ? 'the city' : '—'}
                onCommit={(x) => set({ site: x === undefined ? undefined : { lat_deg: file.site?.lat_deg ?? 0, lon_deg: x } })}
                id="landingSiteLon"
              />
              <button className="link" onClick={() => set({ track: undefined })}>
                Forget the orbit
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() =>
              set({ track: { inclination_deg: 51.6, node_lon_deg: 0, arg_deg: 0, at: { t_s: file.touchdown.t_s - 3600, cal } } })
            }
            id="landingAddTrack"
          >
            Give the ship’s orbit
          </button>
        )}
        {r?.chances && (
          <table className="data small" id="landingChances">
            <thead>
              <tr>
                <th>Burn</th>
                <th>Down</th>
                <th>Off the site</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.chances.map((c, i) => (
                <tr key={c.burn}>
                  <td>{chanceText[i * 2] ?? '…'}</td>
                  <td>{chanceText[i * 2 + 1] ?? '…'}</td>
                  <td>{sig(c.miss_km, 2)} km</td>
                  <td>
                    <button className="link" onClick={() => set({ touchdown: { t_s: Math.round(c.touchdown), cal } })}>
                      Land then
                    </button>
                  </td>
                </tr>
              ))}
              {!r.chances.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No pass in the next two days{r.bestPass ? `; the closest misses by ${sig(r.bestPass.miss_km, 3)} km` : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </details>

      {
        <details className="kit" open={Boolean(file.climb)} id="landingClimbBox">
          <summary>Going back up: the climb, and when a lighter can launch to the ship</summary>
          {file.climb ? (
            <>
              <div className="field-row">
                <label className="field">
                  Not before
                  <DateInput
                    calendars={snapshot.calendars as CalendarInfo[]}
                    cal={file.climb.from?.cal ?? cal}
                    text={file.climb.from?.text ?? climbFrom ?? touchText ?? ''}
                    onCommit={(d) => set({ climb: { ...file.climb!, from: { t_s: d.t, cal: d.cal, text: d.text } } })}
                    id="climbFrom"
                  />
                </label>
                <NumberField
                  label="Velocity to spare for the turn, m/s"
                  value={file.climb.spare_ms}
                  optional
                  placeholder="100"
                  hint="More spare, longer slots."
                  onCommit={(x) => set({ climb: { ...file.climb!, spare_ms: x } })}
                  id="climbSpare"
                />
                <NumberField
                  label="Liftoff to orbit, min"
                  value={file.climb.ascent_min}
                  optional
                  placeholder={r?.climb && !r.climb.error ? String(Math.round(r.climb.toOrbit_s / 60)) : '10'}
                  hint="Leave blank to use the climb below."
                  onCommit={(x) => set({ climb: { ...file.climb!, ascent_min: x !== undefined && x > 0 ? x : undefined } })}
                />
                <NumberField
                  label="Drops this far below the ship to catch it, km"
                  value={file.climb.phasing_km}
                  optional
                  placeholder={String(Math.round(Math.min(150, file.orbit_km * 0.4)))}
                  onCommit={(x) => set({ climb: { ...file.climb!, phasing_km: x !== undefined && x > 0 ? x : undefined } })}
                />
                <button className="link" onClick={() => set({ climb: undefined })}>
                  Forget it
                </button>
              </div>
              <div className="field-row">
                <NumberField
                  label="Thrust over weight at liftoff"
                  value={file.climb.thrust_g}
                  optional
                  placeholder="1.5"
                  onCommit={(x) => set({ climb: { ...file.climb!, thrust_g: x !== undefined && x > 0 ? x : undefined } })}
                  id="climbThrust"
                />
                <NumberField
                  label="Throttles back to hold, g"
                  value={file.climb.max_g}
                  optional
                  placeholder="3"
                  hint="Crewed rockets keep to about 3 to 4 g."
                  onCommit={(x) => set({ climb: { ...file.climb!, max_g: x !== undefined && x > 0 ? x : undefined } })}
                  id="climbMaxG"
                />
                <NumberField
                  label="Exhaust speed, km/s"
                  value={file.climb.exhaust_kms}
                  optional
                  placeholder="4.4"
                  hint="Hydrogen and oxygen 4.4; kerosene 3.3."
                  onCommit={(x) => set({ climb: { ...file.climb!, exhaust_kms: x !== undefined && x > 0 ? x : undefined } })}
                />
                <NumberField
                  label="Mass per drag area, fuelled, kg/m²"
                  value={file.climb.beta_kg_m2}
                  optional
                  placeholder="50000"
                  hint="Lower is blunter or lighter: more drag, more shaking low down."
                  onCommit={(x) => set({ climb: { ...file.climb!, beta_kg_m2: x !== undefined && x > 0 ? x : undefined } })}
                />
              </div>
              {r?.climb && !r.climb.error && (
                <>
                  <dl className="facts" id="climbFacts">
                    <RideFacts ride={r.climb} />
                    <dt>The climb</dt>
                    <dd>
                      engines off at {fmtT(r.climb.meco_s)}
                      {r.climb.coast_s > 1 ? `, then ${duration(r.climb.coast_s)} weightless, coasting up to the orbit` : ''}
                      {r.climb.circ_s > 0.5 ? `, and a last burn of ${duration(r.climb.circ_s)} to match the ship` : ''}; in orbit at{' '}
                      {fmtT(r.climb.toOrbit_s)}
                    </dd>
                    <dt>What it takes</dt>
                    <dd>
                      {sig(r.climb.dv_ms / 1000, 3)} km/s from the engines, burning {Math.round(r.climb.propellantShare * 100)}% of the
                      lighter’s liftoff mass
                    </dd>
                  </dl>
                  <RideChart ride={r.climb} label="Going up: the push and the shaking, from liftoff" id="climbRide" />
                </>
              )}
              {!file.track && <p className="muted small">Give the ship’s orbit (above) for the launch slots.</p>}
              {r?.slots && (
                <table className="data small" id="launchSlots">
                  <thead>
                    <tr>
                      <th>Opens</th>
                      <th>Best</th>
                      <th>Closes</th>
                      <th>Heading</th>
                      <th>Turn at best</th>
                      <th>The ship</th>
                      <th>Alongside</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.slots.map((x, i) => (
                      <tr key={x.best}>
                        <td>{slotText[i * 4] ?? '…'}</td>
                        <td>{slotText[i * 4 + 1] ?? '…'}</td>
                        <td>{slotText[i * 4 + 2] ?? '…'}</td>
                        <td>{x.heading}</td>
                        <td>{x.dv_ms < 1 ? 'none' : `${sig(x.dv_ms, 2)} m/s`}</td>
                        <td>
                          {Math.abs(x.phase_deg) < 1
                            ? 'right there'
                            : `${sig(Math.abs(x.phase_deg), 2)}° ${x.phase_deg > 0 ? 'ahead' : 'behind'}`}
                        </td>
                        <td>
                          {slotText[i * 4 + 3] ?? '…'} <span className="muted">({duration(x.alongside_s)} after liftoff)</span>
                        </td>
                      </tr>
                    ))}
                    {!r.slots.length && (
                      <tr>
                        <td colSpan={7} className="muted">
                          No slot in the next three days.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              <p className="muted small">
                A slot is open while the site is near enough the ship’s orbital plane for the spare velocity to turn into it. Launching at
                its best moment, the lighter reaches orbit with the ship somewhere ahead or behind, and catches it in a lower orbit (or lets
                it catch up from a higher one); “alongside” adds half an hour to come up to it.
              </p>
            </>
          ) : (
            <button onClick={() => set({ climb: {} })} id="landingAddClimb">
              Plan the climb back up
            </button>
          )}
        </details>
      }

      {report && 'error' in report && <p className="error">{report.error}</p>}
      {r && (
        <div className="landing-results" id="landingResults">
          <dl className="facts">
            <dt>Each section</dt>
            <dd>
              {sig(r.section_t, 4)} t{r.heatOn === 'ballute' ? `, with a ballute ${sig(r.ballute_m, 3)} m across` : ', on its heat shield'}
            </dd>
            <dt>Rockets</dt>
            <dd>
              {sig(r.thrust_MN, 3)} MN each, burning {duration(r.burn_s)} for {sig(r.rocket_ms, 3)} m/s: {sig(r.propellant_t, 3)} t of
              propellant each, {sig(r.propellant_t * file.sections, 3)} t in all
            </dd>
            <dt>The ride</dt>
            <dd>
              into the air {sig(r.entryAngle_deg, 2)}° down after {duration(r.coast_s)} of coasting; peak {sig(r.peakDecel_g, 2)} g; peak
              heating on the {r.heatOn === 'ballute' ? 'ballute' : 'heat shield'} {sig(r.peakHeat_Wm2 / 1e4, 2)} W/cm²;{' '}
              {sig(r.release_ms, 3)} m/s at {file.ballute.release_km} km; {duration(r.descent_s)} from the burn to the ground
            </dd>
            <RideFacts ride={r.ride} />
            <dt>Orbit</dt>
            <dd>
              {sig(r.orbitSpeed / 1000, 3)} km/s, once around every {duration(r.orbitPeriod)}; deorbit burn {sig(r.deorbit_ms, 3)} m/s,{' '}
              {sig(r.downrange_km, 3)} km uprange
            </dd>
          </dl>
          <RideChart ride={r.ride} label="Coming down: the push and the shaking, from the deorbit burn" id="descentRide" />
          <table className="data small" id="landingTimeline">
            <thead>
              <tr>
                <th>When</th>
                <th />
                <th>What happens</th>
              </tr>
            </thead>
            <tbody>
              {r.timeline.map((e, i) => (
                <tr key={i}>
                  <td>{when[i] ?? '…'}</td>
                  <td className="muted">{e.t === 0 ? 'T' : `T${e.t < 0 ? '−' : '+'}${duration(Math.abs(e.t))}`}</td>
                  <td>{e.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.notes.length > 0 && (
            <ul className="notes">
              {r.notes.map((n) => (
                <li key={n} className="muted small">
                  {n}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            One straight-down pass in the orbit’s plane: the planet’s turning and the winds are left out. Times are to the minute or so; the
            burn times, speeds and propellant are what to trust.
          </p>
        </div>
      )}
    </section>
  )
}

function ShipMass({ snapshot, onPick }: { snapshot: WorldSnapshot; onPick(t: number): void }): React.JSX.Element | null {
  if (!snapshot.ships.length) return null
  return (
    <label className="field">
      From a ship
      <select
        value=""
        onChange={(e) => {
          const s = snapshot.ships.find((x) => x.id === e.target.value)
          if (s?.value) onPick(Number(s.value.dryMass_t))
        }}
        id="landingFromShip"
      >
        <option value="">—</option>
        {snapshot.ships.map((s) => (
          <option key={s.id} value={s.id}>
            {String(s.value?.name ?? s.id)} ({sig(Number(s.value?.dryMass_t), 3)} t dry)
          </option>
        ))}
      </select>
    </label>
  )
}

export const landingsTool: ToolDefinition = {
  id: 'landings',
  title: 'Landings',
  description: 'Bring a hull down from orbit: the descent kit, the timeline, the tow and the tide',
  View: LandingsView
}
