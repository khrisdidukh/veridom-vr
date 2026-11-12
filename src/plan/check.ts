import type { House, Room } from "../house/model";

// "Check the plan": does each room's size on the plan match the size written
// on the drawing? A plan traced from a photo or PDF is only as good as this.

export type AreaRow = { id: string; name: string; computed: number; stated: number | null; diffPct: number | null; ok: boolean };
export const AREA_TOLERANCE = 5; // per cent

/** Floor area inside the walls: the room's rectangle less half the thickness of each wall that runs along one of its edges. */
export function netArea(h: House, r: Room): number {
  const eps = 0.06;
  const along = (fixed: "x" | "z", at: number, from: number, to: number): number => {
    let t = 0;
    for (const w of h.walls) {
      const on = Math.abs(w.a[fixed] - at) < eps && Math.abs(w.b[fixed] - at) < eps;
      const other = fixed === "x" ? "z" : "x";
      const lo = Math.min(w.a[other], w.b[other]), hi = Math.max(w.a[other], w.b[other]);
      // The wall must run along most of this edge.
      if (on && Math.min(hi, to) - Math.max(lo, from) > (to - from) * 0.5) t = Math.max(t, w.thickness / 2);
    }
    return t;
  };
  const w = r.max.x - r.min.x - along("x", r.min.x, r.min.z, r.max.z) - along("x", r.max.x, r.min.z, r.max.z);
  const d = r.max.z - r.min.z - along("z", r.min.z, r.min.x, r.max.x) - along("z", r.max.z, r.min.x, r.max.x);
  return Math.max(0, w) * Math.max(0, d);
}

export function checkAreas(h: House): AreaRow[] {
  return h.rooms.map((r) => {
    const computed = netArea(h, r);
    const stated = typeof r.statedArea === "number" ? r.statedArea : null;
    const diffPct = stated ? ((computed - stated) / stated) * 100 : null;
    return { id: r.id, name: r.name, computed, stated, diffPct, ok: diffPct === null || Math.abs(diffPct) <= AREA_TOLERANCE };
  });
}

/** "Kitchen: 16.0 m² on the plan, 18.0 m² stated (−11 %)" for each room that is more than 5 % off. */
export function areaWarnings(h: House): string[] {
  return checkAreas(h)
    .filter((r) => !r.ok)
    .map((r) => `${r.name}: ${r.computed.toFixed(1)} m² as drawn, ${r.stated!.toFixed(1)} m² stated (${r.diffPct! > 0 ? "+" : "−"}${Math.abs(r.diffPct!).toFixed(0)} %) — check its walls.`);
}
