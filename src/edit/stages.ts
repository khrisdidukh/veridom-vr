// Construction stages on the timeline, in build order. The timeline value is
// continuous: 2.4 means the walls stand and the rough-in is 40 % visible.

export const STAGES = [
  { id: "plot", name: "Plot", short: "Plot" },
  { id: "slab", name: "Foundation slab", short: "Slab" },
  { id: "shell", name: "Walls & ceiling", short: "Walls" },
  { id: "roughin", name: "Pipes & cables", short: "Rough-in" },
  { id: "plaster", name: "Plaster & drywall", short: "Plaster" },
  { id: "finish", name: "Finishes", short: "Finish" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const MAX_STAGE = STAGES.length - 1;

/** Index of the last stage that is complete at timeline value `t`. */
export function stageAt(t: number): number {
  return Math.max(0, Math.min(MAX_STAGE, Math.floor(t + 1e-9)));
}

/** How far a stage is built at timeline value `t`: 0 = not started, 1 = done. */
export function stageProgress(t: number, stageIndex: number): number {
  return Math.max(0, Math.min(1, t - stageIndex + 1));
}
