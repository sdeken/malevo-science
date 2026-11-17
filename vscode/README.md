# Malevo Science for VS Code

Open a Malevo Science world folder (the folder with `world.json`) in VS Code. Its systems
(`systems/*.json`) and bodies (`bodies/*.json`) open in editors of their own, with the physics
worked out; "Reopen with… Text editor" shows the file itself.

- **A system:** where it is (detached, on a stand-in star, or placed), its star, its bodies on
  the orbit view, planets rolled from its star, and what follows. Click a body to open it in its
  own tab.
- **A body:** what it is, its orbit, mass, size, spin and air, and what follows: year, day,
  sunlight, temperature, gravity, daylight by latitude.
- **The current date:** the bar at the top of every editor, and the status bar (click it to set
  it). Every editor of the world follows it.
- **Commands:** *Malevo: New system…*, *Malevo: Set the current date…*.

Edits are VS Code edits: unsaved until you save, undone with Ctrl+Z, shown in the git diff. The
extension never touches git.
