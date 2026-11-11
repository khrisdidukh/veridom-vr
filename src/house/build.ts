import * as THREE from "three";
import { doorSwing } from "../edit/checks";
import { buildCeilingLamp, buildCounter, buildShower, buildSink, buildWc, finishPiece, procUV } from "../furnish/pieces";
import { M, M as Mat, solid, worldUV } from "./materials";
import { mergeByMaterial } from "./merge";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Rounded edges on frames, casings, sills and skirting. Off in lite mode, where every triangle counts. */
let detail = true;
export const setDetail = (on: boolean) => (detail = on);
import { occlusionBands, type WallRun } from "./ao";
import { footprint } from "../site/align";
import { alongWall, wallById, wallFrame, wallLength, type Fixture, type House, type Opening, type Wall } from "./model";

// Builds the 3D house from plan data. Plan (x, z-north) maps to three.js
// (x, y, -z), so north points away from a viewer standing south of the house.

export type Built = {
  root: THREE.Group;
  stageGroups: THREE.Group[];
  /** Wall meshes; their material switches from brick to plaster at stage 4. */
  walls: THREE.Mesh[];
  wallBrick: THREE.MeshStandardMaterial;
  wallPlaster: THREE.MeshStandardMaterial;
  ghostWalls: THREE.Group;
  roughIn: THREE.Group;
  ceiling: THREE.Group;
  pickables: THREE.Object3D[];
  /** Meshes per element id, for highlighting. */
  byElement: Map<string, THREE.Mesh[]>;
  /** Warm light points at the ceiling lamps, used at night. */
  lampPoints: THREE.Vector3[];
  grass: THREE.Mesh;
  /** Slab and room floors, with their own materials so they can be faded or hidden on site. */
  floors: THREE.Object3D[];
  floorMats: THREE.MeshStandardMaterial[];
  ceilingMat: THREE.MeshStandardMaterial;
  /** Pipes, cables and the distribution board; each carries userData.info for the footnotes. */
  services: THREE.Mesh[];
  /** Soft shading where walls meet the floor; hidden when the walls are see-through. */
  occlusion: THREE.Mesh[];
};

const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);

export const COLORS = {
  cold: 0x2f7fe0,
  hot: 0xe0402f,
  drain: 0x8a8a8a,
  cable: 0xf2c230,
  highlight: 0xff8a1f,
  select: 0x29c4d6,
  changed: 0xb86bff,
};

function addTo(map: Map<string, THREE.Mesh[]>, id: string, m: THREE.Mesh) {
  const list = map.get(id) ?? [];
  list.push(m);
  map.set(id, list);
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A box between two plan points along a wall, from y0 to y1, `thick` across. */
function wallPiece(w: Wall, from: number, to: number, y0: number, y1: number, material: THREE.Material, thick = w.thickness, across = 0, bevel = 0): THREE.Mesh | null {
  if (to - from < 0.01 || y1 - y0 < 0.01) return null;
  const { dir, left } = wallFrame(w);
  const len = to - from;
  const m = new THREE.Mesh(edged(len, y1 - y0, thick, bevel), material);
  const mid = alongWall(w, (from + to) / 2);
  m.position.copy(P(mid.x + left.x * across, (y0 + y1) / 2, mid.z + left.z * across));
  m.rotation.y = Math.atan2(dir.z, dir.x);
  return shadowed(m);
}

/**
 * Wall masonry: a wall piece without its two end faces. Inside a wall those
 * faces touch the next piece, and through a see-through wall they would show
 * as dark seams. The real faces beside an opening are added by jamb().
 */
function masonry(w: Wall, from: number, to: number, y0: number, y1: number, material: THREE.Material): THREE.Mesh | null {
  const m = wallPiece(w, from, to, y0, y1, material);
  if (!m) return null;
  const g = m.geometry.toNonIndexed();
  // BoxGeometry lists its +x and −x faces first: six vertices each.
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    g.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(12 * a.itemSize), a.itemSize));
  }
  m.geometry = g;
  return m;
}

/** The reveal beside an opening: one face across the wall, looking into the opening. */
function jamb(w: Wall, at: number, y0: number, y1: number, facing: 1 | -1, material: THREE.Material): THREE.Mesh | null {
  if (y1 - y0 < 0.01) return null;
  const { dir } = wallFrame(w);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w.thickness, y1 - y0), material);
  const c = alongWall(w, at);
  m.position.copy(P(c.x, (y0 + y1) / 2, c.z));
  // A plane looks along +z; turn that to ±the wall direction, (dir.x, 0, −dir.z) in scene axes.
  m.rotation.y = Math.atan2(facing * dir.x, -facing * dir.z);
  return shadowed(m);
}

/** A box, with softly rounded edges when `bevel` (a radius in metres) is given and detail is on. */
function edged(w: number, h: number, d: number, bevel: number, segments = 2): THREE.BufferGeometry {
  const r = Math.min(bevel, w / 2, h / 2, d / 2);
  return detail && r > 0.001 ? new RoundedBoxGeometry(w, h, d, segments, r) : new THREE.BoxGeometry(w, h, d);
}

function boxAt(min: { x: number; z: number }, max: { x: number; z: number }, y0: number, y1: number, material: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(max.x - min.x, y1 - y0, max.z - min.z), material);
  m.position.copy(P((min.x + max.x) / 2, (y0 + y1) / 2, (min.z + max.z) / 2));
  return shadowed(m);
}

function tube(points: THREE.Vector3[], radius: number, color: number) {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) curve.add(new THREE.LineCurve3(points[i]!, points[i + 1]!));
  const g = new THREE.TubeGeometry(curve, Math.max(4, points.length * 6), radius, 8, false);
  return new THREE.Mesh(g, solid(color, 0.4, 0, { emissive: color, emissiveIntensity: 0.25 }));
}

/** Point on a wall face (not the centre line) for sockets and switches. */
function wallFacePoint(h: House, wallId: string, offset: number, side: "left" | "right", inset = 0.01) {
  const w = wallById(h, wallId);
  const { left } = wallFrame(w);
  const s = side === "left" ? 1 : -1;
  const c = alongWall(w, offset);
  const d = w.thickness / 2 + inset;
  // rotY turns a mesh's local +z to face out of this wall face.
  return { x: c.x + left.x * d * s, z: c.z + left.z * d * s, rotY: Math.atan2(left.x * s, -left.z * s) };
}

export function buildHouse(h: House): Built {
  const root = new THREE.Group();
  root.name = "house";
  const byElement = new Map<string, THREE.Mesh[]>();
  const pickables: THREE.Object3D[] = [];
  const lampPoints: THREE.Vector3[] = [];
  const stageGroups = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.Group();
    g.name = `stage-${i}`;
    root.add(g);
    return g;
  });
  const [plot, slab, shell, , plaster, finish] = stageGroups as [THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  const H = h.storeyHeight;

  // Stage 0 — plot: lawn, the dug-out footprint and corner stakes.
  const grass = boxAt(h.plot.min, h.plot.max, -0.36, -0.3, M.grass);
  grass.castShadow = false;
  worldUV(grass, 2.5);
  plot.add(grass);
  const outerMin = { x: -0.2, z: -0.2 };
  const outerMax = { x: 12.2, z: 9.2 };
  const soil = boxAt({ x: outerMin.x - 0.8, z: outerMin.z - 0.8 }, { x: outerMax.x + 0.8, z: outerMax.z + 0.8 }, -0.35, -0.295, M.soil);
  soil.castShadow = false;
  worldUV(soil, 2);
  plot.add(soil);
  const stake = solid(0xc9a46a, 0.8);
  for (const [x, z] of [[outerMin.x, outerMin.z], [outerMax.x, outerMin.z], [outerMax.x, outerMax.z], [outerMin.x, outerMax.z]] as const) {
    plot.add(boxAt({ x: x - 0.03, z: z - 0.03 }, { x: x + 0.03, z: z + 0.03 }, -0.3, 0.6, stake));
  }

  // Stage 1 — slab.
  const slabMat = M.concrete.clone();
  const slabMesh = boxAt(outerMin, outerMax, -h.slabThickness, 0, slabMat);
  worldUV(slabMesh, 3);
  slab.add(slabMesh);

  // Stage 2 — walls with openings. Brick until plaster, then plaster.
  const wallBrick = M.brick.clone();
  const wallPlaster = M.plaster.clone();
  const walls: THREE.Mesh[] = [];
  const ghostWalls = new THREE.Group();
  ghostWalls.name = "ghost-walls";
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const skirting = M.white;
  const runs: WallRun[] = [];
  for (const w of h.walls) {
    const len = wallLength(w);
    const openings = h.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    const pieces: (THREE.Mesh | null)[] = [];
    const fullRuns: [number, number][] = [];
    for (const o of openings) {
      pieces.push(masonry(w, cursor, o.offset, 0, H, wallBrick));
      fullRuns.push([cursor, o.offset]);
      pieces.push(masonry(w, o.offset, o.offset + o.width, 0, o.sill, wallBrick));
      if (o.sill > 0) fullRuns.push([o.offset, o.offset + o.width]);
      pieces.push(masonry(w, o.offset, o.offset + o.width, o.sill + o.height, H, wallBrick));
      pieces.push(jamb(w, o.offset, o.sill, o.sill + o.height, 1, wallBrick));
      pieces.push(jamb(w, o.offset + o.width, o.sill, o.sill + o.height, -1, wallBrick));
      cursor = o.offset + o.width;
    }
    pieces.push(masonry(w, cursor, len, 0, H, wallBrick));
    fullRuns.push([cursor, len]);
    for (const p of pieces) {
      if (!p) continue;
      worldUV(p, 1.0);
      shell.add(p);
      walls.push(p);
    }
    // Skirting boards on both faces (outside, a dark plinth instead).
    for (const [a, b] of fullRuns) {
      runs.push({ wall: w, from: a, to: b });
      const inner = wallPiece(w, a, b, 0.03, 0.11, skirting, 0.016, w.thickness / 2 + 0.008, 0.006);
      if (inner) finish.add(inner);
      const other = wallPiece(w, a, b, w.exterior ? -0.3 : 0.03, w.exterior ? 0.3 : 0.11, w.exterior ? M.anthracite : skirting, 0.016, -(w.thickness / 2 + 0.008), w.exterior ? 0 : 0.006);
      if (other) finish.add(other);
    }
    const ghost = wallPiece(w, 0, len, 0, H, ghostMat);
    if (ghost) {
      ghost.castShadow = false;
      ghostWalls.add(ghost);
    }
  }
  root.add(ghostWalls);
  // Drawn-in ambient occlusion along the wall bases; outdoors only the room side of a wall gets it.
  const fp = footprint(h);
  const centre = { x: (fp.min.x + fp.max.x) / 2, z: (fp.min.z + fp.max.z) / 2 };
  const roomSide = (w: Wall): 1 | -1 | 0 => {
    if (!w.exterior) return 0;
    const { left } = wallFrame(w);
    return (centre.x - (w.a.x + w.b.x) / 2) * left.x + (centre.z - (w.a.z + w.b.z) / 2) * left.z >= 0 ? 1 : -1;
  };
  const floorAO = occlusionBands(runs, 0.034, 0.42, roomSide);
  shell.add(floorAO);

  const ceiling = new THREE.Group();
  ceiling.name = "ceiling";
  const ceilingMat = M.plaster.clone();
  const ceil = boxAt(outerMin, outerMax, H, H + 0.22, ceilingMat);
  worldUV(ceil, 1.5);
  ceiling.add(ceil);
  const fullWalls: WallRun[] = h.walls.map((w) => ({ wall: w, from: 0, to: wallLength(w) }));
  ceiling.add(occlusionBands(fullWalls, H - 0.004, 0.5, roomSide));
  shell.add(ceiling);

  // Openings: pick proxies always exist, so the owner can edit before anything is built.
  for (const o of h.openings) {
    const w = wallById(h, o.wallId);
    const proxy = wallPiece(w, o.offset, o.offset + o.width, o.sill, o.sill + o.height, new THREE.MeshBasicMaterial({ visible: false }));
    if (proxy) {
      proxy.castShadow = proxy.receiveShadow = false;
      proxy.scale.z = 1.6;
      proxy.userData = { pick: { type: o.kind, id: o.id } };
      root.add(proxy);
      pickables.push(proxy);
    }
    addOpeningFinish(h, o, shell, finish, byElement, ghostWalls);
  }

  // Door swing arcs on the floor: planning information, shown from the slab on.
  for (const d of h.openings.filter((o) => o.kind === "door")) {
    const s = doorSwing(h, d);
    const a0 = Math.atan2(s.closedDir.z, s.closedDir.x);
    const a1 = Math.atan2(s.openDir.z, s.openDir.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const g = new THREE.RingGeometry(s.radius - 0.03, s.radius, 24, 1, Math.min(a0, a0 + delta), Math.abs(delta));
    const arc = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x29c4d6, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    arc.rotation.x = -Math.PI / 2;
    arc.position.copy(P(s.hinge.x, 0.04, s.hinge.z));
    arc.userData.swingFor = d.id;
    slab.add(arc);
    addTo(byElement, d.id, arc);
  }

  // Stage 3 — rough-in: pipes, cables from the panel, wall boxes.
  const roughIn = stageGroups[3]!;
  const services: THREE.Mesh[] = [];
  const service = (m: THREE.Mesh, id: string) => {
    m.userData.info = { kind: "service", service: id };
    services.push(m);
    return m;
  };
  for (const p of h.pipes) {
    const color = p.kind === "cold" ? COLORS.cold : p.kind === "hot" ? COLORS.hot : COLORS.drain;
    roughIn.add(service(tube(p.points.map((q) => P(q.x, q.y, q.z)), p.kind === "drain" ? 0.05 : 0.016, color), p.kind));
  }
  const panel = wallFacePoint(h, h.panel.wallId, h.panel.offset, h.panel.side, 0.02);
  const panelBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.06), solid(0xc9c9c9, 0.5, 0.3));
  panelBox.position.copy(P(panel.x, h.panel.height, panel.z));
  panelBox.rotation.y = panel.rotY;
  roughIn.add(service(panelBox, "board"));
  const cableY = H - 0.15;
  for (const pt of h.points) {
    const f = wallFacePoint(h, pt.wallId, pt.offset, pt.side, -0.02);
    const pts = [P(panel.x, h.panel.height + 0.3, panel.z), P(panel.x, cableY, panel.z), P(f.x, cableY, f.z), P(f.x, pt.height, f.z)];
    const c = service(tube(pts, 0.008, COLORS.cable), "cable");
    roughIn.add(c);
    addTo(byElement, pt.id, c);
    const boxMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), solid(0x2b5fa8, 0.5));
    boxMesh.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.copy(P(f.x, pt.height, f.z));
    holder.rotation.y = f.rotY;
    holder.add(boxMesh);
    roughIn.add(holder);
  }

  // Stage 4 — plaster: same wall meshes, material switched by the timeline. Wall points get a face plate.
  for (const pt of h.points) {
    const f = wallFacePoint(h, pt.wallId, pt.offset, pt.side, 0.006);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.012), solid(0xfafafa, 0.35));
    plate.position.copy(P(f.x, pt.height, f.z));
    plate.rotation.y = f.rotY;
    plaster.add(plate);
    addTo(byElement, pt.id, plate);
    const detail = new THREE.Mesh(
      pt.kind === "socket" ? new THREE.CylinderGeometry(0.025, 0.025, 0.006, 20) : new THREE.BoxGeometry(0.05, 0.05, 0.006),
      solid(0xe9e9e9, 0.4),
    );
    if (pt.kind === "socket") detail.rotation.x = Math.PI / 2;
    const dh = new THREE.Group();
    dh.position.copy(plate.position);
    dh.rotation.y = f.rotY;
    detail.position.z = 0.008;
    dh.add(detail);
    plaster.add(dh);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(plate.position);
    proxy.userData = { pick: { type: pt.kind, id: pt.id } };
    root.add(proxy);
    pickables.push(proxy);
  }

  // Stage 5 — finishes: floors, sanitary and kitchen, ceiling lamps.
  const floorGroup = new THREE.Group();
  floorGroup.name = "floors";
  finish.add(floorGroup);
  const floorWood = M.parquet.clone();
  const floorTiles = M.tiles.clone();
  for (const r of h.rooms) {
    const floor = boxAt(r.min, r.max, 0, 0.03, r.floor === "wood" ? floorWood : floorTiles);
    floor.castShadow = false;
    worldUV(floor, r.floor === "wood" ? 1.6 : 1.2);
    floorGroup.add(floor);
    const c = P((r.min.x + r.max.x) / 2, 0, (r.min.z + r.max.z) / 2);
    const lamp = buildCeilingLamp();
    lamp.position.set(c.x, H - 0.82, c.z);
    finish.add(lamp);
    lampPoints.push(new THREE.Vector3(c.x, H - 0.42, c.z));
  }
  for (const f of h.fixtures) {
    const piece = buildFixture(h, f);
    finish.add(piece);
    piece.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        addTo(byElement, f.id, o);
        if (f.kind === "counter") {
          o.userData = { pick: { type: "counter", id: f.id } };
          pickables.push(o);
        }
      }
    });
  }

  // Fewer draw calls for the headset: merge everything that is never picked or highlighted on its own.
  const special = new Set<THREE.Object3D>([grass, slabMesh, ...pickables, ...services]);
  for (const list of byElement.values()) for (const m of list) special.add(m);
  const inKept = (m: THREE.Object3D) => { for (let o: THREE.Object3D | null = m; o; o = o.parent) if (o === ceiling || o === floorGroup) return true; return false; };
  for (const g of stageGroups) mergeByMaterial(g, (m) => special.has(m) || inKept(m));
  mergeByMaterial(floorGroup);
  const mergedWalls: THREE.Mesh[] = [];
  shell.traverse((o) => { if (o instanceof THREE.Mesh && o.material === wallBrick) mergedWalls.push(o); });

  return { root, stageGroups, walls: mergedWalls, wallBrick, wallPlaster, ghostWalls, roughIn, ceiling, pickables, byElement, lampPoints, grass, floors: [slabMesh, floorGroup], floorMats: [slabMat, floorWood, floorTiles], ceilingMat, services, occlusion: [floorAO] };
}

/** Orients a fixture with its back to the nearest edge of its room. */
function buildFixture(h: House, f: Fixture): THREE.Object3D {
  const room = h.rooms.find((r) => r.id === f.roomId);
  const edges = room
    ? [
        { d: f.min.x - room.min.x, back: { x: -1, z: 0 } },
        { d: room.max.x - f.max.x, back: { x: 1, z: 0 } },
        { d: f.min.z - room.min.z, back: { x: 0, z: -1 } },
        { d: room.max.z - f.max.z, back: { x: 0, z: 1 } },
      ].sort((a, b) => a.d - b.d)
    : [{ d: 0, back: { x: 0, z: 1 } }];
  const back = edges[0]!.back;
  const sx = f.max.x - f.min.x;
  const sz = f.max.z - f.min.z;
  const width = back.x !== 0 ? sz : sx;
  const depth = back.x !== 0 ? sx : sz;
  let g: THREE.Object3D;
  if (f.kind === "counter") g = buildCounter(width, depth, f.height);
  else if (f.kind === "wc") g = buildWc();
  else if (f.kind === "sink") g = buildSink(width);
  else if (f.kind === "shower") g = buildShower(width, depth);
  else g = new THREE.Group();
  procUV(g);
  mergeByMaterial(g);
  finishPiece(g);
  const holder = new THREE.Group();
  holder.add(g);
  holder.position.copy(P((f.min.x + f.max.x) / 2, 0, (f.min.z + f.max.z) / 2));
  // Front = −back in plan; three rotation θ puts local +z at plan (sin θ, −cos θ).
  holder.rotation.y = Math.atan2(-back.x, back.z);
  return holder;
}

function addOpeningFinish(h: House, o: Opening, shell: THREE.Group, finish: THREE.Group, byElement: Map<string, THREE.Mesh[]>, ghost: THREE.Group) {
  const w = wallById(h, o.wallId);
  // Own materials per opening, so highlighting one door doesn't tint every frame in the house.
  const M = { white: Mat.white.clone(), anthracite: Mat.anthracite.clone(), chrome: Mat.chrome.clone(), glass: Mat.glass.clone() };
  const frame = (a: number, b: number, y0: number, y1: number, mat: THREE.Material, thick: number, across = 0) => {
    const m = wallPiece(w, a, b, y0, y1, mat, thick, across, 0.006);
    if (m) {
      finish.add(m);
      addTo(byElement, o.id, m);
    }
    return m;
  };
  if (o.kind === "window") {
    const f = 0.07;
    const t = 0.09;
    const frameMat = M.anthracite;
    // Frames go in with the shell (windows are fitted before plaster in Austria).
    const put = (a: number, b: number, y0: number, y1: number) => {
      const m = wallPiece(w, a, b, y0, y1, frameMat, t, 0, 0.008);
      if (m) {
        shell.add(m);
        addTo(byElement, o.id, m);
      }
    };
    put(o.offset, o.offset + f, o.sill, o.sill + o.height);
    put(o.offset + o.width - f, o.offset + o.width, o.sill, o.sill + o.height);
    put(o.offset, o.offset + o.width, o.sill, o.sill + f);
    put(o.offset, o.offset + o.width, o.sill + o.height - f, o.sill + o.height);
    if (o.width > 1.5) put(o.offset + o.width / 2 - 0.035, o.offset + o.width / 2 + 0.035, o.sill, o.sill + o.height);
    const glass = wallPiece(w, o.offset + f, o.offset + o.width - f, o.sill + f, o.sill + o.height - f, M.glass, 0.02);
    if (glass) {
      glass.renderOrder = 2; // after see-through walls
      glass.castShadow = false;
      glass.receiveShadow = false;
      shell.add(glass);
      addTo(byElement, o.id, glass);
    }
    if (o.sill > 0) {
      // Inner sill on the left (inside of an exterior wall), aluminium sill outside.
      const dIn = w.thickness / 2 - t / 2 + 0.03;
      const dOut = w.thickness / 2 - t / 2 + 0.05;
      frame(o.offset - 0.03, o.offset + o.width + 0.03, o.sill - 0.025, o.sill, M.white, dIn, t / 2 + dIn / 2);
      frame(o.offset - 0.02, o.offset + o.width + 0.02, o.sill - 0.03, o.sill - 0.01, M.anthracite, dOut, -(t / 2 + dOut / 2));
    }
    const outline = wallPiece(w, o.offset, o.offset + o.width, o.sill, o.sill + o.height,
      new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, depthWrite: false }));
    if (outline) {
      outline.castShadow = false;
      outline.scale.z = 1.05;
      ghost.add(outline);
      addTo(byElement, o.id, outline);
    }
    return;
  }
  // Door: casings on both faces, a leaf shown half open so the swing reads, and a handle.
  const c = 0.06;
  const casingT = w.thickness + 0.03;
  frame(o.offset - c, o.offset, 0.03, o.height + c, M.white, casingT);
  frame(o.offset + o.width, o.offset + o.width + c, 0.03, o.height + c, M.white, casingT);
  frame(o.offset - c, o.offset + o.width + c, o.height, o.height + c, M.white, casingT);
  const s = doorSwing(h, o);
  const leafMat = (o.id === "d-entry" ? M.anthracite : M.white).clone();
  const leaf = shadowed(new THREE.Mesh(edged(o.width - 0.04, o.height - 0.04, 0.04, 0.005), leafMat));
  const pivot = new THREE.Group();
  pivot.position.copy(P(s.hinge.x, 0, s.hinge.z));
  const closedAngle = Math.atan2(s.closedDir.z, s.closedDir.x);
  const openAngle = Math.atan2(s.openDir.z, s.openDir.x);
  let delta = openAngle - closedAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  pivot.rotation.y = closedAngle + delta * 0.45;
  leaf.position.set((o.width - 0.04) / 2 + 0.02, (o.height - 0.04) / 2 + 0.035, 0);
  pivot.add(leaf);
  for (const side of [-1, 1]) {
    const lever = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.018), M.chrome));
    lever.position.set(o.width - 0.12, 1.05, side * 0.045);
    pivot.add(lever);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 20), M.chrome);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(o.width - 0.07, 1.05, side * 0.025);
    pivot.add(rose);
  }
  finish.add(pivot);
  addTo(byElement, o.id, leaf);
  const outline = wallPiece(w, o.offset, o.offset + o.width, 0, o.height,
    new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0.35, depthWrite: false }));
  if (outline) {
    outline.castShadow = false;
    outline.scale.z = 1.05;
    ghost.add(outline);
    addTo(byElement, o.id, outline);
  }
}
