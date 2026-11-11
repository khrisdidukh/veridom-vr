# Veridom · Before you build

A WebXR app for Meta Quest that lets a future home owner check their house plan before construction starts, and see what a change would cost at each stage of the build.

**Live:** https://khrisdidukh.github.io/veridom-vr/ (open it in the Meta Quest browser)

## What you can do

- **See the house on your table.** The plan becomes a 1:25 model in front of you. Works seated.
- **Scrub the construction timeline.** Plot → slab → walls → pipes & cables → plaster → finishes. Each stage grows in place.
- **Walk in at full size.** Jump between rooms, or pinch the floor to move. Turn in 45° steps, so no stick or joystick is needed.
- **Stand in it on your plot.** "On site" puts the house on the real ground at full size in mixed reality. You peg one corner and one wall direction with two pinches, and then you simply walk: through the front door, down the hall, into the bathroom. The house stays where you put it. Doors, furniture, the timeline and the light can all be changed while you stand inside.
- **Fade the walls.** One slider takes the walls from solid to hidden, in every mode. On site they start at 35 %, so a real obstacle is never hidden behind a virtual wall.
- **Open the walls.** Pinch a wall, the floor or the ceiling and a sample slides apart into its real build-up at true thickness: plaster, clay block, 16 cm of insulation, render; parquet, heated screed with its pipe loop, insulation, membrane, slab. The wall turns glassy while it is open, so the pipes and cables inside show where they really run. Pinch again to close.
- **Read the footnotes.** Pinch a layer, a pipe, a door or an orange problem marker and a short note appears in the air with a line to the exact spot: what it is, its size or U-value, why it matters, a guide price, and whether that stage is already built or still free to change. Small "i" dots mark the things worth tapping.
- **Measure.** Pinch two points; the tape shows the distance in metres.
- **Take the tour.** "▶ Tour" drives the app through its main ideas in one minute, with a caption per step.
- **X-ray the walls.** See where pipes and cables run before you drill.
- **Change things and see the impact.** Move a door, flip its swing, raise a socket, change the worktop height. The app says whether the change is free on paper, small rework, or major rework at the current stage, and lists what would have to be redone.
- **Catch plan problems.** Automatic checks flag a door that hits the toilet and a light switch hidden behind a door. Both are planted in the demo house.
- **See the light as it will be.** Pick the hour, the month and the weather — sun, clouds, grey sky, fog or snow, the weather the Waldviertel actually gets. The sun follows its real path over the plot in Franzen, so you see where it falls into each room in June and in December.
- **Furnish it.** Add a sofa, bed, wardrobe, dining table and more, then pinch and drag them across the floor. If a piece is in the way of a door, the door and the piece light up in orange.
- **Send the changes.** "Copy all" gives a plain-text change request for the architect.

Hands only: everything is done by pinching. Controllers also work.

## On site: the house on your plot

Take the Quest 3 to the plot, open the page in the Meta Quest browser and choose **Enter mixed reality**, then **On site** on the panel.

1. **Corner.** Point at the ground where the south-west corner of the house will stand and pinch. Or stand on the corner peg and pinch **Corner at my feet**.
2. **Wall.** Point at the ground further along the south wall and pinch. Or look along the wall and pinch **Wall runs where I look**. A cyan outline of the footprint follows your hand in both steps.
3. **Fine-tune.** Slide the house left, right, away or closer in 10 cm steps (2 cm with **Fine steps**), turn it by 5° or 1°, raise or lower it. **Looks right** fixes it.
4. **Walk.** The panel follows you at chest height and names the room you are standing in, the way you face and where the sun is. **Re-align** starts over; **Adjust** reopens the fine-tuning.

What the headset adds when it can, and what happens when it can't:

| WebXR feature | Used for | Without it |
| --- | --- | --- |
| `hit-test` | the pinch lands on the real ground | the floor plane of the tracking space |
| `anchors` | the house stays put while tracking refines | the placement is held in the tracking space |
| persistent anchor handle | the house is back in place on the next visit | the last placement is restored from localStorage |
| `unbounded` space | large plots | `local-floor` (`?local=1` forces it) |

Safety on site: use it in daylight, keep the Quest boundary on, walk slowly and keep the walls see-through. The headset shows the plan, not what is lying on the ground.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (stages, checks, impact, edits, on-site alignment, wall opacity, build-ups, footnotes, tape, tour)
npm run build
```

On a computer, add `?emulate=1` to the URL to try the headset flow in a Meta Quest 3 emulator ([IWER](https://github.com/meta-quest/immersive-web-emulator)). `?lite=1` turns off shadows for slower headsets.

## How it is built

- three.js + WebXR, TypeScript, Vite. No backend.
- `src/house/` — the house model (walls, openings, sockets, fixtures, rooms, pipes) and the 3D builder.
- `src/edit/` — construction stages, plan checks, change impact rules, edits.
- `src/env/` — sun position (NOAA approximation for the plot's coordinates), sky, clouds, fog, snow and night lamps.
- `src/site/` — on-site placement: two-point alignment maths, room under your feet, saved placement (`align.ts`), and the optional WebXR pieces (`xr.ts`).
- `src/info/` — build-up catalogue with U-values (`catalog.ts`), footnote texts (`notes.ts`), which wall was pointed at (`locate.ts`), the sliding layer sample (`cutaway.ts`), the tape (`measure.ts`).
- `src/tour.ts` — the one-minute guided tour as data.
- `src/ui/label.ts` — labels and callouts with leader lines.
- `src/furnish/` — furniture catalogue, pieces built in code, and CC0 3D models.
- `src/ui/panel.ts` — the hand-operated panel, drawn to a canvas and shown both in the headset and on desktop.

Textures and 3D models: [Poly Haven](https://polyhaven.com), CC0. Static meshes are merged by material to keep draw calls low on Quest; shadows are redrawn only when something changes.

The picture is kept honest and cheap: real textures, a warm daylight balance that brightens under a ceiling, window glass that mirrors the sky, and ambient occlusion that is drawn rather than computed (soft bands where walls meet floor and ceiling, a soft contact shadow under each piece of furniture). In mixed reality the house is lit by the headset's own light estimate where the browser offers one (`light-estimation`), and by the computed sun otherwise.

The impact rules are deliberately simple and give no prices: they say what kind of work a change causes at each stage, not what it costs in euros. The layer footnotes carry guide prices per m² — rough ranges for comparing layers, set in `src/info/catalog.ts`, to be replaced with the builder's own figures. U-values are computed from the layer thicknesses and conductivities in the same file.

## License

MIT
