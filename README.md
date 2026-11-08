# Veridom · Before you build

A WebXR app for Meta Quest that lets a future home owner check their house plan before construction starts, and see what a change would cost at each stage of the build.

**Live:** https://khrisdidukh.github.io/veridom-vr/ (open it in the Meta Quest browser)

## What you can do

- **See the house on your table.** The plan becomes a 1:25 model in front of you. Works seated.
- **Scrub the construction timeline.** Plot → slab → walls → pipes & cables → plaster → finishes. Each stage grows in place.
- **Walk in at full size.** Jump between rooms, or pinch the floor to move. Turn in 45° steps, so no stick or joystick is needed.
- **X-ray the walls.** See where pipes and cables run before you drill.
- **Change things and see the impact.** Move a door, flip its swing, raise a socket, change the worktop height. The app says whether the change is free on paper, small rework, or major rework at the current stage, and lists what would have to be redone.
- **Catch plan problems.** Automatic checks flag a door that hits the toilet and a light switch hidden behind a door. Both are planted in the demo house.
- **See the light as it will be.** Pick the hour, the month and the weather — sun, clouds, grey sky, fog or snow, the weather the Waldviertel actually gets. The sun follows its real path over the plot in Franzen, so you see where it falls into each room in June and in December.
- **Furnish it.** Add a sofa, bed, wardrobe, dining table and more, then pinch and drag them across the floor. If a piece is in the way of a door, the door and the piece light up in orange.
- **Send the changes.** "Copy all" gives a plain-text change request for the architect.

Hands only: everything is done by pinching. Controllers also work.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (stages, checks, impact, edits)
npm run build
```

On a computer, add `?emulate=1` to the URL to try the headset flow in a Meta Quest 3 emulator ([IWER](https://github.com/meta-quest/immersive-web-emulator)). `?lite=1` turns off shadows for slower headsets.

## How it is built

- three.js + WebXR, TypeScript, Vite. No backend.
- `src/house/` — the house model (walls, openings, sockets, fixtures, rooms, pipes) and the 3D builder.
- `src/edit/` — construction stages, plan checks, change impact rules, edits.
- `src/env/` — sun position (NOAA approximation for the plot's coordinates), sky, clouds, fog, snow and night lamps.
- `src/furnish/` — furniture catalogue, pieces built in code, and CC0 3D models.
- `src/ui/panel.ts` — the hand-operated panel, drawn to a canvas and shown both in the headset and on desktop.

Textures and 3D models: [Poly Haven](https://polyhaven.com), CC0. Static meshes are merged by material to keep draw calls low on Quest; shadows are redrawn only when something changes.

The impact rules are deliberately simple and give no prices: they say what kind of work a change causes at each stage, not what it costs in euros.

## License

MIT
