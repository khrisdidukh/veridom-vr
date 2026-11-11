import { footprint } from "../site/align";
import { wallFrame, type House, type Vec2, type Wall } from "../house/model";

// Which wall did the owner point at, and which way is "outside"?

export type WallSpot = {
  wall: Wall;
  /** Metres from the wall's start to the foot of the point on its centre line. */
  along: number;
  /** Point on the centre line, in plan metres. */
  at: Vec2;
  /** Distance from the point to the centre line. */
  dist: number;
};

/** The wall whose centre line is nearest to plan point p. */
export function nearestWall(h: House, p: Vec2, filter: (w: Wall) => boolean = () => true): WallSpot | null {
  let best: WallSpot | null = null;
  for (const wall of h.walls.filter(filter)) {
    const { len, dir } = wallFrame(wall);
    const along = Math.max(0, Math.min(len, (p.x - wall.a.x) * dir.x + (p.z - wall.a.z) * dir.z));
    const at = { x: wall.a.x + dir.x * along, z: wall.a.z + dir.z * along };
    const dist = Math.hypot(p.x - at.x, p.z - at.z);
    if (!best || dist < best.dist) best = { wall, along, at, dist };
  }
  return best;
}

/** The wall a pointed-at surface point belongs to: it must lie within the wall's thickness. */
export function wallAt(h: House, p: Vec2, slack = 0.06): WallSpot | null {
  const spot = nearestWall(h, p, (w) => {
    const { len, dir, left } = wallFrame(w);
    const along = (p.x - w.a.x) * dir.x + (p.z - w.a.z) * dir.z;
    const across = Math.abs((p.x - w.a.x) * left.x + (p.z - w.a.z) * left.z);
    return along >= -slack && along <= len + slack && across <= w.thickness / 2 + slack;
  });
  return spot;
}

/**
 * Unit normal of the wall in plan. For an exterior wall it points outdoors;
 * for a partition it points to the wall's left.
 */
export function outward(h: House, w: Wall): Vec2 {
  const { left } = wallFrame(w);
  if (!w.exterior) return left;
  const f = footprint(h);
  const c = { x: (f.min.x + f.max.x) / 2, z: (f.min.z + f.max.z) / 2 };
  const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
  const out = (mid.x - c.x) * left.x + (mid.z - c.z) * left.z >= 0 ? 1 : -1;
  return { x: left.x * out, z: left.z * out };
}

/** Keeps a 2·half wide sample clear of the wall's ends and of doors and windows where it can. */
export function clearStretch(h: House, w: Wall, along: number, half: number): number {
  const { len } = wallFrame(w);
  const clamp = (v: number) => Math.max(Math.min(half, len / 2), Math.min(len - Math.min(half, len / 2), v));
  let a = clamp(along);
  const hits = (v: number) => h.openings.some((o) => o.wallId === w.id && v + half > o.offset && v - half < o.offset + o.width);
  if (!hits(a)) return a;
  // Slide to the nearest free stretch on either side.
  for (let d = 0.1; d < len; d += 0.1) {
    for (const v of [a - d, a + d]) if (v === clamp(v) && !hits(v)) return v;
  }
  return a;
}
