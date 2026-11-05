# Star catalogue

`hyg-stars.json` holds the real stars the app shows and builds systems on.

- **Source:** the HYG database v4.1 by David Nash (astronexus), https://codeberg.org/astronexus/hyg.
- **Licence:** CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). This file is a
  derived work under the same licence. That licence covers this data file only, not the app's
  code.
- **What it keeps:** every catalogue star with a known distance within 1,000 light-years, plus
  every naked-eye star (apparent magnitude below 6.5) at any distance.
- **Positions** are in galactic light-years with the Sun at the origin: x toward the galactic
  centre, y toward galactic rotation, z toward the north galactic pole.
- **Fields per star:** `[x, y, z, absmag, mag, spect, ci, name, hip, hyg]`. `absmag` and `mag` are
  visual magnitudes, `ci` is the B−V colour index, and `hip` and `hyg` are catalogue numbers.
- **Built by** `tools/star-map/build-stars.py` in the story-thing repository, from
  `hygdata_v41.csv`.

The app identifies a catalogue star as `hip.<n>`, or `hyg.<n>` when it has no Hipparcos number
(Sol is `hyg.0`). These ids appear in world files, so they must never change. If the catalogue is
ever rebuilt, it has to keep every id it had.
