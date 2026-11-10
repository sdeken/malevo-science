# Malevo Science

A Windows desktop app (Electron, with auto-update) for building, checking and visualizing the
setting of a hard science fiction series. It covers star systems, planets, FTL routes and ship
traffic, timelines and calendars, cultures, colonization history, planet terrain, populations and
cities. Every tool works from one shared model, so details stay consistent from story to story.

The app contains no setting and knows nothing about git. It reads and writes plain world folders
of JSON and Markdown. The author decides what is canon and commits it by hand to a repository of their own.

The Encyclopedia holds the canon in the author's own words: an article for anything the world
tracks, and pages of their own for people, organizations and places, linked with `@`. The app
writes only what the author types, and keeps links working when pages move.

**Status:** Phases 0–10 are built, and a trip planner. Phase 10 added the city planner: districts, streets, rail
and landmarks drawn on a plan and generated into buildings, timetabled services, door-to-door
travel times (including to orbit), the port's capacity against the route network, and a 3D view
lit by the sun at any hour. Giant planets got cloud bands. Phase 9 added the population planner: cities on any body with
their people over time, and the conditions there at any date (local time, season, daylight,
tide, who holds it, ships in port) with the sky overhead. Phase 8 added planet terrain: plates, mountains and seas
generated on the sphere, rolled and locked, shaped by hand as latitude/longitude text, and
coloured by each world's own climate. Every new world also shows the real Solar System, built into the app: it gets files only where the author changes it.
Phase 7 added the history generator. It plays settlement out
on the stars, gated by the timeline's technology events, and proposes systems, cultures, routes
and events for the author to accept. It also shows when news of an event reached each system.
Phase 6 added the sky view: stars, sun, moons and planets
from any point on any body at any date, through the body's air, with the torches the route
network implies. It also added the approach planner, which shows where ships drop out of the foam
and how a giant planet's lee shortens the crawl. Phase 5 added galactic routes: legs under the leg limit and
around nebulae, a route planner over the star atlas, stations, one-way services with their trip
times and fleets, and each node's traffic balance with a helper that proposes return traffic.
Phase 4 added cultures with world-defined traits, polities,
affinities that change at timeline events, and each system's history of control and population.
Phase 3 added the star atlas (the real HYG stars plus
generated faint ones, in 3D), star systems built on them with planets you can roll and keep, and
the derived physics of every body. Phase 2 added the timeline editor, calendars of every kind
(including JavaScript script calendars run in a sandbox), the current date, saving with undo, and
fork and compare. Phases 0 and 1 provided:
- the app shell, Windows packaging and auto-update;
- world folders;
- the shared physics and calendar library (`@malevo/core`);
- the world file format and its checks (`@malevo/model`);
- versioned generators with golden fixtures;
- the `malevo check` command.

To build, check and release it, see **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

To understand where it's going, read the plan: **[docs/PLAN.md](docs/PLAN.md)**.

The plan covers:

- **The principles** the app is built around:
  - The app is a workbench. Anything can be moved or re-rolled, and nothing in it is canon.
  - World data is diff-friendly text. Procedural generation is keyed, versioned and lockable, so
    changing one thing never quietly rebuilds the galaxy. The app writes only the files the author
    changed.
  - All tools share one library, so they all show the same thing.
- **Architecture:** `@malevo/core`, `model`, `gen`, `viz`, a CLI, and the Electron shell.
- **Time and calendars:** one universal time, the same everywhere. Calendars are Gregorian,
  regular fixed calendars, planet-local, era counts, offsets, or JavaScript scripts for culture
  calendars.
- **Directed, asymmetric route traffic.** Each node is checked for balance, and sinks such as a
  ship graveyard (or sources such as a shipyard) can be declared.
- **The tools,** and which prototype tools each one ports code from.
- **The phases,** in order. Phase 0 is the shell and auto-update; Phase 1 is the core library and
  the stability contract.
- **Decisions D1–D9,** all settled.
