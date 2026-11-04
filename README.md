# Malevo Science

A desktop app (Electron, with auto-update) for building, checking and visualizing the setting of
a hard science fiction series. It covers star systems, planets, FTL routes and ship traffic,
timelines and calendars, cultures, colonization history, planet terrain, populations and
cities. Every tool works from one shared model, so details stay consistent from story to story.

The app contains no setting. It reads and writes world folders. Which world, and which commit of
it, is canon is the author's call, and that data lives in a separate repository.

There is no code yet. Start with the plan: **[docs/PLAN.md](docs/PLAN.md)**.

The plan covers:

- **The principles** the app is built around:
  - The app is a workbench. Anything can be moved or re-rolled, and nothing in it is canon.
  - World data is diff-friendly text in git. Procedural generation is keyed, versioned and
    lockable, so changing one thing never quietly rebuilds the galaxy.
  - All tools share one library, so they all show the same thing.
- **Architecture:** `@malevo/core`, `model`, `gen`, `viz`, a CLI, and the Electron shell.
- **Time and calendars:** a single reference clock, with Gregorian, Galactic (360 × 30 × 24),
  era, planet-local and ship-clock calendars.
- **Directed, asymmetric route traffic.** Each node is checked for balance, and a helper suggests
  fixes.
- **The tools** and which story-thing tools each one replaces.
- **The phases,** in order. Phase 0 is the shell and auto-update; Phase 1 is the core library and
  the stability contract.
- **Open decisions,** each with a recommendation.
