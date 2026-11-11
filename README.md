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
- **See the daylight in every room.** "Daylight" shows the hours of direct sun per room for every month of the year as a heat map, and a footnote in each room: which way its windows look, how many hours of sun it gets now, in June and in December.
- **Compare before and after.** "Original" flips the scene between the plan as it came and your version. What you changed — doors, fittings, furniture — is violet in both.
- **Use your palm.** Turn the left hand palm up and a small panel sits over it: modes, the wall slider, undo, before/after, X-ray.
- **Bring your own plan.** Open a JSON file (or, experimentally, an IFC file) and walk through your own house instead of the demo.
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
4. **North.** In the fine-tuning card, look north and pinch **North is where I look** — or, on a sunny day, look along your own shadow and pinch **My shadow points there** (the time of day and the plot's coordinates give the bearing). From then on the sun, the facing direction, the light card and the daylight chart use real north. Until then the panel says north is not set.
5. **Second corner (optional).** **+ South-east corner**: peg the other end of the south wall. The house is set between both pegs, and the panel tells you how far apart they really are compared with the plan.
6. **Walk.** The panel follows you at chest height and names the room you are standing in, the way you face and where the sun is. **Re-align** starts over; **Adjust** reopens the fine-tuning.

What the headset adds when it can, and what happens when it can't:

| WebXR feature | Used for | Without it |
| --- | --- | --- |
| `hit-test` | the pinch lands on the real ground | the floor plane of the tracking space |
| `anchors` | the house stays put while tracking refines | the placement is held in the tracking space |
| persistent anchor handle | the house is back in place on the next visit | the last placement is restored from localStorage |
| `unbounded` space | large plots | `local-floor` (`?local=1` forces it) |
| absolute device orientation (compass) | north is set by itself when you confirm | "North is where I look" / "My shadow points there" |

Safety on site: use it in daylight, keep the Quest boundary on, walk slowly and keep the walls see-through. The headset shows the plan, not what is lying on the ground.

## Bring your own plan

On the start page choose **Open your own plan** and pick a `.json` file, or add `?plan=<address of the file>` to the page address (the file must be on the same site or on a server that allows cross-origin requests). Try it with the sample: [`?plan=plans/sample-house.json`](https://khrisdidukh.github.io/veridom-vr/?plan=plans/sample-house.json). The plan is remembered in the browser until you choose **demo house** (or open `?plan=demo`). Do this before entering the headset session.

The format, version 1 — see [`public/plans/sample-house.json`](public/plans/sample-house.json) for a complete file:

```jsonc
{
  "format": "veridom-plan", "version": 1,
  "name": "Our house",
  "units": "m",                       // "m", "cm" or "mm" — applies to every length below
  "site": { "name": "Franzen", "lat": 48.57, "lon": 15.33, "northOffsetDeg": 0 },
  "levels": [{
    "id": "eg", "name": "Ground floor", "height": 2.6,
    "walls":    [{ "id": "south", "from": [0, 0], "to": [9, 0], "thickness": 0.38, "exterior": true }],
    "openings": [{ "id": "d1", "type": "door", "name": "Front door", "wall": "south",
                   "offset": 1.2, "width": 1.0, "height": 2.1, "sill": 0, "hinge": "start", "swing": "left" }],
    "rooms":    [{ "id": "living", "name": "Living room", "min": [0, 0], "max": [5, 4], "floor": "wood", "wet": false }]
  }]
}
```

| Field | Meaning |
| --- | --- |
| coordinates | `[x, z]`: x runs east, z runs north (as drawn; `site.northOffsetDeg` says how far real north lies clockwise of the plan's north). The plan may sit anywhere; it is moved to the origin. |
| `walls[]` | `id`, `from`, `to` (centre line), `thickness` (default 0.38 outer / 0.12 inner), `exterior`. If no wall has `exterior`, the walls on the edge of the plan are taken as outer walls. |
| `openings[]` | `type` `door` or `window`, `wall` (a wall id), `offset` from the wall's `from` end to the opening's near edge, `width`, `height` (default 2.1 / 1.4), `sill` (default 0 / 0.9). Doors: `hinge` `start` or `end`, `swing` `left` or `right` of the wall's direction. Glazed doors are windows with `sill` 0. |
| `rooms[]` | `min` and `max` corners of a rectangle, or a `polygon` (replaced by the rectangle around it); `floor` `wood` or `tiles`; `wet`. Without rooms the whole floor is one room. |
| optional | `points[]` (sockets, switches: `type`, `wall`, `offset`, `height`, `side`, `room`), `fixtures[]` (`type` wc, sink, shower, counter; `min`, `max`), `furniture[]` (`item` from the catalogue, `at`, `rot`), `pipes[]` (`type` cold, hot, drain; `points` as `[x, height, z]`), `board` (`wall`, `offset`). |
| `levels[]` | One level is shown at a time: the first, or the one named by `&level=<id>`. A file with `walls` at the top level is read as a single level. |

A file with mistakes is not loaded; the page lists what is wrong and where, for example `levels[0].openings[6] ("Kitchen window"): is 1.40 m wide at offset 8.50 m, but wall "south" is only 9.00 m long`. The demo house stays until the file is right.

**IFC (experimental).** An `.ifc` file (IFC2x3 or IFC4, STEP text) can be opened the same way. The reader takes straight walls (from their axis line or an extruded rectangular or polyline profile), doors and windows (from their placement and overall size), storeys, length units and `Pset_WallCommon.IsExternal`. It does not read rooms, slabs, roofs, stairs, curved or sloped walls; the floor becomes one room. It has been tested on a hand-written file only — check door and window positions after loading, and prefer JSON when you can.

Limits for any imported plan: rooms are rectangles, one storey at a time, the slab and ceiling are the rectangle around the outer walls, the layer build-ups are the standard ones from `src/info/catalog.ts`, and the guided tour is for the demo house only.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (stages, checks, impact, edits, on-site alignment, north, wall opacity, build-ups, footnotes, tape, tour, daylight, before/after, palm gate, plan import, IFC)
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
- `src/info/daylight.ts` — hours of direct sun per room and month.
- `src/edit/diff.ts` — what differs between the plan as it came and the owner's version.
- `src/plan/` — plan import: the JSON format with its checks (`import.ts`) and the IFC subset (`ifc.ts`).
- `src/ui/wrist.ts`, `src/ui/palm.ts` — the palm panel and the palm-up gate.
- `src/site/compass.ts` — device compass, where there is one.
- `src/tour.ts` — the one-minute guided tour as data.
- `src/ui/label.ts` — labels and callouts with leader lines.
- `src/furnish/` — furniture catalogue, pieces built in code, and CC0 3D models.
- `src/ui/panel.ts` — the hand-operated panel, drawn to a canvas and shown both in the headset and on desktop.

Textures and 3D models: [Poly Haven](https://polyhaven.com), CC0. Static meshes are merged by material to keep draw calls low on Quest; shadows are redrawn only when something changes.

The picture is kept honest and cheap: real textures, a warm daylight balance that brightens under a ceiling, window glass that mirrors the sky, and ambient occlusion that is drawn rather than computed (soft bands where walls meet floor and ceiling, a soft contact shadow under each piece of furniture). In mixed reality the house is lit by the headset's own light estimate where the browser offers one (`light-estimation`), and by the computed sun otherwise.

The impact rules are deliberately simple and give no prices: they say what kind of work a change causes at each stage, not what it costs in euros. The layer footnotes carry approximate prices per m² (shown as "Approx. price: ≈ … — confirm with your builder") — rough ranges for comparing layers, set in `src/info/catalog.ts`, to be replaced with the builder's own figures. U-values are computed from the layer thicknesses and conductivities in the same file.

## License

MIT
