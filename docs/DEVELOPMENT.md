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
  `src/renderer/src/tools/index.ts`. The tools are Timeline, Stars, Systems, Cultures, Calendars,
  Fork & compare, Checks and World.
- **The world session lives in main** (`src/main/world.ts`): the open world, its unsaved changes
  (a `WorldEditor`), and every calendar operation. The renderer gets snapshots pushed to it, and
  sends edits and calendar requests back.
- **`src/shared`** holds the IPC channel names, the shared types, and pure policies such as when to
  install an update.
- **`packages/core`** (`@malevo/core`) is the pure shared library: units, keyed random streams,
  vectors and frames, universal time, calendars, orbits, the foam collapse rule, torch travel,
  vehicle kinematics and traffic flows. It has no I/O, no DOM and no setting data. Every function
  takes the world's settings as arguments.
- **`packages/model`** (`@malevo/model`) is the world-folder format. It holds the schemas, the
  canonical JSON writer, the loader, references, the dependency graph and the checks. Its pure entry
  is safe for the renderer. File access lives in `@malevo/model/node`, which is the only code that
  reads or writes a world folder. `packages/model/template/` holds the files every new world
  starts with.
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
