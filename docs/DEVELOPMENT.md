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
| `npm run lint` | ESLint. In `packages/core`, `model` and `gen` it bans `Math.random` and wall-clock time, so world data stays reproducible (PLAN §3.2) |
| `npm run format` | Prettier, writing changes |
| `npm test` | Vitest: `tests/` and `packages/*/tests/` |
| `npm run smoke` | Builds, then drives the real app with Playwright (PLAN Phase 0 behaviour). On Linux, wrap it in `xvfb-run -a` |

## Layout

- **`src/main`** is the Electron main process: the window, menu, IPC handlers, world session and
  updater.
- **`src/preload`** is the typed bridge, exposed as `window.malevo`. The renderer never touches
  the file system.
- **`src/renderer`** is the tool host: the welcome screen, sidebar and status bar. Tools live in
  `src/renderer/src/tools/<id>/` and are listed in `src/renderer/src/tools/index.ts`.
- **`src/shared`** holds the IPC channel names, the shared types, and pure policies such as when to
  install an update.
- **`packages/model`** is the world-folder format. Its pure entry, `@malevo/model`, is safe for the
  renderer; file access lives in `@malevo/model/node`. It is the only code that reads or writes a
  world folder.

### Adding a tool

1. Create `src/renderer/src/tools/<id>/<Name>Tool.tsx` exporting a `ToolDefinition`: `id`,
   `title`, `description` and `View`.
2. Add it to the list in `src/renderer/src/tools/index.ts`. The order there is the sidebar order.

Tool ids are saved in UI state, so a tool is never renamed once it has shipped.

## World folders

A world is a plain folder. In Phase 0 it holds a single file, `world.json`:

```json
{
  "format": 1,
  "name": "Scratch",
  "seed": 4200339985
}
```

- **Creating** a world needs a missing or empty folder. The app writes `world.json`, with a seed
  from the operating system's random source, and nothing else.
- **Opening** a world never writes to it.
- **Formats:** a `format` the app doesn't know, older or newer, is refused with a message, and the
  file is left untouched.
- **Unknown keys** in `world.json` are preserved.

App state (recent worlds, the last world opened, the auto-update setting) lives in the app's own
`settings.json` under Electron's userData folder: `%APPDATA%\Malevo Science` on Windows. App state
is never written into a world folder. The app has no git integration.

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
