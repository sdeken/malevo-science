# New-world template

Every new world starts with a copy of these files. They are data, not code: the app has no
built-in physics or calendars of its own (docs/PLAN.md, principle P0).

- `settings/physics.json` holds the starting values for the FTL foam, the torch drive, stopovers
  and the traffic balance tolerance. They are the numbers the prototype tools used. Change them in
  any world at any time; change them here to change what new worlds start with.
- `settings/stars.json` sets how the faint stars the catalogue cannot see are generated: their
  density, how the disk thins away from the plane, the cell size each seed covers, and how far out
  to fill them in. Without a `seed`, the world's seed is used. Changing any of these changes, or
  removes, generated stars that systems may already sit on, and the checks will say so. These are
  the prototype star map's values.
- `settings/cultures.json` lists the traits that describe cultures and how affinity is worked out
  from them. Openness, trade and expansion are a starting set: add, rename or reweight traits for
  the world.
- `calendars/gregorian.json` is the only calendar a new world starts with (decision D3).

`malevo template <world>` copies any of these files that a world is missing, without touching
the ones it has.
