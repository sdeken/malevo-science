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

### P0. The app is a workbench; canon is whatever the author keeps

- **The app contains no setting.** No star, planet, culture, date, name or story-specific number
  is written into the app's code, defaults or tests. A gas giant called "Hollin" is just a body
  someone created in some world folder. Nothing in the app knows it exists.
- **Everything is movable.** Stars, systems, bodies, routes, cultures and events can be created,
  dragged, re-rolled and deleted freely while the author explores. Nothing is canon until the
  author decides it is.
- **Canon is a set of files.** The app writes world folders. The author decides which world
  folder is canon, and commits it by hand to a repository of their own.
  - The app knows nothing about that repository. It does not know about git at all: it has no git
    integration, makes no commits and does not read history.
  - Every commit in the canon repo is therefore a human act. A record of human effort is the point.
  - The app works the same on a scratch world, a variant, or the canon world.
- **Prose and notes elsewhere are reference only.** Story documents and the existing prototype
  tools informed this plan, but the app never imports them as truth. Algorithms from the prototype
  tools are ported as code. Their data (star atlas, city file) can be loaded into a scratch world
  as a starting sketch, nothing more.
- **Tests use synthetic fixture worlds,** made up for the purpose. They test the physics and the
  formats, not any particular setting.

### P1. The world is diff-friendly text, and it does not shift under you

All world data is plain text files, written so the author can commit them to git (or anything
else) and read clean diffs. Most of the world
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
│  main: window, menus, file access, auto-update, worker pool                     │
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
                         │   world folder    │◄───────┤ malevo CLI: check / gen / │
                         │ (plain directory) │        │ query / report            │
                         └───────────────────┘        └──────────────────────────┘
```

**Design rules:**

- **`@malevo/core` and `@malevo/model` do not depend on Electron or the DOM.** The command-line
  tool and the tests run them under plain Node.
- **Only `@malevo/model` writes world files.** The renderer never touches the file system; it
  goes through IPC, as in devlog.
- **A world is a plain folder.** The app opens any folder and does not care whether it is inside
  a repository ([D7](#decisions)). Section 3.7 sets the rules for how it writes
  there.
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
- **The format is JSON, checked against schemas.** The schemas use a small purpose-built library in
  `@malevo/model`, not zod. Each schema validates, writes canonical output (key order, per-field
  rounding) and lists which fields reference other entities, all from one definition. Getting the
  last two from zod would mean depending on its internals. Prose lives in a Markdown sidebar file
  next to the entity rather than in JSON strings ([D2](#decisions)).
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

- **Fork world:** copies a world folder to a new folder, for a what-if. Examples: move a system, change the threshold constant, try a different settlement
  history.
- **Compare worlds:** a semantic diff between two world folders. The author can check out an
  old commit into a folder by hand and compare against that. It lists entities added,
  removed and changed, with field-level differences, plus the *derived* consequences (flows,
  travel times, sky). The question it answers: "what does this change actually do?"
- **Take pieces back:** copy selected entities from a fork into the main world.
- **Optional status tags** on any entity (`idea`, `draft`, `settled`, or whatever the author
  likes) can be used for filtering. The app attaches no meaning to them.

### 3.7 Writing discipline

The author commits by hand, so what the app writes has to be easy to review and easy to commit
in pieces:

- **Only files the author changed are written.** Opening, viewing, generating and checking never
  write. Nothing is reformatted on open; reformatting only happens with an explicit
  `malevo check --fix`.
- **Nothing derived lands in the world folder.** No caches, indexes, lock files, timestamps,
  machine names or "last opened" state. All of that lives in the app's own userData.
- **Generated content is written only when locked,** and only the locked entity's own file.
  Re-rolling a whole region of the galaxy writes nothing until the author locks something.
- **Edits that touch several files say so first.** Deleting an entity that others reference,
  for example, lists every file it would change and asks.
- **Saves are explicit by default** (Ctrl+S, with an unsaved-changes indicator). Autosave is an
  option.
- **Partial commits are the author's responsibility.** If only some of a change is committed, the
  repo can hold a dangling reference or a stale locked value. `malevo check`, run by the author,
  finds these. The app never tries to repair them on its own.

---

## 4. The shared library (`@malevo/core`)

Built first and tested hardest. Every number on screen should trace back to one of these.

| Module | Contents |
|---|---|
| `units` | SI internally; AU, ly, c, g, M☉, R⊕ and so on as named constants; formatting with units |
| `rng` | mulberry32, FNV hash, keyed streams, distributions (normal, Poisson, weighted pick) |
| `vec` | 3-vectors, matrices, quaternions; frame transforms (galactic ↔ equatorial ↔ ecliptic ↔ planet body-fixed) |
| `time` | The universal reference time scale, standard days, durations (section 5) |
| `calendar` | Calendar definitions and conversions (section 5) |
| `orbit` | Kepler solver, orbital elements ↔ state, positions at a date, synodic periods and alignment windows, habitable zone, insolation, tides, day length |
| `foam` | Collapse threshold as a function of mass, tidal load tensor and its norms, drop-point search, leg limit, top speed with artificial-gravity tilt, gas drain |
| `torch` | Rocket equation, 1 g flip-and-brake crawl, torch power and brightness |
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

The timeline must support several date systems side by side: Earth's Gregorian calendar,
era year-counts, planet-local calendars, culture calendars (including an insular culture's own),
and ship time. No calendar beyond Gregorian is built in or assumed.

### 5.1 One universal time

- **Time is the same everywhere.** There is one universal time and no relativistic clock
  effects: a second on a torch ship, in the foam or on any planet is the same second. Hard
  science fiction, not impossible-to-follow science fiction.
- **Internally, every instant is one number:** seconds since a fixed internal epoch. Whole seconds
  stay exact in a double for ±285 million years.
- **The standard day is exactly 86,400 s.** It is the app's working unit for rates (ships per day)
  and durations. It is a worldbuilding convenience, not an in-universe standard. A world's
  cultures can measure time however they like.
- **Calendars are only ways of reading that number.** An event entered in one calendar shows in
  every other.

### 5.2 Calendars

Each world defines its calendars in `calendars/`. A calendar is either a built-in kind with
parameters (JSON), or a script (JSON metadata plus a JavaScript file), for calendars whose rules
or formatting don't fit a table.

| Kind | Use | Notes |
|---|---|---|
| `gregorian` | Earth civil calendar | Proleptic Gregorian with leap years. No leap seconds. The slow drift of Earth's rotation is ignored. |
| `fixed` | Any regular calendar | Units nested to any depth (for example year/month/day/hour), each an exact number of seconds. No intercalation. An epoch parameter. |
| `solar` | A planet's local calendar | Derived from the body's real solar day and year (from `orbit`), with a leap rule computed to track the seasons. Local hours are a configurable fraction of the local day. Week length is configurable. |
| `era` | Year counts from some event | A year count laid over another calendar, with an epoch event. |
| `offset` | Ship time, a station's clock | A fixed offset from another calendar or clock, like a time zone. |
| `script` | Anything else, including culture calendars | A JavaScript module in the world folder (below). |

**Script calendars** (`calendars/<id>.js`, alongside `<id>.json`):

- **The module exports a small interface.** `toParts(t)` and `fromParts(parts)` convert between
  universal time and calendar fields, and `format(parts, style)` and `parse(text)` handle the
  written form. It can lean on the built-in kinds through a helper argument, for example
  "Gregorian fields, but months named and counted this culture's way".
- **Scripts run in a sandbox.** That means a worker with no file, network or Node access, a time
  limit, and no clock or randomness. The result depends only on the inputs, so a script is as
  deterministic as a generator.
- **The app tests each script on load.** It checks that `fromParts(toParts(t)) = t` across a range
  of dates, and the checks panel reports any mismatch.
- A script is plain text in the world folder, so it is diffed and committed like everything else.

**Cultures choose calendars.** Which calendar a culture uses, and when it switched, is a timeline
event. Any date can be displayed "as that culture would write it".

### 5.3 How events store dates

```json
{ "id": "e7k2", "name": "Charter ratified",
  "when": { "after": "e3m9", "offset": "130 y", "cal": "c-local" },
  "tags": ["politics"], "refs": ["p4q1"] }
```

- **A date is stored as universal time, an anchor plus an offset, or a range.** The calendar it
  was entered in is kept alongside (`"entered": {"cal": …, "text": …}`) for display only.
  Changing a calendar's script, or a planet's orbit under a `solar` calendar, therefore never
  moves an event. If an event's entered text no longer matches what its calendar now says, the
  event is flagged stale (section 3.4).

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
  - **Example:** in the rest-stop case, R balances by itself (17 in, 17 out). A then has 17 more
    departures than arrivals, and B 17 more arrivals than departures. The checks panel reports
    this until other flows bring those ships back, for example B → C → A.
- **Nodes can have a declared imbalance.** A node can be a net *sink* or *source* by design, and
  the check compares the actual imbalance with the declared one.
  - A ship graveyard might absorb one extra ship every 5 days on average, a sink of 0.2 a day.
  - A shipyard is a source.
  - Every trip leaves one node and arrives at another, so across the whole network arrivals
    always equal departures. Declared sinks must therefore be matched by declared sources (ships
    scrapped at the graveyard come from somewhere). The report shows the total of the declarations,
    which should be zero.
- **Tolerance.** An undeclared imbalance is a warning above 2% of the node's total traffic or 1
  ship per day, whichever is larger. The tolerance is a world setting.
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
  system can be moved to a different star at any time; the app shows the derived consequences
  before applying the move.
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

One panel, and also the `malevo check` command, which the author can run whenever they like. It runs every validator:

- schema errors and dangling references
- legs longer than the leg limit, legs through nebulae
- node flow imbalance beyond the declared imbalance plus tolerance, port loads over capacity
- events that happen before their enabling technology, anchor cycles
- cities in the ocean
- stale locked values

Each finding links to the entity concerned. Every finding is a warning the author can
acknowledge; none blocks saving, because a half-finished world is the normal state.

### 7.10 Reports

`malevo report` writes generated Markdown fact sheets for any entity: a planet's day, year and
moons; the routes and traffic at a system; sky facts for a city. They go to a folder the author
chooses, usually inside the world repo. They carry a "generated, do not edit" header and are
regenerated only on demand, so notes and prose can quote the same numbers the app uses.

---

## 8. Shell, build and release

Copied from devlog, with two gaps fixed. **Windows only** for now: this is a personal tool.

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
  - CI: typecheck, test, build and a Playwright `_electron` smoke test on every push, then
    Windows packaging. No macOS or Linux jobs.
- **Releases are automatic.** Every push to `main` publishes a GitHub release, with the patch
  version taken from the commit count on `main`. The repository must be public so installed copies
  can fetch updates.
- **Fixed relative to devlog**
  1. **npm workspaces.** devlog repeats its path aliases in four config files.
  2. **A linter** (ESLint, with a rule banning `Math.random` in `core`, `model` and `gen`), plus
     Prettier.
- **Golden-fixture job** (section 3.3) runs in the same CI.
- **Installer:** an unsigned NSIS installer, per user. electron-updater applies updates to an
  unsigned Windows app; the only cost is a SmartScreen warning on first install.

**Repo layout:**

```
src/main, src/preload  Electron main process and preload bridge (the app is the root package)
src/renderer/          tool host; each tool's UI module lives in src/renderer/src/tools/<tool>/
src/shared/            IPC channel names, shared types, pure policies (update timing)
packages/core/         pure library (section 4)
packages/model/        schemas, canonical serializer, loader/saver, queries, validators
packages/gen/          versioned generators + golden fixtures
packages/viz/          shared React/three.js components
packages/cli/          `malevo` command
packages/model/template/  the files every new world starts with (data, not code; editable)
fixtures/              synthetic test worlds
assets/catalog/        real-star catalogue
scripts/               smoke test, icon generator
docs/                  this plan, development guide, design notes, format spec
```

The Electron app is the root package, as in devlog, and `packages/*` are npm workspaces. Keeping
the app at the root avoids electron-builder's quirks with hoisted workspace dependencies. Workspace
packages are dev dependencies whose `exports` point at TypeScript source, so Vite bundles them into
the app and no package needs its own build step.

---

## 9. Phases: the order of the bites

Each phase ends with something usable, and later phases only add to earlier ones. Phases 0–2 are
the foundation, and doing them right is what makes principle P1 possible. Everything after that
can be reordered to suit what the author wants to explore next.

### Phase 0: Skeleton (shell, release, empty world) — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The exit test (one release updating itself to the next on
Windows) needs two pushes to a public `main`.

- The repo layout above, workspaces, lint, typecheck, vitest, CI.
- An Electron shell that creates or opens a world folder and hosts an empty tool registry.
- Auto-update end to end on Windows. One release updating itself to the next is the exit test.
- `world.json` with a format version and world seed; refuse unknown formats.

**Exit:** an installable app that updates itself and creates or opens an empty world.

### Phase 1: Core library and the stability contract — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The app shows only a Checks tool; the rest is the
foundation the tools stand on.

- `units`, `rng`, `vec`, `time`, `calendar` (all five kinds), `orbit`, `foam`, `torch`,
  `kinematics` and `flow`, with unit tests checked against textbook values: real solar-system
  ephemeris spot checks, rocket-equation cases, and port-fidelity cases from the prototypes.
- `@malevo/model`: schemas, the canonical serializer (key order, precision, formatting),
  loader and saver, reference resolution, the dependency and staleness graph, and the validator
  framework.
- The generator framework: `name@version` registry, keyed streams, golden-fixture tooling.
- `malevo check` and `malevo check --fix`.
- The new-world template, including `settings/physics.json`.

**Exit:** `malevo check` validates a fixture world. Changing a frozen generator fails the app's
CI build.

### Phase 2: Timeline editor and calendars (first real tool) — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). `solar` calendars take their day and year as numbers
for now; Phase 3 links them to a body so they follow its orbit. Choosing calendars per culture
waits for cultures (Phase 4).

- The event schema, with anchors, precision and tags.
- The timeline UI and the global "current date".
- The calendar editor for every kind, including script calendars and their sandbox; `solar` calendars become usable once bodies exist
  (Phase 3).
- Fork and compare worlds (section 3.6), first exercised on timelines.

**Why first:** the dependencies are simple, it settles the editing, saving and forking patterns
every other tool reuses, and every later tool needs "current date".

### Phase 3: Star atlas and solar system planner — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The prototype atlas file was not imported. It holds
only Sol and twelve nebulae, and nebulae belong with routes (Phase 5).

- The real-star catalogue as an asset. Port the prototype star generator (generated faint stars,
  per-cell seeding).
- A galaxy view where systems can be placed on stars and moved between them.
- The system and body editor, orbit view and derived physics.
- Optional loading of a prototype atlas file into a scratch world as a starting sketch.

### Phase 4: Cultures and polities — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). Culture traits are defined per world in
`settings/cultures.json`. Relations change at timeline events, and systems hold their history of
control and culture mix.

- Culture and polity editors, the affinity model, and control and culture mix over time.

### Phase 5: Galactic routes and traffic — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). Itineraries are a route's services: one-way runs
between two of its waypoints, stopping at every waypoint between. Seasonal profiles and the demand
generator (§6.4) are not built yet.

- Legs, routes, itineraries and directed flows.
- The balance report and balancing helper, and the Little's-law numbers.

### Phase 6: Sky view and approach planner — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The P2 exit test is `packages/model/tests/sky.test.ts`.
The sky is drawn on the CPU from `@malevo/core`'s sky model rather than torchlight's shader, so
it is the same code the tests check. Not ported: the city skyline and its vehicles (they belong to
the city planner), parked hulls, insertion burns, and the lee-planner's search for the best aim
and controlled cut (the Approach tool maps every aim instead).

- The `sky` module, with the prototype torchlight's atmosphere and brightness physics moved into
  `@malevo/viz`. It draws real stars from the atlas, bodies from the system and torches from the
  flows.
- Approach-scale planning through the shared `foam` module.

**Exit:** the principle P2 test from section 1, on a fixture world. The sky from a city shows
exactly the routes the route planner has and the torch counts it implies. Editing a flow changes
the sky.

### Phase 7: History generator — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The prototype's mechanics are kept and everything
particular to one story is taken out. Capability events, the origin, enclave cultures, polities
and their target shares all come from `settings/history.json`. Not built yet: tech gating beyond
the two drives, generated flows (they wait for the demand generator, §6.4), and information
propagation beyond radio and ships.

- Port `settle.js` onto the shared core. Add tech gating, respecting fixed facts, propose/accept
  diffs and information propagation.
- This comes after phases 2–5 because it needs all of their entity types as inputs and outputs.

### Phase 8: Planet terrain — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). Gas and ice giants and belts have no terrain. Climate
is a sketch: sunlight by latitude (or from the substellar point for a world locked to its star),
greenhouse warming from the air, heat transport, and a lapse rate. There are no winds, currents or
rain shadows yet.

- The spherical noise generator, roll and lock, vector hand shaping, climate colouring and
  cached rasters.

### Phase 9: Population planner — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). The tide is the equilibrium tide: the pull of the
moons and the star, without coasts or basins. Ships in port are the arrivals times the stopover.

- Cities on planets with population over time, the "conditions at a time" panel, and the sky view
  embedded.

### Phase 10: City planner — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). Loading a prototype city file is left out.

- The city format v2, timetables and travel-time routing on the shared kinematics, the 3D preview
  and the port capacity model.
- Optional loading of a prototype city file as a starting sketch.

### Writing — removed

A writing tool (chapters as Markdown on a novel page, character files, editor's marks in the
margin) was built and then taken out. The author writes in plain Markdown in their own editor.
This app stays a science and fact repository to check that writing against. A manuscript
preparation step (checking for stray editor's marks, producing the submission format) may come
later as a separate tool.

### Trip planner — built

Built; see [DEVELOPMENT.md](DEVELOPMENT.md). Ships are world files. The trip planner flies one
along a charted route with its own thrust, tanks and reserve, refuelling at every port, against
the route planner's idealized times.

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

## Decisions

All settled by the author.

| # | Topic | Decision |
|---|---|---|
| D1 | Where world data lives | In the author's own repository, separate from this app. This repo holds only the app, templates and synthetic fixtures. |
| D2 | File format | JSON with a canonical formatter. Prose goes in Markdown sidebars. |
| D3 | Calendars | A new world starts with Gregorian only, with no ready-made 360-day calendar. Culture calendars can be JavaScript scripts (section 5.2). |
| D4 | Time | One universal time, the same everywhere. No relativistic clock effects. |
| D5 | Rate unit | The standard day is exactly 86,400 s. It is a worldbuilding unit for ships per day and durations, not an in-universe standard. |
| D6 | Code signing | None. Windows SmartScreen warnings are acceptable. |
| D7 | Git | No git integration at all. The app doesn't know about repositories. The author commits by hand and owns the consequences of partial commits (section 3.7). |
| D8 | Platforms | Windows only. |
| D9 | Balance | Warn above 2% of a node's traffic or 1 ship per day. Nodes can declare an intended imbalance, such as a graveyard sink or a shipyard source (section 6.2). |
