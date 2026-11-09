import { newLanding, type LandingFile, type LandingReport } from '@malevo/model'
import { useEffect, useState } from 'react'
import type { CalendarInfo, WorldSnapshot } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useFormatted, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The landing planner: a hull, or its sections, brought down from orbit with a
 * ballute and chemical rockets, onto a pad or into the sea, then towed in and
 * beached on the tide. Works back from the touchdown time. Files: landings/<id>.json.
 */
function LandingsView({ world, snapshot, now, displayCal }: ToolProps): React.JSX.Element {
  const [sel, setSel] = useWorldPref<string | null>(world.root, 'landing', null)
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

      {report && 'error' in report && <p className="error">{report.error}</p>}
      {r && (
        <div className="landing-results" id="landingResults">
          <dl className="facts">
            <dt>Each section</dt>
            <dd>
              {sig(r.section_t, 4)} t, with a ballute {sig(r.ballute_m, 3)} m across
            </dd>
            <dt>Rockets</dt>
            <dd>
              {sig(r.thrust_MN, 3)} MN each, burning {duration(r.burn_s)} for {sig(r.rocket_ms, 3)} m/s: {sig(r.propellant_t, 3)} t of
              propellant each, {sig(r.propellant_t * file.sections, 3)} t in all
            </dd>
            <dt>The ride</dt>
            <dd>
              peak {sig(r.peakDecel_g, 2)} g; peak heating on the ballute {sig(r.peakHeat_Wm2 / 1e4, 2)} W/cm²; {sig(r.release_ms, 3)} m/s
              when it lets go
            </dd>
            <dt>Orbit</dt>
            <dd>
              {sig(r.orbitSpeed / 1000, 3)} km/s, once around every {duration(r.orbitPeriod)}; deorbit burn {sig(r.deorbit_ms, 3)} m/s,{' '}
              {sig(r.downrange_km, 3)} km uprange
            </dd>
          </dl>
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
