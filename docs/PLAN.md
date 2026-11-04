# Malevo Science: Plan

Malevo Science is a desktop app for planning, checking and visualizing the setting of the
story-thing series. It models stars, planets, routes, traffic, calendars, cultures, history and
cities, so the details stay the same from one story to the next.

This document covers:

- what the app must guarantee,
- the architecture that delivers those guarantees,
- the order the work happens in.

It is a living plan. Decisions that are still open are collected in
[Open decisions](#open-decisions). Each one has a recommendation, and nothing in the plan is
blocked on them.

---

## 1. The two guarantees

Everything else follows from these two.

### G1. The world is text in git, and it does not shift under you

All world data is plain text files, written for clean diffs and committed to git. Most of the world
is procedural, so the main risk is a *cascade*: a change to one generator or one input ripples
outward and quietly changes things that stories already depend on. Section 3, the stability
contract, is the defense against this. It is the first thing built and the last thing compromised.

### G2. One model, many views

Every tool reads one shared world model through one shared library of functions. No tool keeps
its own copy of a constant, an orbit or a route. The test of this:

> If the route network says three lanes touch Altaris, the night-sky view from Bluff shows exactly
> those three lanes. The number of torches visible along each lane equals that lane's ship flow
> multiplied by the time a ship spends on the in-system crawl. Port capacity is checked against
> that same flow.

The existing tools break this today. The survey of `story-thing/tools/` found:

- **Two different random-number generators.** The star-map, settlement and city generators use
  mulberry32; torchlight uses xorshift32.
- **Constants in two unit systems.** AU and g are defined in metres in three tools and in
  kilometres in torchlight.
- **The 1 g flip-and-brake crawl implemented separately four times.**
- **Bluff transit speeds that disagree.** The terrace tram is 15 km/h in the maps and 43 km/h
  in the city file. The field line is 60 km/h in one place and 90 km/h in another.
- **Three different collapse thresholds:** 2.58, 2.70 and 2.85 AU.
- **Two unrelated skies.** Torchlight's is a random starfield and star-map's is the real
  catalogue. Neither is computed from where Altaris actually is.

The app replaces these copies with one library (section 4).

---

## 2. Shape of the system

```
┌───────────────────────── Electron shell (apps/desktop) ─────────────────────────┐
│  main: window, menus, file access, git status, auto-update, worker pool         │
│  preload: typed, namespaced IPC bridge (devlog pattern)                         │
│  renderer: tool host — one tab/pane per tool, shared selection & "current time" │
│     ├─ Timeline  ├─ Cultures  ├─ History  ├─ Systems  ├─ Routes                 │
│     └─ Terrain   ├─ Population ├─ Cities  ├─ Sky (torchlight)  ├─ Checks        │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ all tools call the same packages
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│ @malevo/viz    shared renderers: star map, orbit view, globe, sky, city 3D      │
│ @malevo/gen    versioned, seeded generators (stars, systems, terrain, history…) │
│ @malevo/model  schemas, world loader/saver, references, queries, validators     │
│ @malevo/core   units, constants, RNG, vectors, time & calendars, orbits, foam,  │
│                torch, frames, ephemeris, kinematics — pure TS, no I/O, no DOM   │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ read / write canonical text
                         ┌─────────▼─────────┐        ┌──────────────────────────┐
                         │ world folder (git)│◄───────┤ malevo CLI: check / gen / │
                         └───────────────────┘        │ query / report (CI, Claude)│
                                                      └──────────────────────────┘
```

**Design rules:**

- **`@malevo/core` and `@malevo/model` do not depend on Electron or the DOM.** The command-line
  tool, the tests and CI on the data repo all run them under plain Node. Claude sessions in the
  story-thing repo can then run `malevo check` or `malevo query` without opening the app.
- **Only `@malevo/model` writes world files.** The renderer never touches the file system; it
  goes through IPC, as in devlog.
- **The world is a folder, opened the way devlog opens a repo.** The app is one repo and the world
  data lives in another; see [D1](#d1-where-the-world-data-lives). The app shows git status and can
  commit, but it does not commit or push automatically
  ([D7](#d7-git-integration-level)). Canon changes should be deliberate commits.
- **Heavy work runs in worker threads:** generation, history simulation, terrain rasters and route
  searches. Results are cached on disk under userData, keyed by the hash of their inputs, and never
  stored in the world folder.
- **Tools are internal modules behind a small registry interface:** id, title, views, commands,
  and the entity kinds they edit. This is simpler than devlog's sandboxed extension host, which is
  built for third-party code that we don't have. Any tool can be pulled out into an extension
  later if needed.

---

## 3. The stability contract (guarantee G1 in detail)

### 3.1 Three tiers of data

| Tier | What it is | Stored? | Can a generator change it? |
|---|---|---|---|
| **Authored** | Typed in by the author, or imported from canon | Yes, as values | Never |
| **Locked** | Generated, then accepted ("roll, then lock") | Yes: values, plus the seed and generator version that made them | Never; only an explicit re-roll |
| **Derived** | Computed on demand from the two tiers above (positions at a date, sky, traffic per edge, terrain rasters) | No; it lives only in the cache | Yes, freely |

**The rule:** anything a story depends on must be Authored or Locked. A derived value can be
promoted with a single "Lock" action. A Locked record keeps its values, so a later change to a
generator cannot reach it.

### 3.2 Keyed randomness

- **Every random stream comes from a stable key, not from a position in a sequence:**
  `stream = rng(hash(worldSeed, generatorId, entityId, purpose))`. Adding, removing or reordering
  one entity therefore cannot change the random numbers any other entity gets. This is the
  approach `star-gen.js` already takes per 25 ly cube and `city-gen.js` takes per object; it
  becomes the only allowed approach.
- **The algorithms are fixed:** mulberry32 for streams and an FNV-1a-style hash for keys. The
  existing generators already use both, so imported atlas and city data keep reproducing exactly.
  `Math.random` is banned in model and generator code by a lint rule.
- **Iteration always follows a stable sort by id,** never insertion order or object-key order.
- **Spatial generation is per cell,** as with the star-map cubes. Widening the radius adds cells
  and does not reshuffle the existing ones.

### 3.3 Frozen generator versions

- Each generator is `name@version`. Once a version has produced a Locked record, its code is
  frozen. A fix or improvement becomes a new version that sits alongside the old one.
- Each record names the version that produced it (`"gen": "terrain@1"`), so it can always be
  regenerated exactly, for example to rebuild a cached texture.
- Moving a record to a newer version is an explicit, per-record action. The app shows a before
  and after diff first.
- **Golden fixtures in CI:** for every frozen generator version, a set of seeds and the hashes of
  the outputs they produce. If any frozen output changes, CI fails, whether the cause is a code
  change, an Electron/V8 upgrade or a floating-point surprise.

### 3.4 Explicit dependencies and staleness

- Derived values record their inputs, as entity ids plus versions/hashes. When an input changes,
  only what depends on it is recomputed.
- **Locked values whose inputs have since changed are flagged *stale*, not rewritten.** Example:
  you lock a city's climate, then change the planet's axial tilt. The checks panel lists every
  stale item with the old value and the value the current inputs would give. You choose to
  accept or re-roll each one.
- This is how "change one thing" stays local. The app tells you what a change *would* affect
  before anything is rewritten.

### 3.5 File format

These rules carry over from devlog, adapted for structured data:

- **One entity per file,** in a folder per kind (`systems/altaris/system.json`,
  `events/charter.json`). Small files make for small diffs and few merge conflicts.
- **Canonical serialization:**
  - Keys appear in the schema's order, not alphabetically, so files read logically.
  - Two-space indent, LF line endings, trailing newline.
  - Each numeric field has a declared precision, so values never churn at the 15th digit. This
    avoids diffs like `0.30000000000000004`.
  - Short arrays of numbers stay on one line.
  - The app formats on every save, and `malevo check --fix` re-formats hand edits.
- **The format is JSON, checked against schemas (zod).** Prose lives in a Markdown sidebar file
  next to the entity (`altaris.md`) rather than in JSON strings
  ([D2](#d2-file-format)).
- **Units are explicit in the key name** (`semiMajorAxis_au`, `period_d`, `mass_msun`,
  `speed_kmh`). The schema converts to SI on load. A unit mismatch cannot hide in a bare number.
- **An id is separate from a name.** Ids are short slugs, immutable once created (`altaris`,
  `hollin`, `persis`). Names are display data and can change freely. "Persis" and "Hollin" are
  placeholder names, so this matters right away: a rename touches one file.
- **Generated entities get deterministic ids** (`g.c12_-3_4.17` for generated star 17 in cell
  (12, −3, 4)). An entity gets a file only once it is authored, locked or referenced.
- **`world.json` carries `format: N`.** The loader refuses formats it does not understand, as
  devlog does. Each format bump ships with a migration script.
- **Large source catalogues are app assets, not world data.** The 5.4 MB HYG star catalogue is
  one example. The world stores only overrides and references to it, by HYG/HIP id.

---

## 4. The shared library (`@malevo/core`)

Built first and tested hardest. Every number on screen should trace back to one of these.

| Module | Contents | Replaces |
|---|---|---|
| `units` | SI internally; AU, ly, c, g, M☉, R⊕ and so on as named constants; formatting with units | Constants redefined in every tool, in both metres and km |
| `rng` | mulberry32, FNV hash, keyed streams, distributions (normal, Poisson, weighted pick) | Three PRNG families |
| `vec` | 3-vectors, matrices, quaternions; frame transforms (galactic ↔ equatorial ↔ ecliptic ↔ planet body-fixed) | The J2000→galactic matrix copied in three files |
| `time` | Reference time scale, durations, proper time (section 5) | Ad-hoc `8766 h/yr` and `365.25 d` |
| `calendar` | Calendar definitions and conversions (section 5) | — |
| `orbit` | Kepler solver, orbital elements ↔ state, n-body positions at a date, synodic periods, habitable zone, insolation, tides, day length | The circular-orbit sun in torchlight |
| `foam` | Collapse threshold (`r = 2.7 AU·∛M`), tidal load tensor and its norms (from lee-planner), drop-point search, leg limit, top speed with artificial-gravity tilt, gas drain | lee-planner, travel-times, star-gen parameters |
| `torch` | Rocket equation, 1 g flip-and-brake crawl, relativistic proper time, torch power and brightness | Four separate crawl implementations |
| `sky` | Apparent position and magnitude of stars, planets, moons and torches from any surface point; extinction and airmass; twilight | Torchlight's built-in model |
| `kinematics` | Trapezoidal speed profiles, timetables, vehicles at time t (from `city-gen.js`) | Two copies of `moveDist` |
| `flow` | Traffic circulations, edge flows, Little's-law counts (section 6) | — |

**Shared setting constants live in `world/settings/physics.json`,** not in code:

- foam speed (6,500 c), threshold (2.7 AU), leg limit (15 ly), g_max (1.9 g)
- torch exhaust speed, governor cutoff
- default stopover time

The library takes these as an argument, so every tool sees the same values and a canon change is
a one-line diff.

---

## 5. Time and calendars

The timeline has to handle Gregorian, a possible 360-day Galactic calendar, AE and S− year counts,
planet-local calendars and ship clocks.

### 5.1 One reference time scale

- **Internally, every instant is one number:** SI seconds since an epoch (J2000.0) on a single
  reference clock. For a fixed rest frame of the foam, the setting's own rule already supplies one:
  roughly the local gas, ultimately something like the cosmic background.
- In practice, read it as Sol-barycentric time. Seconds since J2000 stay exact integers in a double
  for ±285 million years.
- **Calendars are only ways of reading that number.** Converting between them is exact, so an
  event entered in one calendar shows correctly in every other.

### 5.2 Calendar kinds (data, not code)

Calendars are defined in `calendars/*.json` using a few built-in kinds:

| Kind | Example | Notes |
|---|---|---|
| `gregorian` | Earth civil calendar | Proleptic Gregorian with leap years. No leap seconds: future ones can't be known, and nobody in-world would keep them. The slow drift of Earth's rotation is ignored unless a story needs it. |
| `fixed` | **Galactic Standard** | Year/month/day/hour units of exact SI lengths, so 360 × 30 days × 24 h × 3,600 s. No intercalation. Its epoch is a parameter. |
| `solar` | Altaris local | Derived from a body's real solar day and tropical year (from `orbit`), with a leap rule computed to track the seasons. "Local hours" are 1/24 of a local day, as the author proposed. Week length is configurable. |
| `era` | AE, S−, "+ years from 2026" | A year count laid over another calendar, with an epoch event (the Accord Charter for AE). |
| `clock` | Ship time, a station's clock | An offset and rate against reference time. Torch ships at 25% c run about 3% slow (γ ≈ 1.033), and the `torch` module accumulates that. |

**A side effect of the Galactic calendar:** it is 5.24 days shorter than the tropical year, so its
months slip through Earth's seasons in a full cycle about every **70 years**. On every other
planet it is out of step with the local year by an amount the app can show per world. That
is the "nobody's calendar matches their planet" effect, computed exactly.

**Cultures choose calendars.** Which calendar a culture uses, and when it switched, is a timeline
event. The insular culture can keep its own `solar` or `fixed` calendar, and any date can be
displayed "as they would write it".

### 5.3 How events store dates

```json
{ "id": "charter", "name": "Accord Charter ratified",
  "when": { "cal": "gregorian", "date": "2776", "precision": "year", "circa": true },
  "canon": "proposed", "tags": ["politics"], "refs": ["accord"] }
```

- **Precision and uncertainty are first-class:** year / month / day / minute, `circa`, and
  ranges (`"AE 130–200"`). Much of the timeline is still fuzzy, and the editor must not force
  false precision.
- **Dates can be anchored to other events:**
  `{"after": "charter", "offset": "130 y", "cal": "galactic"}`. The timeline is still moving, so
  shifting the Charter should shift everything anchored to it. That is exactly the
  "rebuild-the-galaxy" problem avoided at the timeline level. Anchors resolve in dependency order,
  and cycles are reported as errors.
- **Canon status on every event:** `canon` / `proposed` / `generated` / `rejected`. This mirrors
  the red/yellow/green provenance in `tools/origins`.

---

## 6. Routes and traffic: balance by construction

### 6.1 Network

- **Nodes** are systems and stations. Positions come from the star atlas.
- **Legs** connect two nodes, are at most the leg limit long, and stay clear of nebulae.
- **Lanes** are named chains of legs. The galactic route planner is the existing star-map A*,
  moved into `@malevo/core`.
- A lane's direction as seen from any node comes from the two star positions. This is how the sky
  view knows which way to look for incoming torches.

### 6.2 Flows are made of circuits

- **Traffic is not entered as per-edge numbers.** Those can be unbalanced, and nothing would
  catch it. Instead, traffic is a set of **services**: closed circuits with a frequency, for
  example `persis → altaris → persis, 12 ships / galactic day`, or a three-stop loop.
- **Edge flows are the sum of the services that use each edge.** Any sum of closed circuits is
  automatically balanced: at every node, average ships in equal average ships out. That is the
  balance the author wants, guaranteed by the data structure rather than by checking afterwards.
- Excluded on purpose, as the author specified: maiden voyages and trips to the scrapyard.
  Optional one-off flows (a colonization wave, an evacuation) can still be entered as explicit
  open flows. The checks panel reports every node's imbalance, so they never pass silently.
- **Seasonality:** a service can carry a yearly profile, such as lee-season surges or
  Approach's "expected load at that time of year". The yearly average must still balance; the
  instantaneous flow can swing.

### 6.3 Derived numbers (Little's law)

From one flow number λ (ships per day on an edge) and the shared physics:

- **Ships in transit on a leg:** λ × trip time.
- **Torches visible in a system's sky:** λ × crawl time, split into inbound and outbound and
  placed along each lane's direction. Torchlight will draw from this.
- **Port load:** Σ inbound λ, checked against capacity. The stack model for Bluff gives about
  77–80 freighters a day.
- **Fleet size:** Σ over services of frequency × circuit time, including stopovers.

### 6.4 Where demand comes from

- **Early on, services are authored by hand.** The Persis–Altaris lane and the others the
  stories need come first.
- **Later, a gravity-model generator proposes services.** Trade between two places scales with
  their populations and economies, multiplied by the two cultures' affinity, divided by a cost
  that grows with travel time. Each proposal is turned into circuits.
- The insular culture's low affinity yields few services, a property of the inputs rather than
  something hand-coded. Generated services are Derived until locked.

---

## 7. The tools

Each tool is a set of editors and views over the shared model. "Supersedes" names the story-thing
tool it replaces; those tools stay where they are until their replacement is good enough.

### 7.1 Timeline editor

- Events on a zoomable timeline across centuries, with calendar switching and filters (canon
  status, tags, polity, culture, system).
- Anchored dates, ranges, uncertainty bands.
- **A global "current date" that every other tool follows.** Picking a date shows the galaxy, a
  planet's sky or a city as they are then.
- Story entities (title, date range, locations) live on the timeline too. The app can then answer
  "what was true during *The Human Experience*?"
- **Import:** `world/timeline.md` (events tagged `proposed`).

### 7.2 Culture editor

- **Cultures and polities are separate kinds,** since canon says cultures span governments.
  Polities include FSN, Stellarium, the Xenophobe State, the Port Authority and the Accord.
  Cultures include the Collective, the Neo-Amish, the Proprietors and so on.
- **Each culture has parameters:** openness/insularity, trade propensity, expansion drive,
  tolerance of synthetic personhood, calendar used, naming palette (from `settle.js`), and tech
  adoption lag.
- **Affinity between two cultures** is derived from how far apart their parameters are, plus
  explicit pairwise overrides, plus timeline events that change relations (wars, treaties). It is
  shown as a matrix and as a graph.
- **Systems carry polity control and culture mix over time.** These are timeline-indexed, so
  "who held this system in AE 250" has one answer.

### 7.3 History generator

- A port of `settle.js` (decade steps, slow-ship era, foam era, polity borders, culture blending)
  onto the shared core, with three changes:
  - **Gated by the timeline.** Capabilities come from tech events ("foam drive available",
    "Slot Standard"), so nothing uses foam before the foam event.
  - **Constrained by canon.** Authored facts are fixed points the simulation must honor: Altaris
    founded AE 130, Persis about 4.5 ly away, the polity shares. If it cannot honor one, it reports
    the conflict instead of quietly breaking it.
  - **Proposes and does not overwrite.** A run produces a diff of proposed systems, lanes,
    services and events. The author accepts pieces, and accepted pieces become Locked.
- Information propagation: news moves at foam speed via couriers. The generator can answer "when
  did system X learn of event Y", which matters for history with no real-time comms.
- **Supersedes:** star-map's "Simulate settlement".

### 7.4 Solar system planner

- **Star:** taken from the atlas (a real HYG star or a generated one), with overrides.
- **Bodies:** planets, moons and belts, with Keplerian elements, mass, radius, rotation and
  axial tilt.
- **Derived values:** habitable zone, insolation, day length, seasons, tides, collapse radius
  per body, synodic periods and alignment seasons.
- **Orbit view at the current date.**
- Unauthored systems are generated lazily from their star's key and become files only once locked.
- **Checks the model will run, for example:**
  - Hollin at 2.6 AU around a 1 M☉ star has a 4.19-year period. Its synodic period with Altaris
    is then 1.31 years, and Altaris gains 113° on it each lap. The ~4-year period in
    `technology.md` and the 1.3-year lap in the navigation notes therefore agree.
  - "10 hours of daylight in midwinter at 28°N" has no solution with a 23.4° tilt. The app
    shows that directly.
- **Supersedes:** the missing system editor noted in the star-map README.

### 7.5 Route planner

Route planning happens at two scales on the same network.

- **Galactic scale**
  - Lanes, legs, services and flows.
  - Trip times with stopovers.
  - The balance report from section 6.2.
- **Approach scale (the lee-planner, generalized)**
  - For any arrival system at any date: the collapse surface from all its bodies, the drop
    points, the crawl times, lee seasons and their timings, chart margins against a navigator's
    margins, and what happens when an arrival misses.
  - Altaris, Hollin and Persis are its first case, and it must reproduce the lee-planner's tables
    in `ftl-navigation-notes.md`.
- **Supersedes:** lee-planner, travel-times and the star-map routing panel.

### 7.6 Planet terrain generator

- Seeded noise on the sphere, evaluated in 3D on the unit sphere so resolution never changes the
  result.
- **Parameters:** plate count, sea level, roughness, ice and so on. Climate and biome colours are
  derived from insolation and tilt (from `orbit`).
- **Roll, then lock:** re-roll seeds until a look is right, then lock the seed, parameters and
  generator version.
- **Hand shaping is stored as text,** never as pixels: control points, continent outline polygons
  and height or feature strokes, all in lat/lon. Example: "a Florida-like limestone peninsula with
  a west-coast bluff at 28°N".
- Rasters such as textures and height maps are derived and cached. They can be exported for
  covers or reference without being committed.

### 7.7 Planet population planner

- Cities placed at canonical lat/lon positions, each with founding date, population keyframes
  over time, port role and polity/region.
- **"Conditions at a time" for any place:**
  - local solar time and local calendar date
  - season, daylight hours and twilight
  - tide phase
  - the sky: Sun, moon, planets, real star positions from *this* system, and lane torches from
    section 6.3
  - which ships are in port
- **The sky view is torchlight, generalized to any planet, latitude and date.** It is a shared
  `@malevo/viz` component, so a city view and the population planner show the same sky.
- **Supersedes:** torchlight and classic torchlight.

### 7.8 City planner

- The `bluff-city` format (FORMAT.md) moves over as format v2:
  - anchored to a planet and lat/lon, so sun direction, latitude and gravity come from the model
  - transit services use `@malevo/core` kinematics
  - speeds come from one place, which settles the tram and field-line conflicts
- **Travel-time estimation** across walking, transit (with headways and dwell) and lighters.
  Routes are computed on the city's network at a given time of day.
- The 3D preview, and the port and stack capacity model, reuse the shared flow numbers.
- **Supersedes:** bluff-planner, bluff-map and stack.

### 7.9 Checks (cross-cutting)

One panel, and also `malevo check` in CI on the data repo. It runs every validator:

- schema errors and dangling references
- legs longer than the leg limit, legs through nebulae
- flow imbalance, port loads over capacity
- events that happen before their enabling tech, anchor cycles
- cities in the ocean
- stale locked values

Each finding links to the entity concerned.

### 7.10 Reports back into story-thing

`malevo report` writes generated Markdown fact sheets, for example
`world/generated/altaris.md` (day length, year, moon, lanes, traffic, sky facts). They carry a
"generated, do not edit" header and are regenerated on demand. Prose work and Claude sessions in
story-thing then read the same numbers as the app.

---

## 8. Shell, build and release

Copied from devlog, with three gaps fixed.

- **Stack**
  - Electron, electron-vite, React, TypeScript strict, vitest
  - electron-builder, electron-updater on the GitHub Releases provider
  - three.js, pinned and bundled; not loaded from a CDN
- **Unchanged from devlog**
  - Typed preload API grouped by domain, with `domain:verb` channels and `ev:` events.
    `contextIsolation`, `sandbox` and a CSP.
  - A silent update policy: download in the background, then install when idle, locked or
    hidden, never during an unsaved edit, with an "Update now" button in the status bar. The pure
    `shouldInstallNow` function and its tests port as-is.
  - CI: typecheck, test, build and a Playwright `_electron` smoke test on every push. Windows and
    macOS packaging. A release job publishes `latest*.yml` on a `v*` tag or a manual dispatch.
- **Fixed relative to devlog**
  1. **npm workspaces.** devlog repeats its path aliases in four config files.
  2. **A linter** (ESLint with a `no-restricted-properties` rule banning `Math.random` in
     `core`, `model` and `gen`), plus Prettier.
  3. **macOS signing and notarization.** devlog ships unsigned, and Squirrel.Mac will not apply
     updates to an unsigned app, so macOS auto-update probably does not work there. Plan for a
     Developer ID certificate and notarization secrets ([D6](#d6-code-signing)). Until then, macOS
     users update by hand.
- **Golden-fixture job** (section 3.3) runs in the same CI.

**Repo layout:**

```
apps/desktop/          src/main, src/preload, src/renderer (tool host), electron-builder.yml
packages/core/         pure library (section 4)
packages/model/        schemas, canonical serializer, loader/saver, queries, validators
packages/gen/          versioned generators + golden fixtures
packages/viz/          shared React/three.js components
packages/cli/          `malevo` command
tools/<tool>/          each tool's UI module (registered with the host)
assets/catalog/        HYG catalogue (moved from story-thing/tools/star-map/data)
docs/                  this plan, design notes, format spec
```

---

## 9. Phases: the order of the bites

Each phase ends with something usable, and later phases only add to earlier ones. Phases 0–2 are
the foundation, and doing them right is what makes guarantee G1 possible. Everything after that
can be reordered to suit what the stories need next.

### Phase 0: Skeleton (shell, release, empty world)

- The repo layout above, workspaces, lint, typecheck, vitest, CI.
- An Electron shell that opens a world folder, shows git status, and hosts an empty tool registry.
- Auto-update end to end. Shipping `v0.1.0` and updating to `v0.1.1` is the exit test.
- `world.json` with a format version and world seed; refuse unknown formats.

**Exit:** an installable app that updates itself and opens an empty world.

### Phase 1: Core library and the stability contract

- `units`, `rng`, `vec`, `time`, `calendar` (all five kinds), `orbit`, `foam`, `torch`,
  `kinematics` and `flow`, with unit tests checked against known values. Lee-planner's tables and
  Earth ephemeris spot checks are among them.
- `@malevo/model`: zod schemas, the canonical serializer (key order, precision, formatting),
  loader and saver, reference resolution, the dependency and staleness graph, and the validator
  framework.
- The generator framework: `name@version` registry, keyed streams, golden-fixture tooling.
- `malevo check` and `malevo check --fix`.
- `world/settings/physics.json` holding the shared foam and torch constants.

**Exit:** a world folder can be validated in CI. Changing a frozen generator fails the build.

### Phase 2: Timeline editor and calendars (first real tool)

- The event schema, with anchors, precision and canon status.
- The timeline UI and the global "current date".
- Calendar definitions for Gregorian, Galactic (draft), AE/S−/+ eras and Altaris local (once the
  Altaris body exists, Phase 3).
- Import `world/timeline.md`.

**Why first:** the dependencies are simple, it settles the editing and saving UI patterns every
other tool reuses, and every later tool needs "current date".

### Phase 3: Star atlas and solar system planner

- Port `star-gen.js` (generated faint stars, per-cell seeding) and the HYG catalogue as `gen` and
  assets.
- Import `atlas.json`. The imported generated stars must keep their ids and positions, and the
  golden test proves it.
- The system and body editor, orbit view and derived physics.
- **First authored systems:** Altaris (with its moon), Hollin, Persis and Sol. Each should be tied
  to a real or generated atlas star, which also fixes the direction of Persis in Altaris's sky.

### Phase 4: Cultures and polities

- Culture and polity editors, the affinity model, and control and culture mix over time.
- Import the cultures, governments and settlement shares from story-thing.

### Phase 5: Galactic routes and traffic

- Legs, lanes, services, the flow balance report and Little's-law numbers.
- Author the Persis–Altaris lane and the other lanes into Altaris. Bluff's port load must come out
  against the stack's capacity.

### Phase 6: Sky view and approach planner

- The `sky` module, with the torchlight atmosphere and brightness physics moved into `@malevo/viz`.
  It draws real stars from the atlas, bodies from the system and torches from the flows.
- Approach-scale lee planning, reproducing the lee-planner's results through the shared `foam`
  module.

**Exit:** the guarantee G2 test from section 1. The night sky over Bluff shows exactly the lanes
and torch counts the route planner says.

### Phase 7: History generator

- Port `settle.js` onto the shared core. Add tech gating, canon constraints, propose/accept diffs
  and information propagation.
- This comes after phases 2–5 because it needs all of their entity types as inputs and outputs.

### Phase 8: Planet terrain

- The spherical noise generator, roll and lock, vector hand shaping, climate colouring and
  cached rasters.
- **First planet:** Altaris, including the limestone peninsula and the bluff.

### Phase 9: Population planner

- Cities on planets with population over time, the "conditions at a time" panel, and the sky view
  embedded.

### Phase 10: City planner

- Port the `bluff-city` format to v2 and import `bluff.city.json`.
- Timetables and travel-time routing on the shared kinematics, the 3D preview, and the stack
  capacity model.

### Phase 11 onward

- `malevo report` fact sheets (can come earlier if useful).
- Gravity-model service generation, scene briefs ("conditions for this scene"), cover and
  reference exports, and retiring the old story-thing tools.

---

## 10. What the existing data will need

When it is imported, each inconsistency below goes to the author to decide, as a check finding
with each source cited, rather than being settled silently:

| Item | Conflict |
|---|---|
| Collapse threshold | 2.58 AU (torchlight *Sandpiper* drop), 2.70 AU (lee-planner and others), 2.85 AU (`technology.md`, redesign prompt) |
| Terrace tram speed | 15 km/h (maps) vs 12 m/s ≈ 43 km/h (city file) |
| Field line speed | 60 km/h (measure tools) vs 25 m/s = 90 km/h (city file, torchlight) |
| Parking-orbit tilt | 29° (torchlight README) vs 28° = latitude (stack) |
| Ship time vs Bluff local | +10 h 35 m (timeline) vs +13 h 27 m (navigation notes) |
| Settlement shares | "about a quarter" / "about a tenth" (README) vs 0.27 / 0.12 (`settle.js`) |
| Altaris day length | 24 h (torchlight default) vs ~28.6 h (author-words); a "10 h daylight" figure that can't fit 28°N |
| Story year | ~+900 (`overview.md`) vs +1,200 (`timeline.md`) |
| Funicular | 175 m built into torchlight vs ~177 m in the city file |

---

## Open decisions

Each has a recommendation, and the plan proceeds on it unless the author says otherwise.

### D1. Where the world data lives

- Options: a `data/` folder inside story-thing, a separate world-data repo, or inside this app repo.
- **Recommendation:** `story-thing/data/`. Canon prose and canon numbers then change in the same
  commit, and the `malevo report` fact sheets sit next to the prose that uses them. The app opens
  any folder, so this can change later at no cost.

### D2. File format

- Options: JSON vs YAML/TOML.
- **Recommendation:** JSON with a canonical formatter, plus Markdown sidebars for prose. JSON is
  the format the existing tools already use, it is unambiguous, and the formatter keeps diffs small.
  YAML's comments are its main advantage, and the sidebars cover most of that.

### D3. The Galactic calendar

- Whether it is canon, its epoch, and its adoption date (which can differ per polity).
- **Recommendation:** build it now as a `fixed` calendar marked `proposed`. Its epoch and adoption
  are timeline events, so either can move without touching anything else.

### D4. The reference clock and relativity

- **Recommendation:** use one Sol-barycentric reference time, with proper time tracked for torch
  legs (about 3% at 25% c).
- Open question for the author: does a foam pocket's clock run at reference rate? The canon
  "pocket of normal spacetime" suggests yes, and that is the default.

### D5. The unit for traffic flow

- **Recommendation:** ships per Galactic day, which is exactly 86,400 s, so it equals ships per
  Earth day. Display can also show ships per year.

### D6. Code signing

- macOS: an Apple Developer ID, notarization, and secrets for CI. Windows: a certificate, or
  accept SmartScreen warnings.
- **Recommendation:** ship unsigned at first, as devlog does, but plan for macOS signing before
  relying on macOS auto-update.

### D7. Git integration level

- Options: show status and commit on request, or devlog-style automatic commit and push.
- **Recommendation:** show status and commit on request. Canon edits should be deliberate. Auto-
  sync can be an option later.

### D8. Platforms

- **Recommendation:** macOS and Windows in CI, as devlog does. Linux AppImage if wanted.
