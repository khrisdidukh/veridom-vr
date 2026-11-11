import type { House, Room, Vec2 } from "../house/model";

// On-site placement: where the house stands in the real world.
// World is the XR floor space in metres (three.js axes: x right, y up, z back).
// Plan (x east, z north) maps to house-local (x, 0, −z); the house is then
// turned by `yaw` around y and moved to (x, y, z).

export type Alignment = { x: number; y: number; z: number; yaw: number };
export type WorldPoint = { x: number; y: number; z: number };

/** Outer footprint of the house in plan metres, wall thickness included. */
export function footprint(h: House): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of h.walls.filter((x) => x.exterior)) {
    const t = w.thickness / 2;
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x - t);
      minZ = Math.min(minZ, p.z - t);
      maxX = Math.max(maxX, p.x + t);
      maxZ = Math.max(maxZ, p.z + t);
    }
  }
  return { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } };
}

/** The corner you peg first (south-west, outer face) and the wall you sight along (the south wall, towards east). */
export function referenceCorner(h: House): { corner: Vec2; dir: Vec2 } {
  return { corner: footprint(h).min, dir: { x: 1, z: 0 } };
}

const rot = (yaw: number, lx: number, lz: number) => ({
  x: lx * Math.cos(yaw) + lz * Math.sin(yaw),
  z: -lx * Math.sin(yaw) + lz * Math.cos(yaw),
});

/** Plan point → world point for a placed house. */
export function planToWorld(a: Alignment, p: Vec2, height = 0): WorldPoint {
  const r = rot(a.yaw, p.x, -p.z);
  return { x: a.x + r.x, y: a.y + height, z: a.z + r.z };
}

/** World point → plan point for a placed house. */
export function worldToPlan(a: Alignment, w: { x: number; z: number }): Vec2 {
  const r = rot(-a.yaw, w.x - a.x, w.z - a.z);
  return { x: r.x, z: -r.z };
}

/** Yaw that turns the plan direction `dir` to point from world p1 towards p2. */
export function yawBetween(p1: WorldPoint, p2: WorldPoint, dir: Vec2): number | null {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  if (Math.hypot(dx, dz) < 0.05) return null;
  // Local direction (dir.x, −dir.z) must land on (dx, dz).
  const want = Math.atan2(-dz, dx);
  const have = Math.atan2(dir.z, dir.x);
  return normAngle(want - have);
}

/**
 * Two-point alignment: `p1` is where the reference corner stands on the real
 * ground, `p2` is any point further along the reference wall.
 * With p2 missing (or too close to p1) the given fallback yaw is kept.
 */
export function alignFromTwoPoints(p1: WorldPoint, p2: WorldPoint | null, corner: Vec2, dir: Vec2, fallbackYaw = 0): Alignment {
  const yaw = (p2 && yawBetween(p1, p2, dir)) ?? fallbackYaw;
  return alignCornerAt(p1, corner, yaw);
}

/** Alignment that puts plan point `corner` on world point `p` with the given yaw. */
export function alignCornerAt(p: WorldPoint, corner: Vec2, yaw: number): Alignment {
  const r = rot(yaw, corner.x, -corner.z);
  return { x: p.x - r.x, y: p.y, z: p.z - r.z, yaw: normAngle(yaw) };
}

/** Slides the house by (dx, dz) metres in world axes, and up by dy. */
export function nudge(a: Alignment, dx: number, dz: number, dy = 0): Alignment {
  return { ...a, x: a.x + dx, y: a.y + dy, z: a.z + dz };
}

/** Turns the house by `deg` around a world point (usually where you stand), so what is near you stays near you. */
export function rotateAround(a: Alignment, deg: number, pivot: { x: number; z: number }): Alignment {
  const d = (deg * Math.PI) / 180;
  const r = rot(d, a.x - pivot.x, a.z - pivot.z);
  return { x: pivot.x + r.x, y: a.y, z: pivot.z + r.z, yaw: normAngle(a.yaw + d) };
}

export function normAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** The room that contains plan point p, or null when p is outside every room. */
export function roomAt(h: House, p: Vec2): Room | null {
  return h.rooms.find((r) => p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z) ?? null;
}

/** "Living & kitchen", "Outside, 2 m south of the house", … for the label under your feet. */
export function whereAmI(h: House, p: Vec2): string {
  const room = roomAt(h, p);
  if (room) return room.name;
  const f = footprint(h);
  const inside = p.x >= f.min.x && p.x <= f.max.x && p.z >= f.min.z && p.z <= f.max.z;
  if (inside) return "In a wall";
  const dx = p.x < f.min.x ? f.min.x - p.x : p.x > f.max.x ? p.x - f.max.x : 0;
  const dz = p.z < f.min.z ? f.min.z - p.z : p.z > f.max.z ? p.z - f.max.z : 0;
  const side = dz >= dx ? (p.z < f.min.z ? "south" : "north") : p.x < f.min.x ? "west" : "east";
  const dist = Math.hypot(dx, dz);
  return `Outside, ${dist < 10 ? dist.toFixed(1) : Math.round(dist)} m ${side} of the house`;
}

const deg360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Compass heading (degrees clockwise from true north) of a plan direction.
 * `northOffsetDeg` is how far true north lies clockwise of plan north (+z).
 */
export function headingDeg(northOffsetDeg: number, dir: Vec2): number {
  const planBearing = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
  return deg360(planBearing - northOffsetDeg);
}

// ——— Real north ———
// "North yaw" is the turn around y that carries the world's −z axis onto true
// north; a positive turn is counter-clockwise seen from above.

/** North yaw when the viewer looks along level direction (fx, fz) and that direction has compass heading `headingDeg`. */
export function northYawFromHeading(fx: number, fz: number, headingDeg = 0): number {
  return normAngle(Math.atan2(-fx, -fz) + (headingDeg * Math.PI) / 180);
}

/** How far true north lies clockwise of the placed house's plan north, in degrees 0…360. */
export function northOffsetOf(a: Alignment, northYaw: number): number {
  return deg360(((a.yaw - northYaw) * 180) / Math.PI);
}

/** North yaw for a placed house whose plan has the given north offset. */
export function northYawOf(a: Alignment, northOffsetDeg: number): number {
  return normAngle(a.yaw - (northOffsetDeg * Math.PI) / 180);
}

/**
 * Refines a placement with a second known corner: both plan points are put as
 * close as possible to where they were pegged (the error is shared between
 * them), and the angle comes from the long line between the pegs.
 * Also returns how far apart the pegs are, to compare with the plan.
 */
export function fitTwoCorners(planA: Vec2, worldA: WorldPoint, planB: Vec2, worldB: WorldPoint, fallbackYaw = 0): { align: Alignment; measured: number; planned: number } {
  const dir = { x: planB.x - planA.x, z: planB.z - planA.z };
  const yaw = yawBetween(worldA, worldB, dir) ?? fallbackYaw;
  const mid = { x: (planA.x + planB.x) / 2, z: (planA.z + planB.z) / 2 };
  const align = alignCornerAt({ x: (worldA.x + worldB.x) / 2, y: (worldA.y + worldB.y) / 2, z: (worldA.z + worldB.z) / 2 }, mid, yaw);
  return { align, measured: Math.hypot(worldB.x - worldA.x, worldB.z - worldA.z), planned: Math.hypot(dir.x, dir.z) };
}

/** The far end of the reference wall: the south-east outer corner. */
export function secondCorner(h: House): Vec2 {
  const f = footprint(h);
  return { x: f.max.x, z: f.min.z };
}

// ——— Persistence ———

export type SavedSite = Alignment & {
  /** Real north relative to the plan's north, degrees clockwise; absent until north is set on site. */
  northOffsetDeg?: number;
  /** Persistent anchor handle, where the browser gives one. */
  anchorId?: string;
  /** Reference space the numbers were taken in. */
  space: string;
  savedAt: number;
};

export const SITE_KEY = "veridom-vr-site-v1";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveSite(storage: StorageLike | null | undefined, s: SavedSite): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SITE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false; // storage can be full or blocked; the session still works
  }
}

export function loadSite(storage: StorageLike | null | undefined): SavedSite | null {
  try {
    const raw = storage?.getItem(SITE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedSite>;
    const nums = [v.x, v.y, v.z, v.yaw];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return {
      x: v.x!, y: v.y!, z: v.z!, yaw: normAngle(v.yaw!),
      northOffsetDeg: typeof v.northOffsetDeg === "number" && Number.isFinite(v.northOffsetDeg) ? v.northOffsetDeg : undefined,
      anchorId: typeof v.anchorId === "string" ? v.anchorId : undefined,
      space: typeof v.space === "string" ? v.space : "local-floor",
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearSite(storage: StorageLike | null | undefined) {
  try {
    storage?.removeItem(SITE_KEY);
  } catch {
    /* nothing to clear */
  }
}
