import * as THREE from "three";
import { doorSwing } from "../edit/checks";
import { alongWall, wallById, wallFrame, wallLength, type House, type Opening, type Wall } from "./model";

// Builds the 3D house from plan data. Plan (x, z-north) maps to three.js
// (x, y, -z), so north points away from a viewer standing south of the house.

export type Built = {
  root: THREE.Group;
  stageGroups: THREE.Group[];
  wallMaterial: THREE.MeshStandardMaterial;
  ghostWalls: THREE.Group;
  roughIn: THREE.Group;
  ceiling: THREE.Group;
  pickables: THREE.Object3D[];
  /** Meshes per element id, for highlighting. */
  byElement: Map<string, THREE.Mesh[]>;
};

const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

export const COLORS = {
  grass: 0x6f8f4e,
  soil: 0x8a6d4f,
  concrete: 0x9a9a96,
  brick: 0xb5654a,
  plaster: 0xf1eee8,
  wood: 0xc79a6b,
  tiles: 0xd9dde0,
  cold: 0x2f7fe0,
  hot: 0xe0402f,
  drain: 0x6b6b6b,
  cable: 0xf2c230,
  glass: 0x9fc6e0,
  door: 0xe9e3d8,
  ceramic: 0xfafafa,
  counter: 0x3d3f45,
  fabric: 0x7d8796,
  highlight: 0xff8a1f,
  select: 0x29c4d6,
};

function addTo(map: Map<string, THREE.Mesh[]>, id: string, m: THREE.Mesh) {
  const list = map.get(id) ?? [];
  list.push(m);
  map.set(id, list);
}

/** A box between two plan points along a wall, from y0 to y1. */
function wallPiece(w: Wall, from: number, to: number, y0: number, y1: number, material: THREE.Material): THREE.Mesh | null {
  if (to - from < 0.01 || y1 - y0 < 0.01) return null;
  const { dir } = wallFrame(w);
  const len = to - from;
  const g = new THREE.BoxGeometry(len, y1 - y0, w.thickness);
  const m = new THREE.Mesh(g, material);
  const mid = alongWall(w, (from + to) / 2);
  m.position.copy(P(mid.x, (y0 + y1) / 2, mid.z));
  m.rotation.y = Math.atan2(dir.z, dir.x);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function boxAt(min: { x: number; z: number }, max: { x: number; z: number }, y0: number, y1: number, material: THREE.Material) {
  const g = new THREE.BoxGeometry(max.x - min.x, y1 - y0, max.z - min.z);
  const m = new THREE.Mesh(g, material);
  m.position.copy(P((min.x + max.x) / 2, (y0 + y1) / 2, (min.z + max.z) / 2));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function tube(points: THREE.Vector3[], radius: number, color: number) {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) curve.add(new THREE.LineCurve3(points[i]!, points[i + 1]!));
  const g = new THREE.TubeGeometry(curve, Math.max(4, points.length * 6), radius, 8, false);
  return new THREE.Mesh(g, mat(color, { roughness: 0.4, emissive: color, emissiveIntensity: 0.15 }));
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
  const stageGroups = Array.from({ length: 6 }, (_, i) => {
    const g = new THREE.Group();
    g.name = `stage-${i}`;
    root.add(g);
    return g;
  });
  const [plot, slab, shell, , plaster, finish] = stageGroups as [THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  const H = h.storeyHeight;

  // Stage 0 — plot, stakes and string lines marking the footprint.
  const grass = boxAt(h.plot.min, h.plot.max, -0.35, -0.3, mat(COLORS.grass));
  grass.receiveShadow = true;
  plot.add(grass);
  const outerMin = { x: -0.2, z: -0.2 };
  const outerMax = { x: 12.2, z: 9.2 };
  plot.add(boxAt({ x: outerMin.x - 0.6, z: outerMin.z - 0.6 }, { x: outerMax.x + 0.6, z: outerMax.z + 0.6 }, -0.34, -0.29, mat(COLORS.soil)));
  for (const [x, z] of [[outerMin.x, outerMin.z], [outerMax.x, outerMin.z], [outerMax.x, outerMax.z], [outerMin.x, outerMax.z]] as const) {
    plot.add(boxAt({ x: x - 0.04, z: z - 0.04 }, { x: x + 0.04, z: z + 0.04 }, -0.3, 0.5, mat(0xd8c08a)));
  }

  // Stage 1 — slab.
  const slabMesh = boxAt(outerMin, outerMax, -h.slabThickness, 0, mat(COLORS.concrete));
  slab.add(slabMesh);

  // Stage 2 — walls with openings; the same material turns into plaster at stage 4.
  const wallMaterial = mat(COLORS.brick);
  const ghostWalls = new THREE.Group();
  ghostWalls.name = "ghost-walls";
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  for (const w of h.walls) {
    const len = wallLength(w);
    const openings = h.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    const pieces: (THREE.Mesh | null)[] = [];
    for (const o of openings) {
      pieces.push(wallPiece(w, cursor, o.offset, 0, H, wallMaterial));
      pieces.push(wallPiece(w, o.offset, o.offset + o.width, 0, o.sill, wallMaterial));
      pieces.push(wallPiece(w, o.offset, o.offset + o.width, o.sill + o.height, H, wallMaterial));
      cursor = o.offset + o.width;
    }
    pieces.push(wallPiece(w, cursor, len, 0, H, wallMaterial));
    for (const p of pieces) if (p) shell.add(p);
    const ghost = wallPiece(w, 0, len, 0, H, ghostMat);
    if (ghost) ghostWalls.add(ghost);
  }
  root.add(ghostWalls);

  const ceiling = new THREE.Group();
  ceiling.name = "ceiling";
  ceiling.add(boxAt(outerMin, outerMax, H, H + 0.22, mat(0xdedad2)));
  shell.add(ceiling);

  // Openings: pick proxies always exist, so the owner can edit before anything is built.
  for (const o of h.openings) {
    const w = wallById(h, o.wallId);
    const proxy = wallPiece(w, o.offset, o.offset + o.width, o.sill, o.sill + o.height, new THREE.MeshBasicMaterial({ visible: false }));
    if (proxy) {
      proxy.scale.z = 1.6;
      proxy.userData = { pick: { type: o.kind, id: o.id } };
      root.add(proxy);
      pickables.push(proxy);
    }
    addOpeningFinish(h, o, finish, byElement, ghostWalls);
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
    arc.position.copy(P(s.hinge.x, 0.035, s.hinge.z));
    arc.userData.swingFor = d.id;
    slab.add(arc);
    addTo(byElement, d.id, arc);
  }

  // Stage 3 — rough-in: pipes, cables from the panel, wall boxes.
  const roughIn = stageGroups[3]!;
  for (const p of h.pipes) {
    const color = p.kind === "cold" ? COLORS.cold : p.kind === "hot" ? COLORS.hot : COLORS.drain;
    roughIn.add(tube(p.points.map((q) => P(q.x, q.y, q.z)), p.kind === "drain" ? 0.05 : 0.016, color));
  }
  const panel = wallFacePoint(h, h.panel.wallId, h.panel.offset, h.panel.side, 0.02);
  const panelBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.06), mat(0xc9c9c9));
  panelBox.position.copy(P(panel.x, h.panel.height, panel.z));
  panelBox.rotation.y = panel.rotY;
  roughIn.add(panelBox);
  const cableY = H - 0.15;
  for (const pt of h.points) {
    const f = wallFacePoint(h, pt.wallId, pt.offset, pt.side, -0.02);
    const pts = [
      P(panel.x, h.panel.height + 0.3, panel.z),
      P(panel.x, cableY, panel.z),
      P(f.x, cableY, f.z),
      P(f.x, pt.height, f.z),
    ];
    const c = tube(pts, 0.008, COLORS.cable);
    roughIn.add(c);
    addTo(byElement, pt.id, c);
    const boxMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), mat(0x2b5fa8));
    boxMesh.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.copy(P(f.x, pt.height, f.z));
    holder.rotation.y = f.rotY;
    holder.add(boxMesh);
    roughIn.add(holder);
  }

  // Stage 4 — plaster: same wall meshes, colour handled by the timeline. Wall points get a face plate.
  for (const pt of h.points) {
    const f = wallFacePoint(h, pt.wallId, pt.offset, pt.side, 0.012);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), mat(0xffffff, { roughness: 0.3 }));
    plate.position.copy(P(f.x, pt.height, f.z));
    plate.rotation.y = f.rotY;
    plaster.add(plate);
    addTo(byElement, pt.id, plate);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(plate.position);
    proxy.userData = { pick: { type: pt.kind, id: pt.id } };
    root.add(proxy);
    pickables.push(proxy);
  }

  // Stage 5 — finishes: floors and fixtures.
  for (const r of h.rooms) {
    finish.add(boxAt(r.min, r.max, 0, 0.03, mat(r.floor === "wood" ? COLORS.wood : COLORS.tiles, { roughness: r.floor === "wood" ? 0.7 : 0.35 })));
  }
  for (const f of h.fixtures) {
    const color =
      f.kind === "counter" ? COLORS.counter : f.kind === "sofa" || f.kind === "bed" ? COLORS.fabric : f.kind === "table" ? COLORS.wood : COLORS.ceramic;
    const m = boxAt(f.min, f.max, 0.03, 0.03 + Math.max(0.02, f.height), mat(color, { roughness: 0.5 }));
    finish.add(m);
    addTo(byElement, f.id, m);
    if (f.kind === "counter") {
      m.userData = { pick: { type: "counter", id: f.id } };
      pickables.push(m);
    }
  }

  return { root, stageGroups, wallMaterial, ghostWalls, roughIn, ceiling, pickables, byElement };
}

function addOpeningFinish(h: House, o: Opening, finish: THREE.Group, byElement: Map<string, THREE.Mesh[]>, ghost: THREE.Group) {
  const w = wallById(h, o.wallId);
  if (o.kind === "window") {
    const glass = wallPiece(w, o.offset + 0.03, o.offset + o.width - 0.03, o.sill + 0.03, o.sill + o.height - 0.03,
      new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.35, roughness: 0.05 }));
    if (glass) {
      glass.scale.z = 0.12;
      finish.add(glass);
      addTo(byElement, o.id, glass);
    }
    const outline = wallPiece(w, o.offset, o.offset + o.width, o.sill, o.sill + o.height,
      new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, depthWrite: false }));
    if (outline) {
      outline.scale.z = 1.05;
      ghost.add(outline);
      addTo(byElement, o.id, outline);
    }
    return;
  }
  // Door leaf, shown half open so the swing direction is visible.
  const s = doorSwing(h, o);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(o.width - 0.04, o.height - 0.02, 0.04), new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.6 }));
  const pivot = new THREE.Group();
  pivot.position.copy(P(s.hinge.x, 0, s.hinge.z));
  const closedAngle = Math.atan2(s.closedDir.z, s.closedDir.x);
  const openAngle = Math.atan2(s.openDir.z, s.openDir.x);
  let delta = openAngle - closedAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  pivot.rotation.y = closedAngle + delta * 0.45;
  leaf.position.set((o.width - 0.04) / 2 + 0.02, (o.height - 0.02) / 2 + 0.03, 0);
  pivot.add(leaf);
  finish.add(pivot);
  addTo(byElement, o.id, leaf);
  const outline = wallPiece(w, o.offset, o.offset + o.width, 0, o.height,
    new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0.35, depthWrite: false }));
  if (outline) {
    outline.scale.z = 1.05;
    ghost.add(outline);
    addTo(byElement, o.id, outline);
  }
}
