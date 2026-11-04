# Malevo Science

A desktop app (Electron, with auto-update) for planning, checking and visualizing the setting
of the story-thing hard science fiction series. It covers star systems, planets, FTL routes and
ship traffic, timelines and calendars, cultures, colonization history, planet terrain,
populations and cities. Every tool works from one shared model, so details stay consistent
from story to story.

There is no code yet. Start with the plan: **[docs/PLAN.md](docs/PLAN.md)**.

The plan covers:

- **The two guarantees** the app is built around:
  - World data is diff-friendly text in git. Procedural generation is keyed, versioned and
    lockable, so changing one thing never quietly rebuilds the galaxy.
  - All tools share one library, so they all show the same thing.
- **Architecture:** `@malevo/core`, `model`, `gen`, `viz`, a CLI, and the Electron shell.
- **Time and calendars:** a single reference clock, with Gregorian, Galactic (360 × 30 × 24),
  era, planet-local and ship-clock calendars.
- **Route traffic built from closed circuits,** so ships in and ships out balance by
  construction.
- **The tools** and which story-thing tools each one replaces.
- **The phases,** in order. Phase 0 is the shell and auto-update; Phase 1 is the core library and
  the stability contract.
- **Open decisions,** each with a recommendation.
