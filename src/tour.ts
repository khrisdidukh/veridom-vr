// A one-minute guided tour: the app drives itself through its main ideas,
// with one short caption per step. Made for the demo video and for a first
// look; pinch "Tour" again to stop it at any point.

export type TourAction =
  | { do: "mode"; mode: "model" | "walk"; room?: string; at?: [number, number, number] }
  | { do: "timeline"; from: number; to: number; seconds: number }
  | { do: "select"; type: "door"; id: string }
  | { do: "edit"; kind: "flip-swing" }
  | { do: "undo" }
  | { do: "cutaway"; assembly: "ext-wall" | "floor" }
  | { do: "layer"; assembly: "ext-wall" | "floor"; layer: string }
  | { do: "close" }
  | { do: "xray"; on: boolean }
  | { do: "light"; from: number; to: number; seconds: number }
  | { do: "end" };

export type TourStep = { at: number; caption: string; actions: TourAction[] };

/** `at` is seconds from the start. View triples are plan x, plan z and compass heading in degrees. */
export const TOUR: TourStep[] = [
  { at: 0, caption: "This is your house, before a single brick is laid.", actions: [{ do: "close" }, { do: "xray", on: false }, { do: "mode", mode: "model" }, { do: "timeline", from: 0, to: 5, seconds: 9 }] },
  { at: 10, caption: "The plan is checked for you. Two problems are marked in orange.", actions: [] },
  { at: 15, caption: "Walk in at full size. The bathroom door hits the toilet.", actions: [{ do: "mode", mode: "walk", room: "bath", at: [9.3, 6.0, -51] }, { do: "select", type: "door", id: "d-bath" }] },
  { at: 22, caption: "Flip the swing. Now it is a small rework — on paper it would have been free.", actions: [{ do: "edit", kind: "flip-swing" }] },
  { at: 29, caption: "Pinch a wall and see what it is made of, layer by layer.", actions: [{ do: "mode", mode: "walk", room: "living", at: [3.9, 1.9, 200] }, { do: "cutaway", assembly: "ext-wall" }] },
  { at: 35, caption: "Every layer has a footnote: what it does, what it costs, when it is built.", actions: [{ do: "layer", assembly: "ext-wall", layer: "eps" }] },
  { at: 41, caption: "X-ray shows the pipes and cables before you drill.", actions: [{ do: "close" }, { do: "timeline", from: 5, to: 3, seconds: 1 }, { do: "xray", on: true }] },
  { at: 47, caption: "The real sun over your plot, from morning to evening.", actions: [{ do: "xray", on: false }, { do: "timeline", from: 3, to: 5, seconds: 1 }, { do: "mode", mode: "walk", room: "living", at: [5.6, 4.4, 235] }, { do: "light", from: 7, to: 19, seconds: 8 }] },
  { at: 56, caption: "On your plot, “On site” stands the house around you at full size.", actions: [{ do: "undo" }, { do: "mode", mode: "model" }] },
  { at: 62, caption: "", actions: [{ do: "end" }] },
];

export const TOUR_SECONDS = TOUR[TOUR.length - 1]!.at;

/** The step that is showing at time t (seconds), or -1 before the start. */
export function stepAt(t: number): number {
  let i = -1;
  for (let k = 0; k < TOUR.length; k++) if (t >= TOUR[k]!.at) i = k;
  return i;
}

/** Value of a ramp that started `elapsed` seconds ago. */
export function ramp(from: number, to: number, seconds: number, elapsed: number): number {
  const f = seconds <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / seconds));
  return from + (to - from) * f;
}
