# New-world template

Every new world starts with a copy of these files. They are data, not code: the app has no
built-in physics or calendars of its own (docs/PLAN.md, principle P0).

- `settings/physics.json` holds the starting values for the FTL foam, the torch drive, stopovers
  and the traffic balance tolerance. They are the numbers the prototype tools used. Change them in
  any world at any time; change them here to change what new worlds start with.
- `calendars/gregorian.json` is the only calendar a new world starts with (decision D3).

`malevo template <world>` copies any of these files that a world is missing, without touching
the ones it has.
