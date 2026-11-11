import { CATALOG } from "../furnish/catalog";
import type { Fixture, FurnitureItem, House, Opening, Pipe, Room, Wall, WallPoint } from "../house/model";

// Reads a house plan from the documented JSON format (see README, "Bring your
// own plan") and checks it. Every problem is reported with where it is and
// what is wrong, so the file can be fixed without reading this code.

export type PlanResult =
  | { ok: true; house: House; warnings: string[]; levels: { id: string; name: string }[]; level: string }
  | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const UNITS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001 };
const MAX_SIZE = 60; // metres across; larger than this is not a house plan in metres

export function importPlan(input: string | unknown, levelId?: string): PlanResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let root: unknown = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`This is not valid JSON: ${(e as Error).message}`] };
    }
  }
  if (!isObj(root)) return { ok: false, errors: ["The plan must be a JSON object: { \"name\": …, \"levels\": [ … ] }"] };
  if (root.format !== undefined && root.format !== "veridom-plan") errors.push(`format: expected "veridom-plan", got ${JSON.stringify(root.format)}`);
  if (num(root.version) && root.version > 1) errors.push(`version: this app reads version 1, the file says ${root.version}`);
  const unit = root.units === undefined ? "m" : String(root.units);
  const k = UNITS[unit];
  if (!k) return { ok: false, errors: [`units: expected "m", "cm" or "mm", got ${JSON.stringify(root.units)}`] };

  // Levels: either a list of levels, or walls/openings/rooms directly in the file (one level).
  const rawLevels: Obj[] = Array.isArray(root.levels) ? root.levels.filter(isObj) : Array.isArray(root.walls) ? [root] : [];
  if (!rawLevels.length) return { ok: false, errors: [...errors, "No levels found: add \"levels\": [ { \"walls\": [ … ], \"openings\": [ … ], \"rooms\": [ … ] } ]"] };
  const levels = rawLevels.map((l, i) => ({ id: typeof l.id === "string" ? l.id : `level-${i + 1}`, name: typeof l.name === "string" && Array.isArray(root.levels) ? l.name : `Level ${i + 1}` }));
  const li = levelId === undefined ? 0 : levels.findIndex((l) => l.id === levelId);
  if (li < 0) return { ok: false, errors: [`Level "${levelId}" is not in the file. It has: ${levels.map((l) => l.id).join(", ")}`] };
  const L = rawLevels[li]!;
  const at = Array.isArray(root.levels) ? `levels[${li}].` : "";
  if (levels.length > 1) warnings.push(`The file has ${levels.length} levels; showing "${levels[li]!.name}". Add &level=<id> to the address for another (${levels.map((l) => l.id).join(", ")}).`);

  const height = L.height === undefined ? 2.6 : num(L.height) ? L.height * k : NaN;
  if (!(height >= 2 && height <= 6)) errors.push(`${at}height: room height must be between 2 and 6 m, got ${JSON.stringify(L.height)}`);
  const pt = (v: unknown): { x: number; z: number } | null => (Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) ? { x: v[0] * k, z: v[1] * k } : isObj(v) && num(v.x) && num(v.z) ? { x: v.x * k, z: v.z * k } : null);
  const ids = new Set<string>();
  const takeId = (v: unknown, where: string): string | null => {
    const bad = (msg: string) => {
      errors.push(msg);
      return null;
    };
    if (typeof v !== "string" || !v) return bad(`${where}.id: every item needs a text id`);
    if (ids.has(v)) return bad(`${where}.id: "${v}" is used twice; ids must be unique`);
    ids.add(v);
    return v;
  };
  const list = (v: unknown, where: string): Obj[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`${where}: must be a list`);
      return [];
    }
    return v.filter((x, i) => {
      if (!isObj(x)) errors.push(`${where}[${i}]: must be an object`);
      return isObj(x);
    }) as Obj[];
  };

  // Walls.
  const walls: Wall[] = [];
  const rawWalls = list(L.walls, `${at}walls`);
  if (rawWalls.length > 500) errors.push(`${at}walls: ${rawWalls.length} walls is more than this app can show (500)`);
  let anyExteriorFlag = false;
  rawWalls.slice(0, 500).forEach((w, i) => {
    const where = `${at}walls[${i}]`;
    const id = takeId(w.id, where);
    const a = pt(w.from ?? w.a);
    const b = pt(w.to ?? w.b);
    if (!a || !b) return void errors.push(`${where}: "from" and "to" must be [x, z] pairs of numbers`);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.2) return void errors.push(`${where}${id ? ` ("${id}")` : ""}: the wall is only ${len.toFixed(2)} m long`);
    if (typeof w.exterior === "boolean") anyExteriorFlag = true;
    const exterior = w.exterior === true;
    let thickness = num(w.thickness) ? w.thickness * k : NaN;
    if (w.thickness === undefined) thickness = exterior ? 0.38 : 0.12;
    if (!(thickness >= 0.05 && thickness <= 1)) return void errors.push(`${where}${id ? ` ("${id}")` : ""}.thickness: must be between 0.05 and 1 m, got ${JSON.stringify(w.thickness)}`);
    if (id) walls.push({ id, a, b, thickness, exterior });
  });
  if (!walls.length) return { ok: false, errors: [...errors, `${at}walls: the level has no usable walls`] };

  // Move the plan so its lower-left corner is at (0, 0).
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of walls) for (const p of [w.a, w.b]) {
    minX = Math.min(minX, p.x); minZ = Math.min(minZ, p.z); maxX = Math.max(maxX, p.x); maxZ = Math.max(maxZ, p.z);
  }
  if (maxX - minX > MAX_SIZE || maxZ - minZ > MAX_SIZE) errors.push(`The plan is ${(maxX - minX).toFixed(0)} × ${(maxZ - minZ).toFixed(0)} m. Is "units" right? (now "${unit}"; a house should fit in ${MAX_SIZE} m)`);
  const shift = (p: { x: number; z: number }) => ({ x: p.x - minX, z: p.z - minZ });
  for (const w of walls) {
    w.a = shift(w.a);
    w.b = shift(w.b);
  }
  if (!anyExteriorFlag) {
    // No wall says whether it is an outer wall: those on the edge of the plan are taken as outer.
    const eps = 0.05;
    const edge = (p: { x: number; z: number }, q: { x: number; z: number }) =>
      (Math.abs(p.x) < eps && Math.abs(q.x) < eps) || (Math.abs(p.z) < eps && Math.abs(q.z) < eps) || (Math.abs(p.x - (maxX - minX)) < eps && Math.abs(q.x - (maxX - minX)) < eps) || (Math.abs(p.z - (maxZ - minZ)) < eps && Math.abs(q.z - (maxZ - minZ)) < eps);
    for (const w of walls) w.exterior = edge(w.a, w.b);
    warnings.push("No wall is marked \"exterior\": the walls on the edge of the plan are taken as outer walls.");
  }
  if (!walls.some((w) => w.exterior)) errors.push(`${at}walls: no outer wall found. Mark the outer walls with "exterior": true`);
  const wallOf = new Map(walls.map((w) => [w.id, w]));
  const lengthOf = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);

  // Doors and windows.
  const openings: Opening[] = [];
  list(L.openings, `${at}openings`).forEach((o, i) => {
    const name = typeof o.name === "string" ? o.name : typeof o.label === "string" ? o.label : "";
    const where = `${at}openings[${i}]${name ? ` ("${name}")` : ""}`;
    const id = takeId(o.id, where);
    const kind = o.type ?? o.kind;
    if (kind !== "door" && kind !== "window") return void errors.push(`${where}.type: must be "door" or "window", got ${JSON.stringify(kind)}`);
    const w = wallOf.get(String(o.wall ?? o.wallId));
    if (!w) return void errors.push(`${where}.wall: there is no wall "${String(o.wall ?? o.wallId)}"`);
    const width = num(o.width) ? o.width * k : NaN;
    const h = o.height === undefined ? (kind === "door" ? 2.1 : 1.4) : num(o.height) ? o.height * k : NaN;
    const sill = o.sill === undefined ? (kind === "door" ? 0 : 0.9) : num(o.sill) ? o.sill * k : NaN;
    const offset = num(o.offset) ? o.offset * k : NaN;
    if (!(width >= 0.3 && width <= 8)) return void errors.push(`${where}.width: must be between 0.3 and 8 m, got ${JSON.stringify(o.width)}`);
    if (!(h >= 0.3) || !(sill >= 0) || sill + h > height + 1e-6) return void errors.push(`${where}: sill ${JSON.stringify(o.sill ?? sill)} + height ${JSON.stringify(o.height ?? h)} must fit under the ${height} m ceiling`);
    const len = lengthOf(w);
    if (!(offset >= 0) || offset + width > len + 1e-6) return void errors.push(`${where}: is ${width.toFixed(2)} m wide at offset ${num(o.offset) ? offset.toFixed(2) : JSON.stringify(o.offset)} m, but wall "${w.id}" is only ${len.toFixed(2)} m long`);
    const clash = openings.find((p) => p.wallId === w.id && offset < p.offset + p.width && p.offset < offset + width);
    if (clash) return void errors.push(`${where}: overlaps "${clash.label}" on wall "${w.id}"`);
    if (!id) return;
    const op: Opening = { id, kind, label: name || `${kind === "door" ? "Door" : "Window"} ${openings.length + 1}`, wallId: w.id, offset, width, height: h, sill };
    if (kind === "door") {
      op.hinge = o.hinge === "end" ? "end" : "start";
      op.swing = o.swing === "left" ? "left" : "right";
    }
    openings.push(op);
  });

  // Rooms: rectangles. A polygon is accepted and replaced by the rectangle around it.
  const rooms: Room[] = [];
  list(L.rooms, `${at}rooms`).forEach((r, i) => {
    const name = typeof r.name === "string" ? r.name : "";
    const where = `${at}rooms[${i}]${name ? ` ("${name}")` : ""}`;
    const id = takeId(r.id, where);
    let min = pt(r.min), max = pt(r.max);
    if (Array.isArray(r.polygon)) {
      const ps = r.polygon.map(pt).filter((p): p is { x: number; z: number } => !!p);
      if (ps.length < 3) return void errors.push(`${where}.polygon: needs at least three [x, z] points`);
      min = { x: Math.min(...ps.map((p) => p.x)), z: Math.min(...ps.map((p) => p.z)) };
      max = { x: Math.max(...ps.map((p) => p.x)), z: Math.max(...ps.map((p) => p.z)) };
      if (ps.length !== 4) warnings.push(`${where}: rooms are shown as rectangles; the outline was replaced by the rectangle around it.`);
    }
    if (!min || !max) return void errors.push(`${where}: give "min" and "max" as [x, z], or a "polygon"`);
    min = shift(min);
    max = shift(max);
    if (max.x - min.x < 0.5 || max.z - min.z < 0.5) return void errors.push(`${where}: "max" must be at least 0.5 m beyond "min" in both directions`);
    if (id) rooms.push({ id, name: name || `Room ${rooms.length + 1}`, min, max, floor: r.floor === "tiles" ? "tiles" : "wood", wet: r.wet === true });
  });
  if (!rooms.length && !errors.length) {
    rooms.push({ id: "whole-floor", name: "Whole floor", min: { x: 0, z: 0 }, max: { x: maxX - minX, z: maxZ - minZ }, floor: "wood", wet: false });
    warnings.push("The file has no rooms: the whole floor is shown as one room.");
  }
  const roomIds = new Set(rooms.map((r) => r.id));

  // Optional extras: sockets and switches, fixtures, furniture, pipes, the distribution board.
  const points: WallPoint[] = [];
  list(L.points ?? L.sockets, `${at}points`).forEach((p, i) => {
    const where = `${at}points[${i}]`;
    const id = takeId(p.id, where);
    const w = wallOf.get(String(p.wall ?? p.wallId));
    if (!w) return void errors.push(`${where}.wall: there is no wall "${String(p.wall ?? p.wallId)}"`);
    const offset = num(p.offset) ? p.offset * k : NaN;
    const h = num(p.height) ? p.height * k : p.type === "switch" ? 1.05 : 0.3;
    if (!(offset >= 0 && offset <= lengthOf(w))) return void errors.push(`${where}.offset: must lie on wall "${w.id}" (0 … ${lengthOf(w).toFixed(2)} m)`);
    const kind = (p.type ?? p.kind) === "switch" ? "switch" : "socket";
    const roomId = typeof p.room === "string" && roomIds.has(p.room) ? p.room : rooms[0]?.id ?? "";
    if (id) points.push({ id, kind, label: typeof p.name === "string" ? p.name : kind === "switch" ? "Light switch" : "Socket", wallId: w.id, offset, height: h, side: p.side === "right" ? "right" : "left", roomId });
  });
  const fixtures: Fixture[] = [];
  list(L.fixtures, `${at}fixtures`).forEach((f, i) => {
    const where = `${at}fixtures[${i}]`;
    const id = takeId(f.id, where);
    const min = pt(f.min), max = pt(f.max);
    const kind = f.type ?? f.kind;
    if (!min || !max || !["wc", "sink", "shower", "counter"].includes(String(kind))) return void errors.push(`${where}: needs "type" (wc, sink, shower or counter) and "min", "max" as [x, z]`);
    const names = { wc: "Toilet", sink: "Washbasin", shower: "Shower", counter: "Kitchen counter" } as Record<string, string>;
    const heights = { wc: 0.42, sink: 0.85, shower: 0.02, counter: 0.9 } as Record<string, number>;
    const roomId = typeof f.room === "string" && roomIds.has(f.room) ? f.room : rooms.find((r) => shift(min).x >= r.min.x && shift(min).x <= r.max.x && shift(min).z >= r.min.z && shift(min).z <= r.max.z)?.id ?? rooms[0]?.id ?? "";
    if (id) fixtures.push({ id, kind: kind as Fixture["kind"], label: typeof f.name === "string" ? f.name : names[String(kind)]!, min: shift(min), max: shift(max), height: num(f.height) ? f.height * k : heights[String(kind)]!, roomId });
  });
  const furniture: FurnitureItem[] = [];
  list(L.furniture, `${at}furniture`).forEach((f, i) => {
    const where = `${at}furniture[${i}]`;
    const p = pt(f.at ?? [f.x, f.z]);
    const catalogId = String(f.item ?? f.catalogId);
    if (!CATALOG.some((c) => c.id === catalogId)) return void warnings.push(`${where}: "${catalogId}" is not in the furniture list (${CATALOG.map((c) => c.id).join(", ")}); left out.`);
    if (!p) return void errors.push(`${where}.at: must be [x, z]`);
    const s = shift(p);
    furniture.push({ id: typeof f.id === "string" && !ids.has(f.id) ? f.id : `fu-plan-${i}`, catalogId, x: s.x, z: s.z, rot: num(f.rot) ? f.rot : 0 });
  });
  const pipes: Pipe[] = [];
  list(L.pipes, `${at}pipes`).forEach((p, i) => {
    const pts = Array.isArray(p.points) ? p.points.filter((q): q is number[] => Array.isArray(q) && q.length === 3 && q.every(num)) : [];
    if (pts.length < 2 || !["cold", "hot", "drain"].includes(String(p.type ?? p.kind))) return void errors.push(`${at}pipes[${i}]: needs "type" (cold, hot or drain) and "points" as a list of [x, height, z]`);
    pipes.push({ id: typeof p.id === "string" ? p.id : `pipe-${i}`, kind: (p.type ?? p.kind) as Pipe["kind"], points: pts.map((q) => ({ x: q[0]! * k - minX, y: q[1]! * k, z: q[2]! * k - minZ })) });
  });
  const board = isObj(L.board) ? L.board : null;
  const boardWall = (board && wallOf.get(String(board.wall))) || walls.find((w) => !w.exterior) || walls[0]!;
  const panel: House["panel"] = { wallId: boardWall.id, offset: Math.min(board && num(board.offset) ? board.offset * k : 0.5, lengthOf(boardWall) - 0.3), height: 1.5, side: board?.side === "right" ? "right" : "left" };

  if (errors.length) return { ok: false, errors };
  const site = isObj(root.site) ? root.site : {};
  const lat = num(site.lat) && Math.abs(site.lat) <= 66 ? site.lat : undefined;
  if (site.lat !== undefined && lat === undefined) warnings.push("site.lat: must be a latitude between −66 and 66; the demo plot's location is used for the sun.");
  const pad = 6;
  const house: House = {
    name: typeof root.name === "string" && root.name ? root.name : "Imported plan",
    plot: { min: { x: -pad, z: -pad - 4 }, max: { x: maxX - minX + pad, z: maxZ - minZ + pad + 4 } },
    northOffsetDeg: num(site.northOffsetDeg) ? site.northOffsetDeg : 0,
    storeyHeight: height,
    slabThickness: 0.3,
    walls, openings, points, fixtures, furniture, rooms, pipes, panel,
    ...(lat !== undefined ? { location: { lat, lon: num(site.lon) ? site.lon : 15, name: typeof site.name === "string" ? site.name : "Your plot" } } : {}),
  };
  return { ok: true, house, warnings, levels, level: levels[li]!.id };
}
