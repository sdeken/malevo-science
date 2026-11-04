# Malevo Science: Plan

Malevo Science is a desktop app for building, checking and visualizing the physical and
historical setting of a hard science fiction series. It models stars, planets, routes, traffic,
calendars, cultures, history and cities, so the details stay consistent from story to story.

This document covers:

- what the app must guarantee,
- the architecture that delivers those guarantees,
- the order the work happens in.

It is a living plan. Decisions that are still open are collected in
[Open decisions](#open-decisions). Each one has a recommendation, and nothing in the plan is
blocked on them.

---

## 1. Principles

### P0. The app is a workbench; canon is whatever the author commits

- **The app contains no setting.** No star, planet, culture, date, name or story-specific number
  is written into the app's code, defaults or tests. A gas giant called "Hollin" is just a body
  someone created in some world folder. Nothing in the app knows it exists.
- **Everything is movable.** Stars, systems, bodies, routes, cultures and events can be created,
  dragged, re-rolled and deleted freely while the author explores. Nothing is canon until the
  author decides it is.
- **Canon is a set of files.** The app writes world folders. The author decides which world
  folder, and which commit of it, is canon. That data lives in its own repository, separate from
  this app repo and deliberately kept out of the app's development. The app works the same on a
  scratch world, a variant, or the canon world.
- **Prose and notes elsewhere are reference only.** Story documents and the existing prototype
  tools informed this plan, but the app never imports them as truth. Algorithms from the prototype
  tools are ported as code. Their data (star atlas, city file) can be loaded into a scratch world
  as a starting sketch, nothing more.
- **Tests use synthetic fixture worlds,** made up for the purpose. They test the physics and the
  formats, not any particular setting.

### P1. The world is text in git, and it does not shift under you

All world data is plain text files, written for clean diffs and committed to git. Most of the world
is procedural, so the main risk is a *cascade*: a change to one generator or one input ripples
outward and quietly changes things the author has already settled. Section 3, the stability
contract, is the defense against this. It is the first thing built and the last thing compromised.

### P2. One model, many views

Every tool reads one shared world model through one shared library of functions. No tool keeps
its own copy of a constant, an orbit or a route. The test of this:

> If the route network says three routes touch a planet, the night-sky view from any city on
> that planet shows exactly those three routes. The number of torches visible along each route
> equals the ship flow on that route multiplied by the time a ship spends crawling in-system.
> The port's load is checked against the sum of those same flows.

The existing prototype tools break this today. A survey of them found:

- **Two different random-number generators.**
- **Constants in two unit systems.** AU and g are defined in metres in some tools and in
  kilometres in another.
- **The 1 g flip-and-brake crawl implemented separately four times.**
- **The same quantity with different values in different tools:** transit speeds, collapse
  threshold, parking-orbit tilt.
- **Two unrelated skies.** Neither is computed from where the planet actually is.

The app replaces these copies with one library (section 4).

---

## 2. Shape of the system

```
┌───────────────────────── Electron shell (apps/desktop) ─────────────────────────┐
│  main: window, menus, file access, git status, auto-update, worker pool         │
│  preload: typed, namespaced IPC bridge (devlog pattern)                         │
│  renderer: tool host — one tab/pane per tool, shared selection & "current time" │
│     ├─ Timeline  ├─ Cultures  ├─ History  ├─ Systems  ├─ Routes                 │
│     └─ Terrain   ├─ Population ├─ Cities  ├─ Sky       ├─ Checks                │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ all tools call the same packages
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│ @malevo/viz    shared renderers: star map, orbit view, globe, sky, city 3D      │
│ @malevo/gen    versioned, seeded generators (stars, systems, terrain, history…) │
│ @malevo/model  schemas, world loader/saver, references, queries, validators     │
│ @malevo/core   units, constants, RNG, vectors, time & calendars, orbits, foam,  │
│                torch, frames, ephemeris, kinematics, flows — pure TS, no I/O    │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ read / write canonical text
                         ┌─────────▼─────────┐        ┌──────────────────────────┐
                         │ world folder (git)│◄───────┤ malevo CLI: check / gen / │
                         │ any repo, any path│        │ query / report            │
                         └───────────────────┘        └──────────────────────────┘
```

**Design rules:**

- **`@malevo/core` and `@malevo/model` do not depend on Electron or the DOM.** The command-line
  tool, the tests and CI on a world repo all run them under plain Node.
- **Only `@malevo/model` writes world files.** The renderer never touches the file system; it
  goes through IPC, as in devlog.
- **A world is a folder.** The app opens any world folder, usually a git working copy, the way
  devlog opens a repo. It shows git status and can commit on request, but it does not commit or
  push automatically ([D7](#d7-git-integration-level)).
- **Experimenting is cheap** (section 3.6). A world can be forked into a scratch copy, played with,
  compared against the original, and merged back piece by piece or thrown away.
- **Heavy work runs in worker threads:** generation, history simulation, terrain rasters and route
  searches. Results are cached on disk under userData, keyed by the hash of their inputs, and never
  stored in the world folder.
- **Tools are internal modules behind a small registry interface:** id, title, views, commands,
  and the entity kinds they edit. This is simpler than devlog's sandboxed extension host, which is
  built for third-party code that we don't have. Any tool can be pulled out into an extension
  later if needed.

---

## 3. The stability contract (principle P1 in detail)

### 3.1 Three tiers of data

| Tier | What it is | Stored? | Can a generator change it? |
|---|---|---|---|
| **Authored** | Values the author typed in or dragged into place | Yes, as values | Never |
| **Locked** | Generated, then accepted ("roll, then lock") | Yes: values, plus the seed and generator version that made them | Never; only an explicit re-roll |
| **Derived** | Computed on demand from the two tiers above (positions at a date, sky, traffic totals, terrain rasters) | No; it lives only in the cache | Yes, freely |

While exploring, the author can leave nearly everything Derived and re-roll at will. Locking is
how the author says "I'm keeping this". Whatever is locked survives any later change to a
generator, because its values are stored.

### 3.2 Keyed randomness

- **Every random stream comes from a stable key, not from a position in a sequence:**
  `stream = rng(hash(worldSeed, generatorId, entityId, purpose))`. Adding, removing or reordering
  one entity therefore cannot change the random numbers any other entity gets.
- **The algorithms are fixed:** mulberry32 for streams and an FNV-1a-style hash for keys. The
  prototype generators already use both, so an old atlas or city file loaded as a starting sketch
  reproduces exactly. `Math.random` is banned in model and generator code by a lint rule.
- **Iteration always follows a stable sort by id,** never insertion order or object-key order.
- **Spatial generation is per cell.** Widening the generated region adds cells and does not
  reshuffle the existing ones.

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
- **Before a change is applied, the app can show what it would affect.** Moving a star shows
  which routes would break the leg limit, which flows would change, and which locked values would
  go stale. That is what makes it safe to play.

### 3.5 File format

These rules carry over from devlog, adapted for structured data:

- **One entity per file,** in a folder per kind (`systems/<id>/system.json`, `events/<id>.json`).
  Small files make for small diffs and few merge conflicts.
- **Canonical serialization:**
  - Keys appear in the schema's order, not alphabetically, so files read logically.
  - Two-space indent, LF line endings, trailing newline.
  - Each numeric field has a declared precision, so values never churn at the 15th digit.
  - Short arrays of numbers stay on one line.
  - The app formats on every save, and `malevo check --fix` re-formats hand edits.
- **The format is JSON, checked against schemas (zod).** Prose lives in a Markdown sidebar file
  next to the entity rather than in JSON strings ([D2](#d2-file-format)).
- **Units are explicit in the key name** (`semiMajorAxis_au`, `period_d`, `mass_msun`,
  `speed_kmh`). The schema converts to SI on load. A unit mismatch cannot hide in a bare number.
- **An id is separate from a name.** Ids are short and immutable once created. Names are display
  data and can change freely. Placeholder names are normal while exploring, so a rename touches one
  file and breaks no references.
- **Generated entities get deterministic ids** (`g.c12_-3_4.17` for generated star 17 in cell
  (12, −3, 4)). An entity gets a file only once it is authored, locked or referenced.
- **`world.json` carries `format: N`.** The loader refuses formats it does not understand, as
  devlog does. Each format bump ships with a migration script.
- **Large source catalogues are app assets, not world data.** The real-star catalogue (HYG, about
  5 MB) is one example. A world stores only its choices and overrides, referencing catalogue stars
  by id.

### 3.6 Experimenting: forks and comparisons

- **Fork world:** copies a world folder, or makes a git branch or worktree when it is a repo, for
  a what-if. Examples: move a system, change the threshold constant, try a different settlement
  history.
- **Compare worlds:** a semantic diff between two worlds or two commits. It lists entities added,
  removed and changed, with field-level differences, plus the *derived* consequences (flows,
  travel times, sky). The question it answers: "what does this change actually do?"
- **Take pieces back:** copy selected entities from a fork into the main world.
- **Optional status tags** on any entity (`idea`, `draft`, `settled`, or whatever the author
  likes) can be used for filtering. The app attaches no meaning to them.

---

## 4. The shared library (`@malevo/core`)

Built first and tested hardest. Every number on screen should trace back to one of these.

| Module | Contents |
|---|---|
| `units` | SI internally; AU, ly, c, g, M☉, R⊕ and so on as named constants; formatting with units |
| `rng` | mulberry32, FNV hash, keyed streams, distributions (normal, Poisson, weighted pick) |
| `vec` | 3-vectors, matrices, quaternions; frame transforms (galactic ↔ equatorial ↔ ecliptic ↔ planet body-fixed) |
| `time` | Reference time scale, durations, proper time (section 5) |
| `calendar` | Calendar definitions and conversions (section 5) |
| `orbit` | Kepler solver, orbital elements ↔ state, positions at a date, synodic periods and alignment windows, habitable zone, insolation, tides, day length |
| `foam` | Collapse threshold as a function of mass, tidal load tensor and its norms, drop-point search, leg limit, top speed with artificial-gravity tilt, gas drain |
| `torch` | Rocket equation, 1 g flip-and-brake crawl, relativistic proper time, torch power and brightness |
| `sky` | Apparent position and magnitude of stars, planets, moons and torches from any surface point; extinction and airmass; twilight |
| `kinematics` | Trapezoidal speed profiles, timetables, vehicles at time t |
| `flow` | Directed flow network, node balance, balancing solver, Little's-law counts (section 6) |

**The setting's physical rules are world data, not code.** Each world's
`settings/physics.json` holds them:

- foam top speed, collapse threshold constant, leg limit, artificial-gravity limit
- torch exhaust speed, governor cutoff
- default stopover time

The library takes these as an argument. A new world starts from a template that the author can
change at any time. The app has no idea which values are canon; it just shows what follows from
the values in the open world.

---

## 5. Time and calendars

The timeline must support several date systems side by side: Earth's Gregorian calendar, a
possible 360-day Galactic calendar, era year-counts, planet-local calendars, a separate calendar
for an insular culture, and ship clocks.

### 5.1 One reference time scale

- **Internally, every instant is one number:** SI seconds since an epoch on a single reference
  clock. In practice, read it as Sol-barycentric time. Seconds since J2000 stay exact integers in a
  double for ±285 million years.
- **Calendars are only ways of reading that number.** Converting between them is exact, so an
  event entered in one calendar shows correctly in every other.

### 5.2 Calendar kinds (data, not code)

Each world defines its calendars in `calendars/*.json` using a few built-in kinds:

| Kind | Example | Notes |
|---|---|---|
| `gregorian` | Earth civil calendar | Proleptic Gregorian with leap years. No leap seconds: future ones can't be known. The slow drift of Earth's rotation is ignored unless a story needs it. |
| `fixed` | A 360 × 30 × 24 "Galactic" calendar | Year/month/day/hour units of exact SI lengths. No intercalation. Its epoch is a parameter. |
| `solar` | A planet's local calendar | Derived from the body's real solar day and year (from `orbit`), with a leap rule computed to track the seasons. Local hours are a configurable fraction of the local day. Week length is configurable. It changes automatically if the body's orbit or rotation is edited. |
| `era` | Year counts from some event | A year count laid over another calendar, with an epoch event. |
| `clock` | Ship time, a station's clock | An offset and rate against reference time. Torch ships at relativistic speeds run slow, and the `torch` module accumulates that. |

**A side effect a fixed 360-day calendar would have:** it is 5.24 days shorter than Earth's
tropical year, so its months slip through Earth's seasons in a full cycle about every 70 years. On
every other planet it drifts against the local year by an amount the app shows per world.

**Cultures choose calendars.** Which calendar a culture uses, and when it switched, is a timeline
event. Any date can be displayed "as that culture would write it".

### 5.3 How events store dates

```json
{ "id": "e7k2", "name": "Charter ratified",
  "when": { "after": "e3m9", "offset": "130 y", "cal": "gal" },
  "tags": ["politics"], "refs": ["p4q1"] }
```

- **Precision and uncertainty are first-class:** year / month / day / minute, `circa`, and
  ranges. Early on most dates are fuzzy, and the editor must not force false precision.
- **Dates can be anchored to other events,** as an offset in any calendar. Moving one event moves
  everything anchored to it, which avoids the cascade problem at the timeline level. Anchors
  resolve in dependency order, and cycles are reported as errors.
- **Technology events gate the simulation.** "Foam drive available" is an event, and the history
  generator and route tools ask the timeline what is possible at a given date.

---

## 6. Routes and traffic

### 6.1 Network

- **Nodes** are systems and stations. Positions come from the star atlas.
- **Legs** connect two nodes, are at most the leg limit long, and stay clear of nebulae.
- **Routes** are named chains of legs, either drawn by hand or found by the galactic route
  planner (A* under the leg limit).
- **A route's direction as seen from any node** comes from the two star positions. The sky view
  uses this to know where to draw incoming torches.

### 6.2 Flows are directed and need not be symmetric

- **Traffic is entered as directed flows: ships per unit time in one direction along a route.**
  A → B and B → A are independent numbers. A route can carry 27 ships a day one way, 7 the other
  way, or none.
- **Flows can be entered at two levels; both resolve to the same per-edge numbers:**
  - **Edge flows:** a number on one directed leg or route.
  - **Itineraries:** a one-way path through several nodes with a frequency, for example
    A → R → B at 17 a day. R is a rest stop: those ships arrive from A and leave for B.
    Itineraries make through traffic explicit. They let the app say how many ships at a node are
    passing through and how many are terminating, and they let it count fleet size.
- **Balance is a rule the app checks, not something the data structure forces.** At every node,
  average arrivals should equal average departures, summed over all routes and directions.
  Maiden voyages and trips to the scrapyard are left out. In the rest-stop example R balances by
  itself (17 in, 17 out). A then has 17 more departures than arrivals and B 17 more arrivals than
  departures. The checks panel reports this until other flows bring those ships back, for example
  B → C → A. The world's settings hold a balance tolerance.
- **The balance report** shows, for each node:
  - arrivals, departures and net imbalance
  - through traffic vs terminating traffic
  - each route's contribution in each direction

  It also shows a network view of where an imbalance is created and where it would have to be
  absorbed.
- **The balancing helper** proposes the smallest set of flow changes that would balance the
  network, either on routes the author picks or on the cheapest return routes. The author accepts
  or ignores each one; it is never applied automatically.
- **Seasonality:** a flow can carry a yearly profile, such as surges in alignment seasons. The
  balance rule applies to the yearly average. The instantaneous flow can swing.

### 6.3 Derived numbers (Little's law)

From the flow λ on each directed edge (ships per day) and the shared physics:

- **Ships in transit on a leg:** λ × trip time.
- **Torches visible in a system's sky:** λ_in × inbound crawl time plus λ_out × outbound crawl
  time, placed along each route's direction. Asymmetric flows show up in the sky as
  asymmetric torches.
- **Port load:** Σ arrivals that terminate there, checked against the capacity model.
- **Fleet size:** Σ over itineraries of frequency × itinerary time, including stopovers.

### 6.4 Where flows come from

- **At first, flows are entered by hand.**
- **Later, a demand generator proposes flows.** Trade between two places scales with their
  populations and economies, multiplied by the two cultures' affinity, divided by a cost that grows
  with travel time. The trade can be lopsided (exports vs imports). The generator then adds the
  return traffic the balance rule needs, along the cheapest routes, which may not be the same
  route.
- Low-affinity cultures get thin traffic because of their inputs, not because of a special case.
- Generated flows are Derived until locked.

---

## 7. The tools

Each tool is a set of editors and views over the shared model, and every one of them can create,
move and delete freely. The prototype tool each one ports algorithms from is noted, as a source
of code, not data.

### 7.1 Timeline editor

- Events on a zoomable timeline across centuries.
- Calendar switching and filters (tags, polity, culture, system).
- Anchored dates, ranges, uncertainty bands.
- **A global "current date" that every other tool follows.** Picking a date shows the galaxy, a
  planet's sky or a city as they are then.
- **Story entities** (title, date range, locations) live on the timeline too. The app can then
  answer "what was true during this story?"

### 7.2 Culture editor

- **Cultures and polities are separate kinds.** A culture can span several polities.
- **Each culture has parameters:** openness/insularity, trade propensity, expansion drive, the
  calendar it uses, a naming palette, and tech adoption lag. Other parameters can be added per
  world.
- **Affinity between two cultures** is derived from how far apart their parameters are, plus
  explicit pairwise overrides, plus timeline events that change relations (wars, treaties). It is
  shown as a matrix and as a graph.
- **Systems carry polity control and culture mix over time.** These are timeline-indexed.

### 7.3 History generator

Ported from the prototype `settle.js`: decade steps, a slow-ship era, a foam era, polity borders
and culture blending, all running on the shared core. It adds four things:

- **Gated by the timeline.** Capabilities come from technology events, so nothing uses foam before
  the foam event, and so on.
- **Respects what the author has fixed.** Authored and locked facts are fixed points: a system
  settled at a given date, a given polity's share. If the simulation cannot honor them, it
  reports the conflict instead of quietly breaking it.
- **Proposes and does not overwrite.** A run produces a diff of proposed systems, routes, flows
  and events. The author accepts pieces, and accepted pieces become Locked. Runs can also go into a
  fork to compare.
- **Information propagation.** News moves only as fast as ships. The generator can answer "when
  did system X learn of event Y".

### 7.4 Solar system planner

- **Star:** chosen from the atlas (a real catalogue star or a generated one), with overrides. A
  system can be moved to a different star at any time; the derived consequences show before
  committing.
- **Bodies:** planets, moons and belts, with orbital elements, mass, radius, rotation and axial
  tilt. Drag them to change orbits.
- **Derived values:** habitable zone, insolation, day length, seasons, tides, the collapse radius
  of each body, synodic periods and alignment seasons between any pair.
- **Orbit view at the current date.**
- Systems nobody has worked on are generated lazily from their star's key and become files only
  once locked.
- **Feasibility questions answered directly.** Example: "can a city at this latitude have only
  10 hours of daylight at midwinter with this tilt?" The app gives the answer and the range of
  tilts that would allow it.
- Ports algorithms from the prototype `star-gen.js` and the planned system editor.

### 7.5 Route planner

Route planning happens at two scales on the same network.

- **Galactic scale**
  - Routes, legs, itineraries and directed flows.
  - Trip times with stopovers.
  - The balance report and balancing helper from section 6.2.
- **Approach scale** (generalizing the prototype lee-planner)
  - For any arrival system at any date: the collapse surface from all its bodies, the drop
    points, the crawl times, and the windows when a giant planet shortens the approach.
  - Chart margins against a navigator's margins, and what happens when an arrival misses.
- **Regression tests** reproduce the prototype's numbers for the same inputs, set up in a
  synthetic fixture. This confirms the port is faithful; it says nothing about canon.
- Ports algorithms from the prototype lee-planner, travel-times and star-map routing.

### 7.6 Planet terrain generator

- Seeded noise on the sphere, evaluated in 3D on the unit sphere so resolution never changes the
  result.
- **Parameters:** plate count, sea level, roughness, ice and so on. Climate and biome colours are
  derived from insolation and tilt (from `orbit`), so moving the planet changes its look
  automatically unless the look is locked.
- **Roll, then lock:** re-roll seeds until a look is right, then lock the seed, parameters and
  generator version.
- **Hand shaping is stored as text,** never as pixels: control points, coastline polygons and
  height or feature strokes, all in latitude/longitude.
- Rasters such as textures and height maps are derived and cached. They can be exported for
  reference without being committed.

### 7.7 Planet population planner

- Cities placed at lat/lon on a planet, each with founding date, population over time, port role
  and polity/region.
- **"Conditions at a time" for any place:**
  - local solar time and local calendar date
  - season, daylight hours and twilight
  - tide phase
  - the sky: sun, moons, planets, real star positions as seen from *this* system, and route
    torches from section 6.3
  - which ships are in port
- **The sky view is a shared `@malevo/viz` component** for any planet, latitude and date. The city
  planner and the population planner show the same sky.
- Ports algorithms from the prototype torchlight.

### 7.8 City planner

- The prototype city format, moved over as format v2:
  - anchored to a planet and lat/lon, so sun direction, latitude and gravity come from the model
  - transit services use `@malevo/core` kinematics
  - each speed and size has one source, inside the city file
- **Travel-time estimation** across walking, transit (with headways and dwell) and surface-to-orbit
  craft. Routes are computed on the city's network at a given time of day.
- The 3D preview, and the port capacity model, reuse the shared flow numbers.
- Ports algorithms from the prototype bluff-planner, bluff-map and stack.

### 7.9 Checks (cross-cutting)

One panel, and also `malevo check` for CI on a world repo. It runs every validator:

- schema errors and dangling references
- legs longer than the leg limit, legs through nebulae
- node flow imbalance beyond tolerance, port loads over capacity
- events that happen before their enabling technology, anchor cycles
- cities in the ocean
- stale locked values

Each finding links to the entity concerned. Every finding is a warning the author can
acknowledge; none blocks saving, because a half-finished world is the normal state.

### 7.10 Reports

`malevo report` writes generated Markdown fact sheets for any entity: a planet's day, year and
moons; the routes and traffic at a system; sky facts for a city. They go to a folder the author
chooses, usually inside the world repo. They carry a "generated, do not edit" header and are
regenerated on demand, so notes and prose can quote the same numbers the app uses.

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
  2. **A linter** (ESLint, with a rule banning `Math.random` in `core`, `model` and `gen`), plus
     Prettier.
  3. **macOS signing and notarization.** devlog ships unsigned, and Squirrel.Mac will not apply
     updates to an unsigned app, so macOS auto-update probably does not work there. Plan for a
     Developer ID certificate and notarization secrets ([D6](#d6-code-signing)).
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
templates/new-world/   starting settings, calendars and physics for a new world (editable)
fixtures/              synthetic test worlds
assets/catalog/        real-star catalogue
docs/                  this plan, design notes, format spec
```

---

## 9. Phases: the order of the bites

Each phase ends with something usable, and later phases only add to earlier ones. Phases 0–2 are
the foundation, and doing them right is what makes principle P1 possible. Everything after that
can be reordered to suit what the author wants to explore next.

### Phase 0: Skeleton (shell, release, empty world)

- The repo layout above, workspaces, lint, typecheck, vitest, CI.
- An Electron shell that creates or opens a world folder, shows git status, and hosts an empty
  tool registry.
- Auto-update end to end. Shipping `v0.1.0` and updating to `v0.1.1` is the exit test.
- `world.json` with a format version and world seed; refuse unknown formats.

**Exit:** an installable app that updates itself and creates or opens an empty world.

### Phase 1: Core library and the stability contract

- `units`, `rng`, `vec`, `time`, `calendar` (all five kinds), `orbit`, `foam`, `torch`,
  `kinematics` and `flow`, with unit tests checked against textbook values: real solar-system
  ephemeris spot checks, rocket-equation cases, and port-fidelity cases from the prototypes.
- `@malevo/model`: zod schemas, the canonical serializer (key order, precision, formatting),
  loader and saver, reference resolution, the dependency and staleness graph, and the validator
  framework.
- The generator framework: `name@version` registry, keyed streams, golden-fixture tooling.
- `malevo check` and `malevo check --fix`.
- The new-world template, including `settings/physics.json`.

**Exit:** a world folder can be validated in CI. Changing a frozen generator fails the build.

### Phase 2: Timeline editor and calendars (first real tool)

- The event schema, with anchors, precision and tags.
- The timeline UI and the global "current date".
- The calendar editor for all five kinds; `solar` calendars become usable once bodies exist
  (Phase 3).
- Fork and compare worlds (section 3.6), first exercised on timelines.

**Why first:** the dependencies are simple, it settles the editing, saving and forking patterns
every other tool reuses, and every later tool needs "current date".

### Phase 3: Star atlas and solar system planner

- The real-star catalogue as an asset. Port the prototype star generator (generated faint stars,
  per-cell seeding).
- A galaxy view where systems can be placed on stars and moved between them.
- The system and body editor, orbit view and derived physics.
- Optional loading of a prototype atlas file into a scratch world as a starting sketch.

### Phase 4: Cultures and polities

- Culture and polity editors, the affinity model, and control and culture mix over time.

### Phase 5: Galactic routes and traffic

- Legs, routes, itineraries and directed flows.
- The balance report and balancing helper, and the Little's-law numbers.

### Phase 6: Sky view and approach planner

- The `sky` module, with the prototype torchlight's atmosphere and brightness physics moved into
  `@malevo/viz`. It draws real stars from the atlas, bodies from the system and torches from the
  flows.
- Approach-scale planning through the shared `foam` module.

**Exit:** the principle P2 test from section 1, on a fixture world. The sky from a city shows
exactly the routes the route planner has and the torch counts it implies. Editing a flow changes
the sky.

### Phase 7: History generator

- Port `settle.js` onto the shared core. Add tech gating, respecting fixed facts, propose/accept
  diffs and information propagation.
- This comes after phases 2–5 because it needs all of their entity types as inputs and outputs.

### Phase 8: Planet terrain

- The spherical noise generator, roll and lock, vector hand shaping, climate colouring and
  cached rasters.

### Phase 9: Population planner

- Cities on planets with population over time, the "conditions at a time" panel, and the sky view
  embedded.

### Phase 10: City planner

- The city format v2, timetables and travel-time routing on the shared kinematics, the 3D preview
  and the port capacity model.
- Optional loading of a prototype city file as a starting sketch.

### Phase 11 onward

- `malevo report` fact sheets (can come earlier if useful).
- The demand generator for flows, scene briefs ("conditions for this scene"), and reference
  exports.

---

## 10. Lessons from the prototypes

The prototype tools disagree with each other on the same quantity in several places: the collapse
threshold, transit speeds, a parking-orbit tilt, a time offset, a funicular's length. The app
does not pick winners. The lesson is structural, and the plan builds it in:

- **Every quantity has exactly one home in the world data,** and every tool reads it from there.
- **Values a world is likely to change are settings, not constants in code.** Examples: the
  threshold constant, the leg limit, transit speeds.
- **Values that can be computed are never entered twice.** A planet's day length, the number of
  torches in a sky and a port's load are derived from their inputs.

---

## Open decisions

Each has a recommendation, and the plan proceeds on it unless the author says otherwise.

### D1. Where world data lives (settled)

World data lives in its own repository, separate from this app repo and the prose. This
repository holds only the app, templates and synthetic fixtures.

### D2. File format

- Options: JSON vs YAML/TOML.
- **Recommendation:** JSON with a canonical formatter, plus Markdown sidebars for prose. JSON is
  the format the prototype tools already use, it is unambiguous, and the formatter keeps diffs
  small. YAML's comments are its main advantage, and the sidebars cover most of that.

### D3. Calendars in the new-world template

- **Recommendation:** a new world starts with Gregorian only. The 360-day calendar is offered as a
  ready-made `fixed` preset to add. Its epoch and each culture's adoption are timeline events, so
  any of them can move freely.

### D4. The reference clock and relativity

- **Recommendation:** use one Sol-barycentric reference time, with proper time tracked for torch
  legs.
- A world setting decides whether FTL travel has a clock-rate effect. The default is "none".

### D5. The unit for traffic flow

- **Recommendation:** ships per day, where a day is exactly 86,400 s, so it equals a Galactic day.
  The display can also show ships per year, or per local day.

### D6. Code signing

- macOS: an Apple Developer ID, notarization, and secrets for CI. Windows: a certificate, or
  accept SmartScreen warnings.
- **Recommendation:** ship unsigned at first, as devlog does, but plan for macOS signing before
  relying on macOS auto-update.

### D7. Git integration level

- Options: show status and commit on request, or devlog-style automatic commit and push.
- **Recommendation:** show status and commit on request, plus fork and compare. Settled data
  should be a deliberate commit.

### D8. Platforms

- **Recommendation:** macOS and Windows in CI, as devlog does. Linux AppImage if wanted.

### D9. Balance tolerance

- How large an imbalance at a node counts as "significant"?
- **Recommendation:** a world setting, defaulting to a warning above 2% of a node's total traffic
  or 1 ship per day, whichever is larger.
