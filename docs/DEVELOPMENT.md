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
- **`src/renderer`** is the tool host: the welcome screen, sidebar and status bar. Tools live in
  `src/renderer/src/tools/<id>/` and are listed in `src/renderer/src/tools/index.ts`.
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
