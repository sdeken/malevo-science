# Development

## Setup

You need Node 22 and npm.

```
npm install
npm run dev          # the app with hot reload
```

## Checks

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, lint, Prettier check and unit tests: everything CI runs before the build |
| `npm run typecheck` | `tsc` over the main/preload/packages project and the renderer project |
| `npm run lint` | ESLint. In `packages/core`, `model` and `gen` it bans `Math.random`, wall-clock time and `localeCompare` (use `compareStrings`), so world data comes out the same on every machine (PLAN §3.2) |
| `npm run format` | Prettier, writing changes |
| `npm test` | Vitest: `tests/` and `packages/*/tests/` |
| `npm run smoke` | Builds, then drives the real app with Playwright, and runs the bundled `malevo` command against the world it creates. On Linux, wrap it in `xvfb-run -a` |
| `npm run malevo -- check <world>` | Builds and runs the command-line checker (see below) |
| `npm run golden:write` | Creates golden fixtures for frozen generators that have none yet; never overwrites one |

## Layout

- **`src/main`** is the Electron main process: the window, menu, IPC handlers, world session and
  updater.
- **`src/preload`** is the typed bridge, exposed as `window.malevo`. The renderer never touches
  the file system.
- **`src/renderer`** is the tool host: the welcome screen, sidebar, current-date bar and status
  bar. Tools live in `src/renderer/src/tools/<id>/` and are listed in
  `src/renderer/src/tools/index.ts`. The tools are Timeline, Stars, Systems, Terrain, Population, Routes, Sky, Approach, Cultures, History, Calendars,
  Fork & compare, Checks and World.
- **The world session lives in main** (`src/main/world.ts`): the open world, its unsaved changes
  (a `WorldEditor`), and every calendar operation. The renderer gets snapshots pushed to it, and
  sends edits and calendar requests back.
- **`src/shared`** holds the IPC channel names, the shared types, and pure policies such as when to
  install an update.
- **`packages/core`** (`@malevo/core`) is the pure shared library: units, keyed random streams,
  vectors and frames, universal time, calendars, orbits, the foam collapse rule, torch travel,
  vehicle kinematics, traffic flows and galactic routing (A* under the leg limit, around nebulae).
  It has no I/O, no DOM and no setting data. Every function
  takes the world's settings as arguments.
- **`packages/model`** (`@malevo/model`) is the world-folder format. It holds the schemas, the
  canonical JSON writer, the loader, references, the dependency graph and the checks. Its pure entry
  is safe for the renderer. File access lives in `@malevo/model/node`, which is the only code that
  reads or writes a world folder. `packages/model/template/` holds the files every new world
  starts with.
- **`packages/viz`** (`@malevo/viz`) holds shared renderers that draw from `@malevo/core`: so far
  the sky view. It uses the DOM, so it is type-checked with the renderer, not with Node.
- **`packages/gen`** (`@malevo/gen`) holds the versioned generators and, in `golden/`, their golden
  fixtures.
- **`packages/cli`** (`@malevo/cli`) is the `malevo` command. `npm run build` bundles it into
  `out/cli/malevo.mjs`.

### Adding a tool

1. Create `src/renderer/src/tools/<id>/<Name>Tool.tsx` exporting a `ToolDefinition`: `id`,
   `title`, `description` and `View`.
2. Add it to the list in `src/renderer/src/tools/index.ts`. The order there is the sidebar order.

Tool ids are saved in UI state, so a tool is never renamed once it has shipped.

## World folders

A world is a plain folder of JSON. A new one holds `world.json`, `settings/physics.json` and
`calendars/gregorian.json`. `world.json` looks like this:

```json
{
  "format": 1,
  "name": "Scratch",
  "seed": 4200339985
}
```

- **Creating** a world needs a missing or empty folder. The app writes `world.json`, with a seed
  from the operating system's random source, plus a copy of `packages/model/template/`, and nothing
  else.
- **Opening and checking** a world never write to it. The app writes only what you ask it to.
- **Older worlds** made before physics settings existed get a warning in the Checks tool. One
  button adds the missing template files, never touching existing ones.
- **Formats:** a `format` the app doesn't know, older or newer, is refused with a message, and the
  file is left untouched.
- **Unknown keys** in `world.json` are preserved.

App state (recent worlds, the last world opened, the auto-update setting) lives in the app's own
`settings.json` under Electron's userData folder: `%APPDATA%\Malevo Science` on Windows. App state
is never written into a world folder. The app has no git integration.

### File rules

- **One entity per file.** Each file is in canonical form:
  - keys in schema order;
  - each number rounded to its field's declared precision;
  - two-space indent, LF line endings, a trailing newline;
  - short number arrays on one line.
- **Units are in the field names:** `collapseRadius_au`, `offset_s`, `topSpeed_c`.
- **Unknown fields are kept.** They are written after the known ones, and the checks note them.
- **Ids** are lowercase letters, digits, `.`, `_` and `-`. A calendar's id is its file name.
- **Instants** are stored as `{ "t_s": <seconds since J2000>, "cal": <calendar id>, "text": <as
  entered> }`. Only `t_s` counts. If the calendar later reads that time differently from `text`,
  the checks say so, and the instant does not move.
- **Locked records** carry `"lock": { "gen": "name@1", "seed": …, "inputs": { "<entity key>":
  "<hash>" } }`. The checks flag a lock as stale when one of its inputs has changed.

### Events and dates

An event is a file `events/<id>.json`:

```json
{
  "name": "Founding",
  "type": "event",
  "when": { "after": "charter", "cal": "gregorian", "offset": { "year": 130 } },
  "until": { "after": "founding", "cal": "gregorian", "offset": { "year": 70 }, "circa": true },
  "tags": ["politics"]
}
```

- **`type`** is `event`, `period` or `story`.
- **A `when` is either a date, `{ "at": { "t_s": …, "cal": …, "text": … } }`, or an anchor,
  `{ "after": <event id>, … }`.**
  - An anchor can measure from the other event's start (the default) or, with
    `"from": "end"`, from its end.
  - It adds `offset`, counted in the named calendar's own units, and `offset_s`, exact seconds.
  - An end can be measured from the event's own start.
  - Moving an event moves everything anchored to it.
  - Cycles, missing events and unknown units are errors on the event, never crashes.
- **`precision`** names the calendar unit the date is known to, such as `"year"`. It defaults to
  what the entered text shows, or to the anchor's precision. The timeline draws that span as a
  band.
- **`circa: true`** marks a date as approximate, and the flag carries through anchors.

### Calendars

Calendars live in `calendars/<id>.json`, in the kinds `gregorian`, `fixed`, `solar`, `era`,
`offset` and `script`. A new world has only Gregorian.

Every calendar writes dates the same way, and parses that form back. The year comes first, then
the other date units joined by `-`, then the time units joined by `:`. For example
`2031-07-04 09:30`, or `XE 450-03-12` for an era.

**Script calendars** are a `calendars/<id>.json` declaring the units, plus `calendars/<id>.js`:

```js
module.exports = {
  toFields(t, h) { /* t: seconds since J2000.0 → { year, month, … } */ },
  fromFields(f, h) { /* → t */ },
  yearLabel(year, h) { /* optional: how the year is written */ },
  parseYearLabel(text, h) { /* optional: the reverse, or null */ }
}
```

- **What a script gets:** only JavaScript's built-ins and the helper `h`, which offers `DAY`,
  `floorDiv`, `daysFromCivil`, `civilFromDays`, and `gregorian.toFields` / `fromFields`.
- **What it doesn't get:** `Date`, `Math.random`, `require`, `process` or `eval`.
- **Every call has a time limit,** so a script can't hang the app.
- **The smallest unit must carry any fraction,** so that `fromFields(toFields(t))` gives `t` back.
  The checks test this across ±10,000 years.
- **Scripts run only in the main process and in `malevo`.** The renderer asks main for every
  date it shows.

### Stars, systems and bodies

- **The catalogue** is `assets/catalog/hyg-stars.json`: the HYG database, CC BY-SA 4.0 (see its
  README). It ships beside the installed app, and the app adds Sol, which the file leaves out.
  - Catalogue stars are `hip.<n>`, or `hyg.<n>` without a Hipparcos number; Sol is `hyg.0`.
  - These ids appear in world files, so a rebuilt catalogue must keep every one of them.
- **Generated faint stars** fill in what the catalogue can't see, one 25 ly cell at a time.
  - They come from `starfield@1`, the prototype's generator ported exactly, using the world's
    `settings/stars.json`. Without a `seed` there, the world seed is used.
  - Their ids are `g.<ix>_<iy>_<iz>.<k>`.
  - Changing those settings changes the generated stars, and the checks flag any system left
    without its star.
- **Star physics** are estimated from the catalogue:
  - temperature from the B−V colour (Ballesteros 2012), or from the M-dwarf main sequence for cool
    dwarfs;
  - luminosity through the bolometric correction (Torres 2010);
  - mass from the main sequence, which is unknown for giants;
  - radius from luminosity and temperature.

  A system's `starOverrides` replaces any of these.
- **A system** is `systems/<id>.json`: `name`, `star` and optional `starOverrides`.
- **A body** is `bodies/<id>.json`:
  - `system`, and `parent` if it orbits another body;
  - `class`;
  - `orbit`: `a_au` or `a_km`, `e`, angles in degrees, `meanAnomaly_deg` at `epoch`;
  - `mass_mearth`, `radius_km`;
  - `rotation`: `period_h`, negative for retrograde, or `locked`; plus `tilt_deg`;
  - optional `albedo`.

  Everything else is derived and shown, never stored: periods, positions at any date, sunlight,
  temperature, gravity, solar day, Hill sphere, foam collapse radius, and daylight by latitude.
- **`planets@1`** proposes a planetary system for a star.
  - Each roll number is its own keyed stream, so roll *n* of a system is always the same.
  - Keeping a roll writes locked bodies, recording `planets@1` and the seed. It replaces bodies
    kept from an earlier roll of that system; bodies you made or edited stay.
  - Editing a kept body removes its lock: from then on it's yours.
- **A planet-local calendar** can `follow` a body. Its day and year are then that body's solar
  day and the year of the planet it belongs to. A planet locked to its star has no solar day to
  follow.

### Physics settings

- **The World tool edits `settings/physics.json` in place:**
  - **Foam:** top speed, leg limit, gravity limit, collapse radius and load rule.
  - **Torches:** cruise acceleration, exhaust speed, propellant share and governor cutoff.
  - **Travel and traffic:** stopover, balance tolerance and balance floor.

  Edits are unsaved and undoable like any other, and every tool follows them at once.
- **Every trip time comes from these settings.** Foam time is distance over the top speed. Burns
  and crawls run at the cruise acceleration, and the tanks (exhaust speed and propellant share)
  cap a crawl's speed when they are too small for flip-and-burn.
- **The load rule** is how tides from several bodies combine into the foam's load:
  - `max-eigen` counts the strongest stretch in any one direction;
  - `rss` counts the tide's overall size, every direction together.

  The two agree exactly around a single body, and along the line through a star and a giant,
  where both tides stretch the same way. They differ only where tides pull across each other,
  on a giant's flanks. There `rss` reaches a little further: at most about 6% of the giant's
  bubble (0.248 against 0.264 AU for a Jupiter just outside Sol's edge).

### The collapse surface

- **Where the foam collapses** is the surface where the load from every body's tide reaches 1
  (`collapseRegions`, `collapseMesh` and `collapseSlice` in `packages/core/src/foam.ts`).
- **The orbit view** draws the region as seen from above the system plane, at the current date.
  It is one load field for the whole system (`topDownLoad`): at each point, the highest load
  along the line through it at right angles, so a bubble round a planet on an inclined orbit
  still shows. The field is sampled on a grid laid out in the view's own drawing units (log or
  linear, panned and zoomed) and contoured there (`contourGrid`). Every line is the field's,
  mapped point by point, with nothing drawn per body:
  - two bubbles stay apart until the load between them reaches 1, then join through a smooth
    neck;
  - a lee shows as a dent;
  - on the log scale the shapes are bent the way the scale bends everything else.
- **Isolines** (a toggle by **Log scale**) draw the same field at 1/8, 1/4, 1/2, 2, 4 and 8
  times the collapse load, to give a sense of the region's shape.
- **The Routes tool** draws a leg between two systems end to end (`LegView.tsx`):
  - both ends, seen side-on to the leg, to the same scale;
  - each system's plane tilted as it really is against the other's, with its pole marked and
    the angle between the leg and the plane;
  - the collapse region cut through the plane that holds the leg, with isolines;
  - where the approach model drops ships out of the foam, and their crawl to the port.

  A slider turns the view about the leg.
- **The trip in four stages** is shown under the leg, as a bar to scale and in a table. Each
  stage is a burn at the world's cruise acceleration, from rest in orbit to rest in orbit:
  - **Departure burn:** the origin's crawl from its port out to where ships enter the foam.
  - **Foam:** the leg's time in the foam.
  - **Acceleration and deceleration burns:** the destination's crawl from the drop to its port.
    It is flip-and-burn, split at the flip.

  The origin is drawn at departure (the current date). The destination is drawn, and its
  approach worked out, at the moment of the drop, so each system's planets are where the ship
  finds them.
- **`collapseOutlines`** traces each body's area, cut at that body's own height. The torch
  times use it for the star's edge.
- **`collapseRegions` and `collapseMesh`** give a 3D mesh found along rays from each centre. They
  assume a region looks like a single blob from its centre, so they cannot show a neck or two
  bubbles side by side. The app does not draw them.

### Moving around a system, and torch times

- **The orbit view pans and zooms:** the wheel zooms about the cursor and dragging pans. Marks and
  labels keep their size on screen, and **Reset view** goes back to the whole system. Zoomed in,
  smaller collapse bubbles are traced too.
- **Torch times** (under the orbit view, `TorchTimes.tsx`) use the world's torch settings and an
  acceleration that defaults to the cruise setting (1 g).
  - **From the drop:** the nearest and farthest points of the star's collapse edge to a chosen
    body (the system's port by default), at the current date.
  - **Any leg:** **Measure a leg** and click two places or bodies.
  - **For each leg:** the distance, the light delay, the time to arrive at rest (flip halfway),
    the time and speed flying by (burning all the way), and the **warning**: from when the
    drop's light arrives to when a ship burning all the way does.
  - **Assumptions:** trips start from rest and run in a straight line. Gravity and the target's
    motion are ignored. The tanks (exhaust speed and propellant share) can cap the speed, and
    hovering a time says which limit set it.

### Terrain

- **A terrain** is `terrains/<id>.json`, one per body: a surface for rocky, ocean and dwarf
  bodies, cloud bands for giants.
  It holds:
  - `params` and `roll` for terrain@1;
  - optional `climate` inputs;
  - `shapes` drawn by hand;
  - an optional `lock`.
- **terrain@1** (`packages/gen/src/terrain.ts`) evaluates heights at points on the unit sphere,
  so every size of map reads the same:
  - tectonic plates (Voronoi cells, borders roughened by noise), continental or oceanic, each
    drifting;
  - mountains where plates converge, a ridge where they part;
  - broad swells and fractal hills;
  - sea level set so the share of the surface under water is the one asked for.

  Its stream is keyed by body and roll. Re-rolling counts the roll up; locking records the
  generator and stops re-rolling.
- **Hand shaping** is text, in latitude/longitude degrees, never pixels:
  - `land` and `sea` polygons force an area above or below sea level;
  - `raise` and `lower` polygons lift or sink it, easing in over `width_deg` from the edge;
  - `ridge` lines add a mountain range of `height_km` along the great circles between the points.
- **The look follows the planet:**
  - **Temperature:**
    - mean surface temperature is the body's equilibrium temperature plus greenhouse warming
      (from its air, or `climate.greenhouse_K`);
    - spread by the yearly sunlight at each latitude for its tilt, or by angle from the
      substellar point if it is locked to its star;
    - evened out by `heatTransport`, and cooled 6.5 K per km of height.
  - **Biomes:** temperature, height, surface water and a wandering dry belt either side of the
    subtropics give seas, sea ice, ice, tundra, forests, grassland, savanna, desert and tropics.
  - **Dry worlds** (`climate.water`, by default yes only with half an atmosphere or more) are
    rock, with frost where it is very cold; `climate.rock` sets the rock's colour.
  - `climate.temperature_K` fixes the mean temperature, so the look stops following the orbit.
- **Giants** (gas and ice) have no surface. Their terrain file holds `bands` instead of
  `params`: the number of bands, contrast, turbulence, storms and a palette. **bands@1**
  (`packages/gen/src/bands.ts`) colours points on the sphere: bands by latitude bent by
  turbulence, streaks sheared along them, and swirling storm ovals.
- **Clouds** are an optional layer over a surface: `clouds {cover, cells, turbulence, storms,
  colour}` in the terrain file. **clouds@1** (`packages/gen/src/clouds.ts`) gives coverage from
  0 to 1: belts from the circulation cells (Earth has three per hemisphere, so cloudy at the
  equator and near 60°, clear near 30°), eddying weather, and spiral cyclones. Its threshold is
  calibrated so the average cover is `cover`. The clouds are weather to look at, not a record of
  the sky at any moment. They re-roll with the terrain. The Terrain tool draws them over the map
  and globe with a **Show clouds** toggle, and exports them as a separate PNG whose transparency
  is the coverage. A giant's bands are its clouds, so a cloud layer on a giant is not drawn.
- **Rasters** (height and colour maps) are derived in the main process and cached per world
  version; nothing is written to the world. **Export** saves a 2048×1024 PNG wherever you choose,
  for reference.

### Writing

- **Prose is any `.md` file in the world folder outside the folders the world format uses:**
  chapters, scenes, notes, in any subfolders you like. The app reads and edits them as Markdown
  and knows nothing else about them (`packages/model/src/prose.ts`).
- **Characters** are `characters/<id>.md`: a short header, then free notes.

  ```
  ---
  name: Div
  names:
    - T (Kasinov)
    - Divvy (Mara; only when she's annoyed)
  ---
  Grew up on the docks.
  ```

  Each extra name may say who uses it (character ids or names, separated by commas) and give a
  note after a semicolon. Header lines the app does not use are kept as written.
- **The Writing tool** (`src/renderer/src/tools/writing/`) edits a file on a novel page:
  - a serif book column, first-line indents, centred chapter heads, and `---` as a centred
    scene break (⁂);
  - Tiptap with Markdown, the same setup as devlog, with typographic quotes and dashes as you
    type.
- **Your header is kept:** a file's front matter (`---` … `---` at the top) is kept byte for
  byte and never shown in the editor.
- **Names stay plain text.** The prose never holds ids or hidden marks.
  - **Typing `@`** offers every name and nickname and inserts the plain name.
  - **Recognised names** are underlined faintly as you read; a name two characters share is
    underlined in orange.
  - **Clicking a name** opens that character.
  - **"Where the names appear"** lists every use of each of a character's names by file and
    line, so a change of nickname is made by hand.
- **Untouched files stay untouched.** On opening, the tool checks whether the editor would
  write the file differently, for example `_italic_` as `*italic*`. If it would, it shows an
  example and stays read-only until you choose **Edit anyway**. A file you only read is never
  rewritten.
- **Saving works like every other edit:** typing becomes an unsaved, undoable change after a
  short pause. Save, or leaving the window, writes what is still pending first. The app re-reads
  the folder when its window regains focus, so files edited elsewhere show up.

### Cities and conditions

- **A city** is `cities/<id>.json`. It holds:
  - a body, latitude and east longitude, and elevation;
  - its `population` as counts at dates (written like event dates), growing by the same factor
    each year between counts and holding after the last;
  - a `port` role (the system's `main` port, or `minor`);
  - a `polity` that overrides its system's history;
  - a region, and the calendar its people use.
- **Conditions at a time** (`conditionsAt` in `packages/model/src/cities.ts`) come from the shared
  model:
  - **Local solar time:** the star's hour angle about the body's pole, in local hours (24 to a
    solar day), and the date in the city's calendar.
  - **Season:** from the star's declination and whether it is climbing.
  - **Day:** its length, civil, nautical and astronomical twilight, and sunrise and sunset.
  - **Tide:** the equilibrium tide from every body's pull, with whether it is rising, its level
    in the day's range, the next high water, and springs or neaps.
  - **Held by:** who holds the city.
  - **Port:** for the main port, the ships arriving and leaving (the route network's own torches)
    and about how many are alongside (arrivals × stopover).
- **The Population tool** places cities by clicking the body's terrain map, edits population
  counts with a chart, and embeds the same sky as the Sky tool (`useSky` and `SkyCanvas`).
- **The `cities` check** flags a city under the sea on its body's terrain, and notes cities on
  bodies with no surface.

### City plans

- **A city plan** is `cityplans/<id>.json`, one per city, in metres with x east, y north and z up.
  It holds the plan's extent, default ground, and walking speed and detour, plus lists of objects,
  each with an `id`, `name`, `note` and `hidden` flag:
  - `ground`: polygons at a height (or on a sloping plane), with a surface;
  - `water`: sea, river and basin polygons;
  - `lines`: streets, avenues, highways, stairs, rail, field lines, funiculars, sea walls, piers.
    A line can carry a `service` (headway, speed, acceleration, dwell, stops, cars, tracks,
    phase and running hours);
  - `regions`: districts filled by a preset (`buildings`, `cliff`, `yards`, `scatter`, `empty`)
    from its JSON `params`;
  - `buildings`: hand-placed landmarks;
  - `points`: labels, stations, viewpoints and lighter fields.

  It also has `orbit` (the lighter field, the flight time and the gap between launch windows)
  and `port` (the stack tool's numbers).
- **cityplan@1** (`packages/gen/src/cityplan.ts`) is a port of the prototype city generator. It
  turns the plan into boxes (buildings, lamps, rails, cars parked in yards) and the vertical
  faces where ground areas meet. Each object draws from its own stream, so editing one district
  leaves the rest alone. `cityServices` builds each service's timetable: stops, departures and
  arrivals both ways, accelerating and dwelling. A funicular's two cars run as a pair.
- **Travel** (`cityTravel` in `packages/model/src/cityplan.ts`) is the earliest arrival over
  walking and riding. Walking is straight-line distance times the detour. Rides wait for each
  service's real next departure and keep to its running hours. "To orbit" walks or rides to the
  lighter field, then adds half the window gap and the flight.
- **The port** (`portCapacity`) gives freighters a day under four limits: the approach corridor
  (1440 ÷ spacing), the stack (berths ÷ days in stack), the lighter fleet and the field's
  movements. Each limit counts lighter trips per freighter. The binding one is the capacity. For
  a system's main port it is set against the route network's own arrivals, and the `cityPlans`
  check warns when arrivals exceed capacity.
- **The City planner** draws the plan from above. You draw ground, water, lines and districts by
  clicking corners and double-clicking to finish, place landmarks and points, and edit any object
  in the side panel. A time-of-day slider (play to animate) moves the cars. Travel mode gives the
  quickest trip between two clicks, or to orbit. **3D** shows the same scene lit by the sun at
  that time, from the city's place on its body.
- Loading a prototype city file directly is not built; the format is close enough to paste its
  objects in by hand.

### The Solar System

- **Every new world starts with the real Solar System** (`packages/model/src/solarSystem.ts`):
  - Sol;
  - the eight planets, plus Pluto, from JPL's J2000 elements;
  - Ceres, Haumea, Makemake and Eris;
  - the Moon, and the regular moons of Mars, Jupiter, Saturn, Uranus and Pluto, plus Triton;
  - the main belt and the Kuiper belt.

  It is astronomy, not a setting; change or delete any of it.
- **Worlds made before it** get it from the Systems tool's **Add the Solar System**. If a
  system already sits on Sol, the bodies join it; bodies whose ids are taken are left out.
- **Orientation and rotation** come from the IAU's poles, prime meridians and rotation rates,
  converted to tilt, equinox and meridian. Earth's seasons and clock are real: at J2000 noon the
  Sun stands about 15.5° up, due south, over Greenwich.
- **Sol's `frame`** is the J2000 ecliptic. Its `zero_deg` puts longitude 0 at the vernal equinox,
  so the published elements are used as they are.
- **Moons:** regular moons orbit in their planet's equator. Their sizes and periods are right;
  where they are along their orbits at a date is not, except the Moon's.
- **Belts** are bodies of class `belt`, with their `extent` (inner and outer edge) drawn as a band.

### Known planets of other stars

- **Planets found around real stars** are in `packages/model/src/knownPlanets.ts`. So far only
  Proxima Centauri's are listed:
  - **d** (0.029 AU, at least 0.26 Earth masses), confirmed, too hot for liquid water;
  - **b** (0.049 AU, at least 1.07 Earth masses), confirmed, in the habitable zone;
  - **c** (1.5 AU, at least 7 Earth masses), a disputed candidate.
- **A system made on the star** from the Stars tool starts with the confirmed planets. The
  Systems tool offers any that are missing, and the candidate on request.
- **What is not measured is placeholder:**
  - The orbits lie in the system plane, since the inclination is unknown.
  - Masses are minimum masses; radii are estimated from them.
  - Positions along the orbits at a date are not the real ones.
  - The inner planets are taken as tidally locked.
- **Rolling planets** on such a star adds invented planets beside the known ones. A rolled
  planet whose orbit would cross one the system already has (anything not from planets@1) is
  greyed in the roll and left out when it is kept.

### Cultures, polities and relations

- **`settings/cultures.json`** defines the traits cultures are described by, as id, label,
  meaning at 0 and 1, and weight. A new world starts with openness, trade and expansion; add or
  reweight traits freely.
- **A culture** is `cultures/<id>.json`:
  - name and colour;
  - `traits`, 0–1 each, with a missing trait counting as 0.5;
  - `techLag_y`;
  - a naming `palette` (0–7) for placeholder names;
  - the `calendars` it uses, each from an event onward.
- **A polity** is `polities/<id>.json`: name, colour, dominant `culture`, `capital`, and the
  `founded` and `dissolved` events.
- **Affinity** between two cultures runs from −1 to 1. It is computed from their traits (see
  `packages/model/src/cultures.ts` for the formula). Two open, identical cultures come out at 1;
  closed ones are cooler, down to `2 × closedFloor − 1`.
- **A relation** is `relations/<a>--<b>.json`, with the ids sorted.
  - It can replace the computed affinity, and can `change` it at timeline events, such as a war
    or a treaty.
  - The latest change at or before a date holds.
- **A system's `history`** lists entries saying who holds it (a polity) and who lives there
  (culture shares). Each holds from its `from` date until the next entry.
  - Those dates are written like event dates: a date in any calendar, or anchored to an event.
  - The star map colours each system by the polity holding it at the current date.

### Routes and traffic

- **Nodes** are systems, stations and bare stars. Inside the app they are written
  `system:<id>`, `station:<id>` and `star:<id>`. A star that carries a system counts as that
  system.
- **A station** is `stations/<id>.json`: name, `pos_ly` (galactic light-years from Sol) and an
  optional `declaredNet_perDay`.
- **A nebula** is `nebulae/<id>.json`: name, `center_ly`, `radii_ly` (an axis-aligned ellipsoid)
  and an optional colour. No leg may cross one.
- **A route** is `routes/<id>.json`:
  - name and optional colour;
  - `waypoints`, each naming exactly one `system`, `station` or `star`;
  - `services`, each a one-way run `from` one waypoint index `to` another at `perDay` ships per
    standard day, stopping at every waypoint between. A → B and B → A are separate services, and
    either may be missing.
- **Systems** can name a `port` body (where ships dock) and a `declaredNet_perDay`.
- **Trip times** (`packages/model/src/routes.ts`) are worked out, never stored:
  - At a system, ships crawl by torch between the dock and the edge of the star's collapse zone.
    The dock is the port body's distance from the star, or 1 AU × √L if no port is set. They
    burn all the way out, and flip and burn on the way in, at the cruise acceleration.
  - Stations and bare stars have no crawl.
  - Foam legs take distance ÷ top speed.
  - Every stop between the ends adds a crawl in, the stopover, and a crawl out.
- **Little's law:** a service ties up perDay × door-to-door time ships; a leg has perDay × leg time
  under way.
- **Balance:** every node's arrivals, departures, through traffic and net are compared with its
  declared imbalance, within the world's tolerance. The declared imbalances should add up to zero.
- **The balancing helper** finds the least extra traffic, in ship-days, that balances every node,
  using existing route legs in either direction. Consecutive legs are joined into through
  services. It only proposes; the author adds what they want.
- **The route planner** runs A* over the stars and stations in a sphere around both ends. Each
  stop costs its crawl and the stopover.

### Sky and approach

- **Frames:**
  - A system's orbits are measured from its reference plane. By default that is the galactic
    plane; a system's `frame` (`poleL_deg`, `poleB_deg`) tilts it. Star positions and route
    directions come from the atlas in galactic coordinates and are turned into that frame, so the
    stars, the bodies and the torches share one sky.
  - A body's north pole is tilted from its orbit's normal by `rotation.tilt_deg`. It leans so its
    northern spring equinox comes at orbital longitude `rotation.equinox_deg`, measured from the
    ascending node (default 0).
  - Its prime meridian is at `rotation.meridian_deg` (default 0) at universal time 0 and turns
    with the rotation period. A locked body keeps longitude 0 toward what it orbits.
  - The Sky tool's **Make it noon here now** sets `meridian_deg` so the world's clock reads local
    noon at the chosen longitude.
- **Air:** a body's `atmosphere` (`pressure_atm`, optional `scaleHeight_km`) is Earth's scaled by
  its column of air (pressure over gravity), scale height, radius and starlight. Without one the
  sky stays black by day.
- **The sky model** (`packages/core/src/atmosphere.ts`) is ported from the prototype torchlight:
  - single scattering, plus the fitted multiple-scattering twilight term;
  - the natural night sky, the Milky Way along the real galactic plane, and moonlight;
  - extinction, refraction, and the limiting magnitude against the local sky (naked eye,
    binoculars or telescope, by zoom).

  One departure: ozone is scaled to Earth's real column, about a third of the prototype's, which
  turned twilight purple.
- **Stars** are the catalogue's (plus nearby generated ones) as seen from the system's own star.
- **Bodies** are drawn as discs with their phase when they are big enough.
- **Torches** (`packages/model/src/sky.ts`) are the route network's own numbers (principle P2):
  - Every service through the system sends ships in at its rate. Each spends the node's crawl time
    on a straight line from the collapse edge (toward the route's neighbour) to the port, so
    λ × crawl time are under way.
  - Ships enter in a steady stream, offset per service, so the number up at any instant is the
    whole number either side of the average.
  - Brightness: the jet's power (ship mass, cruise acceleration and exhaust speed) times the
    visible fraction, full from behind the plume and dimmer (the front factor) from ahead.
  - Within the governor's cutoff of the port, torches are off.
  - The physics settings gain the optional `torch.shipMass_t`, `visibleFraction` and
    `frontFactor`.
- **Viewpoints** are `viewpoints/<id>.json`: a body, a latitude, an east longitude and an
  optional elevation.
- **The approach** (`packages/core/src/approach.ts`, from the prototype lee-planner):
  - A ship comes in on a straight line from the other star, aimed at the port, drops where the
    foam first collapses under every body's tide, then flips and burns to the port.
  - The Approach tool shows the drop, the crawl, and what the bodies' lee saves against the star
    alone.
  - It also shows the best and worst crawl within a navigator's margin, a map of crawl time over
    aim offsets ("looking down the lane"), and a sweep over the years with the lee windows shaded.

### The history generator

- **`settings/history.json`** (created by the History tool) says what to play out:
  - the origin system and its culture;
  - the events that bring slow ships and the foam drive, and the event that ends the run;
  - slow ships' reach and how many colonies they found;
  - how many systems by the end, and how far out;
  - culture rates: enclaves, branching, blending;
  - the belief cultures that found enclaves (each from an event);
  - the polities: when they form, each one's target share of the systems, and how fast it pulls
    its systems toward one culture.
- **`history@1`** (`packages/gen/src/history.ts`) has the prototype `settle.js` mechanics with
  nothing particular to one story:
  - slow-ship colonies near the origin, each starting a regional culture;
  - after the foam drive, colonies up to two legs out, with outposts at the stops between;
  - enclaves and branching cultures, and blending along lanes;
  - polity borders by weighted distance from each capital, balanced to the shares.

  Stars off the main sequence are never settled. A history is path-dependent, so the run draws
  from one stream. Names come from per-star streams.
- **Gated by the timeline:**
  - Nothing is settled before the slow-ship event.
  - Before the foam drive, nothing is settled beyond slow ships' reach.
  - No route opens before the foam drive.

  The `history` check reports authored systems and routes that break this.
- **Fixed facts:** every existing system is a fixed point.
  - With a dated history, it is settled at its first entry, with that entry's cultures and its
    latest polity.
  - Without one, it is a place the run should reach.
  - A polity's capital is kept.
  - What the run cannot honour is listed under "What it could not honour".
- **Proposals:**
  - A run proposes new systems (with histories: founded, when the polities formed, at the end)
    and new regional cultures.
  - It proposes routes, with `opened` dates. Slow-ship links that fit the leg limit open when the
    foam drive does.
  - It proposes events, with `where`, and capitals for polities that have none.
  - Accepted pieces are written as one undoable, unsaved step, locked to `history@1` (provenance
    only: no inputs, so they never go stale). On the next run they are fixed points.
  - To compare runs, fork the world and accept in the fork.
- **News** (`newsArrival`): when each system heard of an event that has a `where`.
  - It goes by radio at the speed of light, or by ship over the routes open at the time (once the
    foam drive exists), whichever is first.
  - Each ship leg takes its door-to-door trip time plus half the gap between sailings on its
    services.

### Editing, saving, undo

- **Every edit in the app is unsaved until you save,** with Ctrl+S, File › Save or the status bar.
  The status bar counts the files with unsaved changes; hover the count to list them.
- **Saving writes exactly those files.** Undo and redo (Ctrl+Z, Ctrl+Y) work on world changes
  whenever focus isn't in a text field.
- **Leaving with unsaved changes asks Save / Don't save / Cancel.** That covers closing the window,
  closing the world, and opening or creating another.
- **Updates never install while there are unsaved changes.**
- **When the window regains focus, the app re-reads the folder,** so edits made outside the app
  show up. Unsaved changes stay on top of them.

### Fork and compare

- **Fork** copies the saved world, without dot-folders such as `.git`, into an empty folder, named
  "<name> (fork)". Unsaved changes aren't copied.
- **Compare** lists what differs from another world folder, field by field, including this
  world's unsaved changes, and which events land at a different time because of it.
- **Take** copies an entity from the other world. For an entity the other world lacks, it deletes
  it here. A take is an unsaved change like any other.
- To compare against an old version, check that commit out into a folder yourself; the app knows
  nothing about git.

### The command-line checker

`malevo` checks a world from outside the app, for example before you commit. It knows nothing
about git.

```
npm run malevo -- check C:\path\to\world          # report; writes nothing
npm run malevo -- check C:\path\to\world --fix    # also rewrite files into canonical form
npm run malevo -- check C:\path\to\world --json   # findings as JSON
npm run malevo -- template C:\path\to\world       # add missing template files
```

Exit status is 0 when there are no errors, 1 when there are, and 2 when the command could not run.
The app's **Checks** tool runs the same checks.

### Generators and golden fixtures

A generator is a pure function, `name@version`, that draws randomness only from keyed streams:
`keyedStream(worldSeed, name, entityId, purpose)`. Once a version is `frozen`, its output for any
input must never change, because locked records name it and may be regenerated from it.
`packages/gen/golden/<name>@<version>.json` pins the output hashes of each frozen version, and
`npm test` fails if one moves.

**If a golden test fails, do not edit the fixture.** Find what changed the output: the code, a
dependency, or the JavaScript engine.

To add a generator:

1. Write it in `packages/gen/src`.
2. Add it to `GENERATORS`.
3. Add its pinned inputs to `CASES` in `packages/gen/tests/golden.test.ts`.
4. Freeze it, then run `npm run golden:write`.

To improve a frozen generator, add a new version alongside the old one.

## Releases and auto-update

Releases are Windows only and unsigned, so Windows shows a SmartScreen prompt on first install.
Updates come from GitHub Releases through electron-updater:

- A packaged app checks 30 seconds after launch, then every 4 hours.
- It downloads updates in the background.
- It restarts into the new version at a quiet moment: screen locked, window hidden and idle, or
  input idle for 15 minutes. It never restarts while a tool reports unsaved changes.
- The status bar offers **Update now** once a download is ready.
- Auto-install can be turned off under **Help → About**.

### How releases happen

Releases are automatic. Every push to `main` runs CI:

1. the checks and the Linux smoke test,
2. the Windows smoke test and the NSIS installer,
3. a GitHub release with three assets:
   - `Malevo-Science-Setup-<version>.exe`
   - its `.blockmap`
   - `latest.yml`, which installed copies poll

**Version numbers** are `<major>.<minor>.<patch>`:

- Major and minor come from `version` in `package.json` (now `0.1`). Bump them by hand when you
  want to mark a milestone.
- The patch is the number of commits on `main`, so every release is numbered higher than the last.
  This assumes `main` is never rewritten.
- `package.json` keeps `.0` as its patch, and local builds report that.

**Pushes to other branches and pull requests** run the same checks and build the installer, but
publish nothing. That run's installer can be downloaded from the run's **Artifacts** section on
GitHub.

**The repository must be public for auto-update to work.** Installed copies fetch `latest.yml` and
the installer from GitHub without signing in. A private repo's releases can still be downloaded by
hand while signed in to GitHub, but no installed copy will ever see an update.

### Phase 0 exit test: updating from one release to the next

1. Push to `main`, or merge into it. Download the release's `Malevo-Science-Setup-<version>.exe`
   and run it, choosing **More info → Run anyway** at the SmartScreen prompt.
2. Create a world, then quit.
3. Push any further commit to `main`. CI publishes the next patch version.
4. Launch the installed copy. Within about a minute the status bar shows "Downloading <next
   version>…", then **Update now to <next version>**.
5. Click it. The app restarts as the new version and reopens the same world. The world folder
   still holds only `world.json`, unchanged.
