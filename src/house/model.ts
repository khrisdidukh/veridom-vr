// Plan data for one house. Units are metres. The plan's x axis runs east,
// its z axis runs north; y is up. Everything the 3D scene shows is derived
// from this structure, so an edit is a change to these numbers.

export type Vec2 = { x: number; z: number };

export type Wall = {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  exterior: boolean;
};

export type OpeningKind = "door" | "window";

export type Opening = {
  id: string;
  kind: OpeningKind;
  label: string;
  wallId: string;
  /** Distance from wall start `a` to the opening's near edge. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom edge above the finished floor (0 for doors). */
  sill: number;
  /** Doors: which end the hinge is on, and to which side of the wall the leaf opens. */
  hinge?: "start" | "end";
  swing?: "left" | "right";
};

export type PointKind = "socket" | "switch";

export type WallPoint = {
  id: string;
  kind: PointKind;
  label: string;
  wallId: string;
  offset: number;
  height: number;
  /** Which face of the wall the point sits on. */
  side: "left" | "right";
  roomId: string;
};

export type FixtureKind = "wc" | "sink" | "shower" | "counter" | "bed" | "sofa" | "table";

export type Fixture = {
  id: string;
  kind: FixtureKind;
  label: string;
  /** Axis-aligned footprint. */
  min: Vec2;
  max: Vec2;
  height: number;
  roomId: string;
};

export type Room = {
  id: string;
  name: string;
  min: Vec2;
  max: Vec2;
  floor: "wood" | "tiles";
  wet: boolean;
};

export type Pipe = {
  id: string;
  kind: "cold" | "hot" | "drain";
  points: { x: number; y: number; z: number }[];
};

export type House = {
  name: string;
  plot: { min: Vec2; max: Vec2 };
  /** Degrees clockwise from plan north (+z) to true north. */
  northOffsetDeg: number;
  storeyHeight: number;
  slabThickness: number;
  walls: Wall[];
  openings: Opening[];
  points: WallPoint[];
  fixtures: Fixture[];
  rooms: Room[];
  pipes: Pipe[];
  /** Distribution board; cables run from here to every point. */
  panel: { wallId: string; offset: number; height: number; side: "left" | "right" };
};

export const cloneHouse = (h: House): House => structuredClone(h);

export function wallById(h: House, id: string): Wall {
  const w = h.walls.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown wall ${id}`);
  return w;
}

export function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
}

/** Unit direction along the wall and the unit normal to its "left" side. */
export function wallFrame(w: Wall) {
  const len = wallLength(w);
  const dir = { x: (w.b.x - w.a.x) / len, z: (w.b.z - w.a.z) / len };
  // Left of the direction of travel in a right-handed x/z plan seen from above.
  const left = { x: -dir.z, z: dir.x };
  return { len, dir, left };
}

/** Point on the wall's centre line at `offset` metres from `a`. */
export function alongWall(w: Wall, offset: number): Vec2 {
  const { dir } = wallFrame(w);
  return { x: w.a.x + dir.x * offset, z: w.a.z + dir.z * offset };
}
