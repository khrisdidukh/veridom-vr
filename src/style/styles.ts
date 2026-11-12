import { catalogById, footprint } from "../furnish/catalog";
import { alongWall, wallFrame, type House, type Room, type Vec2 } from "../house/model";

// Three interior looks. A look is a set of colours for the shared materials
// (floor, paint, kitchen, fabrics, wood, metal) plus a few dressing pieces —
// a rug, pictures, a floor lamp — placed by rule, so they fit any plan.

export type StyleId = "modern" | "scandi" | "luxury";
/** A colour: a hex number, or linear r, g, b multipliers (above 1 lightens a textured material). */
export type Tint = number | [number, number, number];
export type MaterialKey = "parquet" | "tiles" | "plaster" | "oak" | "front" | "stone" | "fabricGrey" | "fabricSand" | "linen" | "duvet" | "accent" | "chrome";

export type Look = {
  id: StyleId;
  label: string;
  short: string;
  colors: Record<MaterialKey, Tint>;
  /** Worktop: polished stone is smooth, a pale laminate less so. */
  stoneRoughness: number;
  rug: { base: string; line: string; pattern: "border" | "stripes" | "frame" };
  art: { frame: number; palette: string[]; count: 1 | 2 };
  lampShade: number;
};

export const STYLES: Look[] = [
  {
    id: "modern", label: "Modern", short: "Modern",
    colors: { parquet: 0xffffff, tiles: 0xf3f1ec, plaster: 0xffffff, oak: 0xffffff, front: 0xe8e4dc, stone: 0x3a3b3d, fabricGrey: 0x9b968e, fabricSand: 0xcbbfae, linen: 0xf0ede6, duvet: 0xc9ced3, accent: 0x33566b, chrome: 0xd8dadc },
    stoneRoughness: 0.35,
    rug: { base: "#4a4d52", line: "#d9d6cf", pattern: "border" },
    art: { frame: 0x1c1d1f, palette: ["#e9e6df", "#33566b", "#c7a36a", "#22252a"], count: 1 },
    lampShade: 0xf2efe8,
  },
  {
    id: "scandi", label: "Scandinavian", short: "Scandi",
    colors: { parquet: [1.75, 1.6, 1.36], tiles: 0xffffff, plaster: 0xfafbfc, oak: [1.5, 1.4, 1.22], front: 0xf6f5f1, stone: 0xe9e6df, fabricGrey: 0xc9c6bf, fabricSand: 0xe6dccb, linen: 0xfbf9f4, duvet: 0xe9edf0, accent: 0x9fb5a3, chrome: 0xd8dadc },
    stoneRoughness: 0.55,
    rug: { base: "#efe9dd", line: "#9aa39c", pattern: "stripes" },
    art: { frame: 0xd9c8a9, palette: ["#f4f1ea", "#9fb5a3", "#d8b9a0", "#5d6b66"], count: 2 },
    lampShade: 0xffffff,
  },
  {
    id: "luxury", label: "Warm luxury", short: "Luxury",
    colors: { parquet: [0.52, 0.37, 0.28], tiles: 0xcdbfa9, plaster: 0xeadcc6, oak: [0.55, 0.4, 0.3], front: 0x3b2f29, stone: 0x1b1918, fabricGrey: 0x2f4a40, fabricSand: 0xb08d57, linen: 0xefe6d6, duvet: 0xd9cdb8, accent: 0x7a2e2e, chrome: 0xc9a45c },
    stoneRoughness: 0.15,
    rug: { base: "#5a2326", line: "#c9a45c", pattern: "frame" },
    art: { frame: 0xc9a45c, palette: ["#1f2a26", "#c9a45c", "#7a2e2e", "#eadcc6"], count: 1 },
    lampShade: 0xe8d3a8,
  },
];

export const styleById = (id: string): Look => STYLES.find((s) => s.id === id) ?? STYLES[0]!;
export const nextStyle = (id: string): StyleId => STYLES[(STYLES.findIndex((s) => s.id === id) + 1) % STYLES.length]!.id;

// ——— Dressing ———

export type Dressing =
  | { kind: "rug"; x: number; z: number; rot: number; w: number; d: number }
  | { kind: "art"; x: number; z: number; y: number; rot: number; w: number; h: number; wallId: string }
  | { kind: "lamp"; x: number; z: number };

const area = (r: Room) => (r.max.x - r.min.x) * (r.max.z - r.min.z);
const inRoom = (r: Room, p: Vec2, m = 0) => p.x >= r.min.x + m && p.x <= r.max.x - m && p.z >= r.min.z + m && p.z <= r.max.z - m;

/** The living room: the room with a sofa, else the largest room with a wooden floor, else the largest room. */
export function livingRoom(h: House): Room | null {
  const sofa = h.furniture.find((f) => f.catalogId === "sofa");
  const withSofa = sofa && h.rooms.find((r) => inRoom(r, sofa));
  if (withSofa) return withSofa;
  const wood = h.rooms.filter((r) => r.floor === "wood");
  return [...(wood.length ? wood : h.rooms)].sort((a, b) => area(b) - area(a))[0] ?? null;
}

/** A free stretch of wall facing into `room`, at least `need` metres long: no door, window, switch or tall furniture in the way. */
export function freeWall(h: House, room: Room, need: number): { wallId: string; at: Vec2; normal: Vec2; length: number } | null {
  let best: { wallId: string; at: Vec2; normal: Vec2; length: number } | null = null;
  const tall = h.furniture.filter((f) => (catalogById(f.catalogId)?.h ?? 0) > 1.1).map(footprint);
  for (const w of h.walls) {
    const { len, dir, left } = wallFrame(w);
    for (const side of [1, -1]) {
      const n = { x: left.x * side, z: left.z * side };
      const d = w.thickness / 2;
      // Cut the wall at openings and wall points, then at the ends of the room.
      const cuts: [number, number][] = [
        ...h.openings.filter((o) => o.wallId === w.id).map((o): [number, number] => [o.offset - 0.25, o.offset + o.width + 0.25]),
        ...h.points.filter((p) => p.wallId === w.id).map((p): [number, number] => [p.offset - 0.3, p.offset + 0.3]),
      ].sort((a, b) => a[0] - b[0]);
      let from = 0.3;
      const spans: [number, number][] = [];
      for (const [s, e] of cuts) {
        if (s > from) spans.push([from, s]);
        from = Math.max(from, e);
      }
      if (len - 0.3 > from) spans.push([from, len - 0.3]);
      for (const [s0, e0] of spans) {
        // Keep the part of the span that really borders this room.
        let s = s0, e = e0;
        const front = (t: number) => {
          const c = alongWall(w, t);
          return { x: c.x + n.x * (d + 0.35), z: c.z + n.z * (d + 0.35) };
        };
        while (e - s >= need && !inRoom(room, front(s))) s += 0.1;
        while (e - s >= need && !inRoom(room, front(e))) e -= 0.1;
        if (e - s < need) continue;
        const mid = (s + e) / 2;
        const f = front(mid);
        if (!inRoom(room, f)) continue;
        if (tall.some((b) => f.x > b.min.x - 0.5 && f.x < b.max.x + 0.5 && f.z > b.min.z - 0.5 && f.z < b.max.z + 0.5)) continue;
        if (!best || e - s > best.length) {
          const c = alongWall(w, mid);
          best = { wallId: w.id, at: { x: c.x + n.x * (d + 0.02), z: c.z + n.z * (d + 0.02) }, normal: n, length: e - s };
        }
      }
      void dir;
    }
  }
  return best;
}

/** Where the dressing pieces of a look go in this house. */
export function dressing(h: House, style: StyleId): Dressing[] {
  const look = styleById(style);
  const out: Dressing[] = [];
  const living = livingRoom(h);
  if (!living) return out;
  // Rug: in front of the sofa when there is one, else in the middle of the living room.
  const sofa = h.furniture.find((f) => f.catalogId === "sofa" && inRoom(living, f));
  const rw = Math.min(2.4, (living.max.x - living.min.x) * 0.6), rd = Math.min(1.7, (living.max.z - living.min.z) * 0.5);
  if (sofa) {
    const a = (sofa.rot * Math.PI) / 180;
    const front = { x: Math.sin(a), z: -Math.cos(a) };
    const c = { x: sofa.x + front.x * 1.25, z: sofa.z + front.z * 1.25 };
    if (inRoom(living, c, 0.6)) out.push({ kind: "rug", x: c.x, z: c.z, rot: sofa.rot, w: rw, d: rd });
  }
  if (!out.length) out.push({ kind: "rug", x: (living.min.x + living.max.x) / 2, z: (living.min.z + living.max.z) / 2, rot: living.max.x - living.min.x >= living.max.z - living.min.z ? 0 : 90, w: rw, d: rd });
  // Pictures: in the living room and over or beside the bed.
  const bed = h.furniture.find((f) => f.catalogId === "bed");
  const bedroom = bed && h.rooms.find((r) => inRoom(r, bed));
  for (const room of [living, bedroom]) {
    if (!room) continue;
    const size = look.art.count === 2 ? { w: 1.25, h: 0.7 } : { w: 1.1, h: 0.75 };
    const spot = freeWall(h, room, size.w + 0.5);
    if (spot) out.push({ kind: "art", x: spot.at.x, z: spot.at.z, y: 1.55, rot: Math.atan2(spot.normal.x, -spot.normal.z), ...size, wallId: spot.wallId });
  }
  // Floor lamp: the living-room corner furthest from doors and clear of furniture.
  const doors = h.openings.filter((o) => o.kind === "door" || o.sill <= 0.05).map((o) => alongWall(h.walls.find((w) => w.id === o.wallId)!, o.offset + o.width / 2));
  const boxes = [...h.furniture.map(footprint), ...h.fixtures.map((f) => ({ min: f.min, max: f.max }))];
  const corners = [0.45, -0.45].flatMap((ix) => [0.45, -0.45].map((iz) => ({ x: ix > 0 ? living.min.x + ix : living.max.x + ix, z: iz > 0 ? living.min.z + iz : living.max.z + iz })));
  const free = corners
    .filter((c) => !boxes.some((b) => c.x > b.min.x - 0.25 && c.x < b.max.x + 0.25 && c.z > b.min.z - 0.25 && c.z < b.max.z + 0.25))
    .map((c) => ({ c, far: Math.min(9, ...doors.map((d) => Math.hypot(d.x - c.x, d.z - c.z))) }))
    .sort((a, b) => b.far - a.far)[0];
  if (free && free.far > 1.2) out.push({ kind: "lamp", x: free.c.x, z: free.c.z });
  return out;
}
