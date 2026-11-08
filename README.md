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
- **Send the changes.** "Copy all" gives a plain-text change request for the architect.

Hands only: everything is done by pinching. Controllers also work.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (stages, checks, impact, edits)
npm run build
```

On a computer, add `?emulate=1` to the URL to try the headset flow in a Meta Quest 3 emulator ([IWER](https://github.com/meta-quest/immersive-web-emulator)).

## How it is built

- three.js + WebXR, TypeScript, Vite. No backend.
- `src/house/` — the house model (walls, openings, sockets, fixtures, rooms, pipes) and the 3D builder.
- `src/edit/` — construction stages, plan checks, change impact rules, edits.
- `src/ui/panel.ts` — the hand-operated panel, drawn to a canvas and shown both in the headset and on desktop.

The impact rules are deliberately simple and give no prices: they say what kind of work a change causes at each stage, not what it costs in euros.

## License

MIT
