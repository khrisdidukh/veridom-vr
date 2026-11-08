import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { M, worldUV } from "../house/materials";
import { catalogById } from "./catalog";
import { mergeByMaterial } from "../house/merge";

// Furniture and sanitary pieces. Every builder returns a group standing on
// y = 0, centred on its footprint, with its front facing local +z.

const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const MODELS = `${import.meta.env.BASE_URL}assets/models/`;
const modelCache = new Map<string, Promise<THREE.Group>>();

export let onModelLoad: () => void = () => {};
export const setOnModelLoad = (f: () => void) => (onModelLoad = f);

function loadModel(name: string): Promise<THREE.Group> {
  let p = modelCache.get(name);
  if (!p) {
    p = gltf.loadAsync(`${MODELS}${name}.glb`).then((g) => g.scene);
    modelCache.set(name, p);
  }
  return p;
}

const rbox = (w: number, h: number, d: number, r: number, mat: THREE.Material) =>
  new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat);
const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const cyl = (r: number, h: number, mat: THREE.Material, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** Metre-based UVs for textured parts of pieces built in code (models bring their own). */
export function procUV(g: THREE.Object3D): THREE.Object3D {
  const tiled = new Map<THREE.Material, number>([[M.oak, 0.8], [M.tiles, 1.2], [M.showerTiles, 0.6], [M.parquet, 1.6]]);
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const tile = tiled.get(o.material);
    if (tile) worldUV(o, tile);
  });
  return g;
}

/** Model placeholders fill in later, so their meshes are never merged. */
function isStatic(m: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o = m.parent; o && o !== root; o = o.parent) if (o.userData.model) return false;
  return true;
}

/** Shadows on, and materials cloned (once per material) so one piece can be highlighted alone. */
export function finishPiece(g: THREE.Object3D): THREE.Object3D {
  const clones = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material) => {
    let c = clones.get(m);
    if (!c) clones.set(m, (c = m.clone()));
    return c;
  };
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    }
  });
  return g;
}

function sofa(): THREE.Group {
  const g = new THREE.Group();
  const W = 2.1, D = 0.95;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(cyl(0.025, 0.1, M.blackMetal), sx * (W / 2 - 0.12), 0.05, sz * (D / 2 - 0.12)));
  g.add(at(rbox(W, 0.26, D, 0.04, M.fabricGrey), 0, 0.23, 0));
  const seatW = (W - 0.36) / 2;
  for (const sx of [-1, 1]) g.add(at(rbox(seatW - 0.01, 0.16, 0.72, 0.06, M.fabricGrey), sx * (seatW / 2), 0.44, 0.1));
  g.add(at(rbox(W, 0.44, 0.2, 0.05, M.fabricGrey), 0, 0.58, -D / 2 + 0.1));
  for (const sx of [-1, 1]) {
    const c = at(rbox(seatW - 0.02, 0.4, 0.17, 0.07, M.fabricGrey), sx * (seatW / 2), 0.68, -D / 2 + 0.27);
    c.rotation.x = -0.15;
    g.add(c);
  }
  for (const sx of [-1, 1]) g.add(at(rbox(0.18, 0.56, D, 0.06, M.fabricGrey), sx * (W / 2 - 0.09), 0.38, 0));
  const pillow = at(rbox(0.42, 0.4, 0.13, 0.06, M.fabricSand), -0.62, 0.68, -0.18);
  pillow.rotation.set(-0.25, 0.25, 0.08);
  g.add(pillow);
  return g;
}

function bed(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.8, D = 2.1;
  g.add(at(box(W, 0.26, D - 0.1, M.oak), 0, 0.2, 0.05));
  g.add(at(rbox(W - 0.08, 0.22, D - 0.2, 0.05, M.linen), 0, 0.44, 0.06));
  const duvet = at(rbox(W - 0.02, 0.1, 1.4, 0.05, new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.95 })), 0, 0.58, 0.32);
  g.add(duvet);
  g.add(at(rbox(W - 0.02, 0.03, 0.4, 0.015, M.fabricSand), 0, 0.64, 0.7));
  for (const sx of [-1, 1]) {
    const p = at(rbox(0.7, 0.14, 0.42, 0.06, M.linen), sx * 0.42, 0.62, -0.72);
    p.rotation.x = -0.25;
    g.add(p);
  }
  g.add(at(rbox(W + 0.1, 0.85, 0.1, 0.03, M.fabricGrey), 0, 0.425, -D / 2 + 0.05));
  return g;
}

function chair(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rbox(0.45, 0.035, 0.44, 0.01, M.oak), 0, 0.46, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.025, 0.45, 0.025, M.blackMetal), sx * 0.2, 0.225, sz * 0.19));
  for (const sx of [-1, 1]) g.add(at(box(0.025, 0.4, 0.025, M.blackMetal), sx * 0.2, 0.66, -0.19));
  const back = at(rbox(0.44, 0.2, 0.025, 0.01, M.oak), 0, 0.76, -0.2);
  back.rotation.x = 0.08;
  g.add(back);
  return g;
}

function diningSet(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rbox(1.6, 0.04, 0.9, 0.012, M.oak), 0, 0.74, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.05, 0.72, 0.05, M.blackMetal), sx * 0.72, 0.36, sz * 0.37));
  // Chairs face the table: the ones in front turn round.
  for (const sx of [-0.4, 0.4]) {
    const front = at(chair(), sx, 0, 0.62);
    front.rotation.y = Math.PI;
    g.add(front, at(chair(), sx, 0, -0.62));
  }
  return g;
}

function wardrobe(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.6, D = 0.62, H = 2.2;
  g.add(at(box(W, H - 0.08, D, M.white), 0, 0.08 + (H - 0.08) / 2, 0));
  g.add(at(box(W - 0.04, 0.08, D - 0.06, M.anthracite), 0, 0.04, -0.02));
  for (let i = 1; i < 3; i++) g.add(at(box(0.004, H - 0.12, 0.004, M.anthracite), -W / 2 + (W * i) / 3, 0.08 + (H - 0.08) / 2, D / 2 + 0.002));
  for (const x of [-W / 6 + 0.04, W / 6 - 0.04, W / 2 - 0.06]) g.add(at(box(0.016, 0.42, 0.02, M.blackMetal), x, 1.1, D / 2 + 0.015));
  return g;
}

function desk(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rbox(1.4, 0.03, 0.7, 0.01, M.oak), 0, 0.735, 0));
  for (const sx of [-1, 1]) {
    g.add(at(box(0.04, 0.72, 0.04, M.blackMetal), sx * 0.66, 0.36, 0.3));
    g.add(at(box(0.04, 0.72, 0.04, M.blackMetal), sx * 0.66, 0.36, -0.3));
    g.add(at(box(0.04, 0.04, 0.64, M.blackMetal), sx * 0.66, 0.06, 0));
  }
  const lamp = new THREE.Group();
  at(lamp, 0.5, 0.75, -0.22);
  lamp.rotation.y = -0.6;
  attachModel(lamp, "desk_lamp_arm_01");
  g.add(lamp);
  const laptop = new THREE.Group();
  laptop.add(at(rbox(0.32, 0.012, 0.22, 0.004, M.chrome), 0, 0.006, 0));
  const screen = at(rbox(0.32, 0.21, 0.008, 0.004, M.chrome), 0, 0.11, -0.11);
  screen.rotation.x = -0.25;
  laptop.add(screen);
  laptop.add(at(box(0.29, 0.18, 0.001, new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.2 })), 0, 0.11, -0.104).rotateX(-0.25));
  g.add(at(laptop, -0.1, 0.75, 0.02));
  return g;
}

/** Puts a GLB model into a placeholder group once it has loaded. */
function attachModel(holder: THREE.Group, name: string, scale = 1, rotDeg = 0) {
  holder.userData.model = name;
  loadModel(name).then((scene) => {
    const m = scene.clone(true);
    m.scale.setScalar(scale);
    m.rotation.y = (rotDeg * Math.PI) / 180;
    holder.add(finishPiece(m));
    onModelLoad();
  }).catch(() => { /* the piece stays empty if the file is missing */ });
}

const BUILDERS: Record<string, () => THREE.Group> = { sofa, bed, "dining-set": diningSet, wardrobe, desk };

/** A placed furniture piece, front along local +z. */
export function buildFurniture(catalogId: string): THREE.Group {
  const c = catalogById(catalogId);
  const build = BUILDERS[catalogId];
  if (build) {
    const g = procUV(build());
    mergeByMaterial(g, (m) => m.parent !== g && !isStatic(m, g));
    return finishPiece(g) as THREE.Group;
  }
  const holder = new THREE.Group();
  if (c?.glb) attachModel(holder, c.glb, c.scale ?? 1, c.modelRot ?? 0);
  return holder;
}

// ——— Fixed bathroom and kitchen pieces. w = width along the back wall, d = depth. ———

export function buildCounter(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const front = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55 });
  g.add(at(box(w, 0.1, d - 0.06, M.anthracite), 0, 0.05, -0.03));
  g.add(at(box(w, h - 0.14, d - 0.03, front), 0, 0.1 + (h - 0.14) / 2, -0.015));
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 1; i < n; i++) g.add(at(box(0.004, h - 0.16, 0.004, M.anthracite), -w / 2 + (w * i) / n, 0.1 + (h - 0.14) / 2, d / 2 + 0.001));
  for (let i = 0; i < n; i++) g.add(at(box(0.3, 0.012, 0.02, M.blackMetal), -w / 2 + (w * (i + 0.5)) / n, h - 0.12, d / 2 + 0.012));
  g.add(at(box(w + 0.02, 0.04, d + 0.03, M.stone), 0, h - 0.02, 0.015));
  // Sink with tap, and an induction hob.
  g.add(at(box(0.5, 0.005, 0.4, M.chrome), -w / 4, h + 0.001, 0));
  const tap = new THREE.Group();
  tap.add(at(cyl(0.018, 0.3, M.chrome), 0, 0.15, 0));
  const spout = at(cyl(0.012, 0.2, M.chrome), 0, 0.3, 0.09);
  spout.rotation.x = Math.PI / 2;
  tap.add(spout);
  g.add(at(tap, -w / 4, h, -d / 2 + 0.1));
  g.add(at(box(0.58, 0.006, 0.5, new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.08, clearcoat: 1 })), w / 4, h + 0.003, 0));
  return g;
}

export function buildWc(): THREE.Group {
  const g = new THREE.Group();
  // Pre-wall with the cistern, then a wall-hung bowl.
  g.add(at(box(0.8, 1.1, 0.25, M.tiles), 0, 0.55, -0.24));
  g.add(at(rbox(0.24, 0.16, 0.012, 0.01, M.chrome), 0, 1.0, -0.11));
  g.add(at(rbox(0.36, 0.3, 0.52, 0.12, M.ceramic), 0, 0.27, 0.13));
  g.add(at(rbox(0.37, 0.025, 0.47, 0.02, M.ceramic), 0, 0.43, 0.15));
  return g;
}

export function buildSink(w: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(w, 0.4, 0.44, M.oak), 0, 0.62, 0));
  g.add(at(rbox(w + 0.02, 0.07, 0.47, 0.02, M.ceramic), 0, 0.855, 0.01));
  const tap = new THREE.Group();
  tap.add(at(cyl(0.016, 0.16, M.chrome), 0, 0.08, 0));
  const spout = at(cyl(0.01, 0.12, M.chrome), 0, 0.16, 0.05);
  spout.rotation.x = Math.PI / 2;
  tap.add(spout);
  g.add(at(tap, 0, 0.89, -0.17));
  const mirror = at(box(w, 0.7, 0.01, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 })), 0, 1.55, -0.22);
  g.add(mirror);
  return g;
}

/** Shower tray and glass; w and d are the tray size, glass on the open front. */
export function buildShower(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(w, 0.012, d, M.showerTiles), 0, 0.036, 0));
  g.add(at(box(0.6, 0.004, 0.05, M.chrome), 0, 0.043, d / 2 - 0.15));
  g.add(at(box(w * 0.75, 2.0, 0.008, M.glass), -w * 0.125, 1.04, d / 2));
  g.add(at(box(0.02, 2.0, 0.03, M.chrome), -w / 2 + 0.01, 1.04, d / 2));
  const head = at(cyl(0.12, 0.012, M.chrome, 32), 0, 2.15, -d / 2 + 0.35);
  g.add(head);
  const arm = at(box(0.02, 0.02, 0.35, M.chrome), 0, 2.16, -d / 2 + 0.17);
  g.add(arm);
  // Wall tiles on the two wet walls behind the tray.
  g.add(at(box(w, 2.1, 0.012, M.showerTiles), 0, 1.08, -d / 2 + 0.006));
  return g;
}

export function buildCeilingLamp(): THREE.Group {
  const holder = new THREE.Group();
  attachModel(holder, "modern_ceiling_lamp_01");
  return holder;
}
