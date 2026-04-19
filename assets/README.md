# Aircraft GLB Assets

Drop real-world aircraft models here to automatically replace the
procedural ones at runtime. Expected filenames:

- `eurofighter.glb` — Eurofighter Typhoon
- `mig31.glb` — MiG-31 Foxhound
- `mig25.glb` — MiG-25 Foxbat

Requirements:
- Format: glTF 2.0 binary (`.glb`)
- Orientation: nose along +Z, up along +Y (Three.js default)
- Reasonable real-world scale in meters (wingspan 10–15 m)

If any file is missing, the simulator falls back to the built-in
procedural mesh for that jet. You can tweak scale per-jet in
`src/aircraft.js` via the `GLB_SCALE` constant.
