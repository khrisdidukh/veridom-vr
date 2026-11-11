import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
import { stageProgress } from "./edit/stages";
import { buildHouse, COLORS, type Built } from "./house/build";
import { M, setOnTextureLoad, solid } from "./house/materials";
import { Environment } from "./env/environment";
import { buildFurniture, setOnModelLoad } from "./furnish/pieces";
import { catalogById } from "./furnish/catalog";
import type { FurnitureItem } from "./house/model";
import { Store, type Selection } from "./state";
import { Panel } from "./ui/panel";
import { textPlane } from "./ui/label";
import { alignCornerAt, alignFromTwoPoints, footprint, headingDeg, loadSite, nudge, referenceCorner, rotateAround, roomAt, saveSite, whereAmI, worldToPlan, yawBetween, type Alignment, type WorldPoint } from "./site/align";
import { SiteXR } from "./site/xr";
import "./style.css";

const HAND_PROFILES = "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles/generic-hand/";
const MODEL_SCALE = 1 / 25;
const plan = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);

const store = new Store();
const app = document.getElementById("app")!;

// Renderer and scene.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Nothing moves on its own, so shadows are redrawn only when something changes.
renderer.shadowMap.autoUpdate = false;
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
// ?lite=1: a lighter mode for slower headsets (no shadows, slightly lower resolution).
const QUERY = new URLSearchParams(location.search);
const LITE = QUERY.has("lite");
if (LITE) {
  renderer.shadowMap.enabled = false;
  renderer.xr.setFramebufferScaleFactor(0.8);
}
app.appendChild(renderer.domElement);
const refreshShadows = () => (renderer.shadowMap.needsUpdate = true);

const scene = new THREE.Scene();
const env = new Environment(scene, renderer);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.02, 400);
camera.position.set(-7, 10, 13);

// World rig: pivot (placement, yaw, scale) → inner (plan offset) → house.
const pivot = new THREE.Group();
const inner = new THREE.Group();
pivot.add(inner);
scene.add(pivot);

let built: Built | null = null;
const HOUSE_CENTER = plan(6, 0, 4.5);
let walkTarget = new THREE.Vector2(2.2, 2.0); // plan x, z
let walkYaw = THREE.MathUtils.degToRad(-35);
const anchor = new THREE.Vector3(); // where the user stands, in XR space
const modelAnchor = new THREE.Vector3(0.1, 0.8, -0.75);
let worldScale = 1;
let passthrough = false;

// ——— On site: the house at 1:1 on the real plot. ———
// ?local=1 keeps the local-floor space even where the unbounded one is offered.
const siteXR = new SiteXR(renderer, !QUERY.has("local"));
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
/** Where the house stands in the XR space; null until it is placed. */
let siteAlign: Alignment | null = null;
let siteP1: WorldPoint | null = null;
let sitePreview: Alignment | null = null;
let sitePlaceAnchor = false;
let siteSaveTimer = 0;
const siteActive = () => store.s.mode === "site";
const sitePhase = () => store.s.site.phase;
const siteAligning = () => siteActive() && (sitePhase() === "corner" || sitePhase() === "direction");

// Night lights at the ceiling lamps.
const lampGroup = new THREE.Group();
inner.add(lampGroup);
const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
const snowMat = solid(0xf3f6f9, 0.85);

function rebuild() {
  if (built) inner.remove(built.root);
  built = buildHouse(store.s.house);
  inner.add(built.root);
  lampGroup.clear();
  env.lamps.length = 0;
  for (const p of built.lampPoints) {
    const l = new THREE.PointLight(0xffd9a8, 1, 0, 2);
    l.position.copy(p);
    lampGroup.add(l);
    env.lamps.push(l);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 14), glowMat);
    glow.position.copy(p);
    l.add(glow);
    glow.position.set(0, 0, 0);
  }
  applyState();
}

/** Opaque materials are compiled to ignore alpha, so switching needs a recompile. */
function setTransparent(m: THREE.Material, on: boolean) {
  if (m.transparent === on) return;
  m.transparent = on;
  m.needsUpdate = true;
}

function setEmissive(m: THREE.Mesh, color: number | null) {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  for (const mat of mats) {
    if (mat instanceof THREE.MeshStandardMaterial) {
      if (mat.userData.baseEmissive === undefined) {
        mat.userData.baseEmissive = mat.emissive.getHex();
        mat.userData.baseIntensity = mat.emissiveIntensity;
      }
      mat.emissive.set(color ?? mat.userData.baseEmissive);
      mat.emissiveIntensity = color ? 0.7 : mat.userData.baseIntensity;
    } else if (mat instanceof THREE.MeshBasicMaterial) {
      if (mat.userData.base === undefined) mat.userData.base = mat.color.getHex();
      mat.color.set(color ?? mat.userData.base);
    }
  }
}

// ——— Furniture layer: kept apart from the house so moving a chair doesn't rebuild walls. ———
type Placed = { item: FurnitureItem; group: THREE.Group; proxy: THREE.Mesh; meshes: () => THREE.Mesh[] };
const furnitureGroup = new THREE.Group();
inner.add(furnitureGroup);
const placed = new Map<string, Placed>();
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

function placeGroup(p: Placed, x: number, z: number, rot: number) {
  p.group.position.copy(plan(x, 0.03, z));
  p.group.rotation.y = THREE.MathUtils.degToRad(rot);
}

function syncFurniture() {
  const items = store.s.house.furniture;
  const ids = new Set(items.map((i) => i.id));
  for (const [id, p] of placed) {
    if (!ids.has(id)) {
      furnitureGroup.remove(p.group);
      placed.delete(id);
    }
  }
  for (const it of items) {
    let p = placed.get(it.id);
    if (!p || p.item.catalogId !== it.catalogId) {
      if (p) furnitureGroup.remove(p.group);
      const c = catalogById(it.catalogId);
      const group = new THREE.Group();
      group.add(buildFurniture(it.catalogId));
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(c?.w ?? 1, c?.h ?? 1, c?.d ?? 1), proxyMat);
      proxy.position.y = (c?.h ?? 1) / 2;
      proxy.userData = { pick: { type: "furniture", id: it.id } };
      group.add(proxy);
      furnitureGroup.add(group);
      const meshes = () => {
        const out: THREE.Mesh[] = [];
        group.traverse((o) => { if (o instanceof THREE.Mesh && o !== proxy) out.push(o); });
        return out;
      };
      p = { item: it, group, proxy, meshes };
      placed.set(it.id, p);
    }
    p.item = it;
    if (dragging?.id !== it.id) placeGroup(p, it.x, it.z, it.rot);
  }
}

function applyState() {
  if (!built) return;
  const s = store.s;
  const t = s.timeline;
  const prog = (i: number) => stageProgress(t, i);
  built.stageGroups.forEach((g, i) => (g.visible = prog(i) > 0.001));
  built.stageGroups[1]!.scale.y = Math.max(0.001, prog(1));
  built.stageGroups[2]!.scale.y = Math.max(0.001, prog(2));
  const site = s.mode === "site";
  const op = store.wallOpacity;
  built.ceiling.visible = s.mode === "walk" && prog(2) >= 1 && op > 0.01;
  // On the real plot the real ground is the ground: no lawn, no dug-out soil.
  if (site && renderer.xr.isPresenting && passthrough) built.stageGroups[0]!.visible = false;
  built.ghostWalls.visible = prog(2) < 1;
  built.roughIn.visible = prog(3) > 0 && (prog(4) < 0.5 || s.xray);
  built.stageGroups[4]!.visible = prog(4) >= 0.5;
  built.stageGroups[5]!.visible = prog(5) > 0.25;
  const wallMat = prog(4) >= 0.5 ? built.wallPlaster : built.wallBrick;
  // Wall opacity comes from the slider. See-through walls don't write depth, so
  // what stands behind them (frames, furniture, pipes) is never cut away.
  const solidWalls = op > 0.995;
  for (const m of [built.wallBrick, built.wallPlaster, built.ceilingMat]) {
    setTransparent(m, !solidWalls);
    m.opacity = solidWalls ? 1 : op;
    m.depthWrite = solidWalls;
  }
  for (const w of built.walls) {
    w.material = wallMat;
    w.visible = op > 0.01;
    w.castShadow = op > 0.5;
    w.renderOrder = solidWalls ? 0 : 1;
  }
  // Floors: optional and faint on site, so the layout reads on real ground.
  const faintFloor = site && renderer.xr.isPresenting && passthrough;
  for (const f of built.floors) f.visible = !site || s.site.showFloor;
  for (const m of built.floorMats) {
    setTransparent(m, faintFloor);
    m.opacity = faintFloor ? 0.6 : 1;
  }
  // At full size on a headset one shadow pass less keeps the frame rate up.
  env.shadows = !LITE && !(site && renderer.xr.isPresenting);
  built.grass.material = s.light.weather === "snow" ? snowMat : M.grass;

  syncFurniture();
  furnitureGroup.visible = prog(5) > 0.6;

  // Highlights: plan problems in orange, the selected element in cyan.
  const meshesFor = (id: string) => built!.byElement.get(id) ?? placed.get(id)?.meshes() ?? [];
  for (const meshes of built.byElement.values()) for (const m of meshes) setEmissive(m, null);
  for (const p of placed.values()) for (const m of p.meshes()) setEmissive(m, null);
  for (const f of s.findings) for (const id of f.elementIds) for (const m of meshesFor(id)) setEmissive(m, COLORS.highlight);
  if (s.selected) for (const m of meshesFor(s.selected.id)) setEmissive(m, COLORS.select);

  env.apply(s.light);
  panel.sunInfo = { elevation: env.sunElevation, azimuth: env.sunAzimuth };
  placeWorld();
  placeMarkers();
  refreshShadows();
}

// Floating markers above each plan problem, so they read from across the room and on the table model.
const markers = new THREE.Group();
inner.add(markers);
const markerGeo = new THREE.ConeGeometry(0.22, 0.5, 4);
markerGeo.rotateX(Math.PI);
const markerMat = new THREE.MeshBasicMaterial({ color: COLORS.highlight });
const markerBase = () => (store.s.mode !== "model" ? 2.15 : store.s.house.storeyHeight + 0.6);
function placeMarkers() {
  markers.clear();
  if (!built || store.s.timeline < 1) return;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const f of store.s.findings) {
    box.makeEmpty();
    for (const id of f.elementIds) {
      const meshes = built.byElement.get(id) ?? (placed.get(id) ? [placed.get(id)!.proxy] : []);
      for (const m of meshes) box.expandByObject(m);
    }
    if (box.isEmpty()) continue;
    const c = inner.worldToLocal(box.getCenter(new THREE.Vector3()));
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.position.set(c.x, markerBase(), c.z);
    m.scale.setScalar(store.s.mode !== "model" ? 0.3 : 1);
    markers.add(m);
  }
}

let desktopWalkSet = false;
function placeWorld() {
  const s = store.s;
  const xr = renderer.xr.isPresenting;
  if (s.mode === "model") {
    worldScale = xr ? MODEL_SCALE : 1;
    pivot.scale.setScalar(worldScale);
    pivot.position.copy(xr ? modelAnchor : new THREE.Vector3());
    pivot.rotation.set(0, THREE.MathUtils.degToRad(s.modelYaw), 0);
    inner.position.copy(HOUSE_CENTER).multiplyScalar(-1);
  } else if (s.mode === "site") {
    // The house stands where it was pegged; the wearer walks, the house doesn't move.
    const a = siteAlign ?? sitePreview ?? { x: 0, y: 0, z: 0, yaw: 0 };
    worldScale = 1;
    pivot.scale.setScalar(1);
    pivot.position.set(a.x, a.y, a.z);
    pivot.rotation.set(0, a.yaw, 0);
    inner.position.set(0, 0, 0);
  } else {
    worldScale = 1;
    pivot.scale.setScalar(1);
    pivot.position.set(xr ? anchor.x : 0, 0, xr ? anchor.z : 0);
    pivot.rotation.set(0, walkYaw, 0);
    inner.position.copy(plan(walkTarget.x, 0, walkTarget.y)).multiplyScalar(-1);
  }
  pivot.visible = s.mode !== "site" || (!!siteAlign && (s.site.phase === "adjust" || s.site.phase === "placed"));
  updateSiteGhost();
  pivot.updateMatrixWorld(true);
  // Shadow box around what you look at; lamps scaled with the world (light falls off with distance²).
  const centre = inner.localToWorld(HOUSE_CENTER.clone());
  env.focus(centre, 16 * worldScale, pivot.quaternion);
  for (const l of env.lamps) l.intensity = 9 * env.darkness * worldScale * worldScale;
  if (!xr) {
    if (s.mode !== "model") {
      if (!desktopWalkSet) {
        camera.position.set(0, 1.6, 0);
        controls.target.set(0, 1.55, -0.1);
        desktopWalkSet = true;
      }
    } else if (desktopWalkSet) {
      camera.position.set(-7, 10, 13);
      controls.target.set(0, 0, 0);
      desktopWalkSet = false;
    }
  }
}

// ——— On site: placing the house on the real ground. ———
const viewCam = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
/** Where the viewer's head is, and their level forward and right directions, in world space. */
function viewerAxes() {
  const head = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const cam = viewCam();
  cam.getWorldPosition(head);
  cam.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  return { head, fwd, side };
}

// The footprint drawn on the ground while aligning: outline, room walls, the
// corner pole you peg first and an arrow along the wall you sight along.
const siteGhost = new THREE.Group();
siteGhost.visible = false;
scene.add(siteGhost);
const ghostLabels: THREE.Mesh[] = [];
function buildSiteGhost() {
  const h = store.s.house;
  const f = footprint(h);
  const ref = referenceCorner(h);
  const basic = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  const cyan = basic(COLORS.select);
  const strip = (ax: number, az: number, bx: number, bz: number, w: number, mat: THREE.Material, y = 0.02) => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + w, 0.02, w), mat);
    m.position.copy(plan((ax + bx) / 2, y, (az + bz) / 2));
    m.rotation.y = Math.atan2(bz - az, bx - ax);
    siteGhost.add(m);
  };
  strip(f.min.x, f.min.z, f.max.x, f.min.z, 0.07, cyan);
  strip(f.max.x, f.min.z, f.max.x, f.max.z, 0.07, cyan);
  strip(f.max.x, f.max.z, f.min.x, f.max.z, 0.07, cyan);
  strip(f.min.x, f.max.z, f.min.x, f.min.z, 0.07, cyan);
  const inside = basic(0xffffff, 0.55);
  for (const w of h.walls.filter((x) => !x.exterior)) strip(w.a.x, w.a.z, w.b.x, w.b.z, 0.04, inside, 0.015);
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(f.max.x - f.min.x, f.max.z - f.min.z), basic(COLORS.select, 0.1));
  fill.rotation.x = -Math.PI / 2;
  fill.position.copy(plan((f.min.x + f.max.x) / 2, 0.01, (f.min.z + f.max.z) / 2));
  siteGhost.add(fill);
  // Corner pole, tall enough to line up with a real peg from a distance.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 12), cyan);
  pole.position.copy(plan(ref.corner.x, 0.7, ref.corner.z));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), cyan);
  knob.position.copy(plan(ref.corner.x, 1.4, ref.corner.z));
  siteGhost.add(pole, knob);
  // Arrow along the reference wall.
  const orange = basic(COLORS.highlight);
  const len = Math.min(3, f.max.x - f.min.x);
  const tip = { x: ref.corner.x + ref.dir.x * len, z: ref.corner.z + ref.dir.z * len };
  strip(ref.corner.x + ref.dir.x * 0.3, ref.corner.z + ref.dir.z * 0.3, tip.x, tip.z, 0.05, orange, 0.035);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 4), orange);
  head.scale.y = 1;
  head.rotation.set(0, Math.atan2(ref.dir.z, ref.dir.x), -Math.PI / 2);
  head.position.copy(plan(tip.x + ref.dir.x * 0.2, 0.04, tip.z + ref.dir.z * 0.2));
  siteGhost.add(head);
  const l1 = textPlane({ title: "1 · South-west corner" }, 0.8);
  l1.position.copy(plan(ref.corner.x, 1.6, ref.corner.z));
  const l2 = textPlane({ title: "2 · South wall runs this way", accent: "#ff8a1f" }, 0.8);
  l2.position.copy(plan(tip.x, 0.45, tip.z));
  ghostLabels.push(l1, l2);
  siteGhost.add(l1, l2);
}

function updateSiteGhost() {
  const a = siteAligning() ? sitePreview : sitePhase() === "adjust" ? siteAlign : null;
  siteGhost.visible = siteActive() && renderer.xr.isPresenting && !!a;
  if (!siteGhost.visible || !a) return;
  if (!siteGhost.children.length) buildSiteGhost();
  siteGhost.position.set(a.x, a.y, a.z);
  siteGhost.rotation.set(0, a.yaw, 0);
}

/** Yaw that lays the house out in front of the viewer, the reference wall running to their right. */
const yawFacingAway = () => {
  const { fwd } = viewerAxes();
  return Math.atan2(-fwd.x, -fwd.z);
};

function enterSite(): void {
  store.setMode("site", { view: "main", selected: null });
  if (!renderer.xr.isPresenting) {
    // On a computer there is no plot: stand in the living room, as in "Walk in".
    siteAlign = { x: -walkTarget.x, y: 0, z: walkTarget.y, yaw: 0 };
    store.setSite({ phase: "placed", hold: "session" });
    store.set({ message: "On site is for the headset on your plot. Here it shows the house at full size around the camera." });
    return;
  }
  siteXR.requestUnbounded();
  if (siteAlign && (sitePhase() === "placed" || sitePhase() === "adjust")) {
    store.setSite({});
    return;
  }
  const saved = loadSite(storage);
  if (!saved) return startAlign();
  siteAlign = { x: saved.x, y: saved.y, z: saved.z, yaw: saved.yaw };
  store.setSite({ phase: "placed", hold: "saved" });
  store.set({ message: "The house is back where you left it. If it is off, pinch Re-align." });
  if (saved.anchorId) {
    void siteXR.restore(saved.anchorId).then((ok) => {
      if (ok) store.setSite({ hold: "anchor" });
      else sitePlaceAnchor = true;
    });
  } else sitePlaceAnchor = true;
}

function startAlign(): void {
  if (!renderer.xr.isPresenting) return enterSite();
  siteXR.release();
  siteP1 = null;
  sitePreview = null;
  store.setSelectQuiet();
  store.setSite({ phase: "corner", hold: "session" });
  store.set({ message: "Point at the ground where the south-west corner will stand, and pinch." });
}

function setSiteCorner(p: WorldPoint) {
  siteP1 = p;
  const ref = referenceCorner(store.s.house);
  sitePreview = alignCornerAt(p, ref.corner, sitePreview?.yaw ?? yawFacingAway());
  store.setSite({ phase: "direction" });
  store.set({ message: "Now point further along the south wall and pinch." });
}

function setSiteDirection(p2: WorldPoint) {
  if (!siteP1) return;
  const ref = referenceCorner(store.s.house);
  if (yawBetween(siteP1, p2, ref.dir) === null) {
    store.set({ message: "That point is too close to the corner. Pick one at least a step away." });
    return;
  }
  siteAlign = alignFromTwoPoints(siteP1, p2, ref.corner, ref.dir);
  sitePreview = null;
  store.setSite({ phase: "adjust" });
  store.set({ message: "Check the corner pole and the arrow against your pegs, then pinch “Looks right”." });
}

function confirmSite() {
  if (!siteAlign) return;
  sitePlaceAnchor = true;
  saveSiteSoon();
  store.setSite({ phase: "placed" });
  store.set({ message: "The house stands. Walk through it — slowly, and mind what is really there." });
}

function saveSiteSoon() {
  clearTimeout(siteSaveTimer);
  siteSaveTimer = window.setTimeout(() => {
    if (siteAlign && renderer.xr.isPresenting) saveSite(storage, { ...siteAlign, anchorId: siteXR.anchorId, space: siteXR.spaceType, savedAt: Date.now() });
  }, 300);
}

/** Ground under a pointing ray: a real surface when the headset knows one, else the floor plane. */
function groundPoint(p: Pointer, ray: THREE.Ray): WorldPoint | null {
  const y = siteP1 && sitePhase() === "direction" ? siteP1.y : 0;
  const real = siteXR.hit(p.source, renderer.xr.getFrame());
  if (real && Math.abs(real.y - y) < 1.5) return sitePhase() === "direction" ? { ...real, y } : real;
  if (ray.direction.y > -0.02) return null;
  const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  return hit && hit.distanceTo(ray.origin) < 30 ? { x: hit.x, y, z: hit.z } : null;
}

/** Live preview of the footprint while a hand points at the ground. */
function previewSite(g: WorldPoint) {
  const ref = referenceCorner(store.s.house);
  if (sitePhase() === "corner") sitePreview = alignCornerAt(g, ref.corner, yawFacingAway());
  else if (siteP1) sitePreview = alignFromTwoPoints(siteP1, g, ref.corner, ref.dir, sitePreview?.yaw ?? 0);
  updateSiteGhost();
}

// The room under the wearer's feet, a few times a second.
let siteTrackAt = 0;
function trackSite(now: number) {
  if (!siteActive() || !siteAlign || now - siteTrackAt < 250) return;
  siteTrackAt = now;
  const { head, fwd } = viewerAxes();
  const h = store.s.house;
  const at = worldToPlan(siteAlign, head);
  const ahead = worldToPlan(siteAlign, { x: head.x + fwd.x, z: head.z + fwd.z });
  const here = whereAmI(h, at);
  const heading = Math.round(headingDeg(h, { x: ahead.x - at.x, z: ahead.z - at.z }) / 45) * 45 % 360;
  const st = store.s.site;
  if (here === st.here && heading === st.heading) return;
  const room = roomAt(h, at);
  if (room) store.s.roomId = room.id;
  // Only the panel shows this, so redraw it without rebuilding the scene state.
  store.s.site = { ...st, here, heading };
  panel.draw();
}

// Panel: canvas UI used by both the headset and the desktop.
const panel = new Panel(store, {
  enterRoom: (id) => {
    const r = store.s.house.rooms.find((x) => x.id === id);
    if (!r) return;
    walkTarget = new THREE.Vector2((r.min.x + r.max.x) / 2, (r.min.z + r.max.z) / 2);
    store.setMode("walk", { roomId: id });
  },
  turn: (deg) => {
    walkYaw += THREE.MathUtils.degToRad(deg);
    placeWorld();
    refreshShadows();
  },
  rotateModel: (deg) => store.set({ modelYaw: (store.s.modelYaw + deg) % 360 }),
  addFurniture: (catalogId) => addFurnitureInView(catalogId),
  site: {
    enter: () => enterSite(),
    realign: () => startAlign(),
    adjust: () => {
      if (!siteAlign) return;
      siteXR.release();
      store.setSite({ phase: "adjust", hold: "session" });
    },
    confirm: () => confirmSite(),
    nudge: (right, away, up) => {
      if (!siteAlign) return;
      const { fwd, side } = viewerAxes();
      siteAlign = nudge(siteAlign, side.x * right + fwd.x * away, side.z * right + fwd.z * away, up);
      placeWorld();
    },
    rotate: (deg) => {
      if (!siteAlign) return;
      siteAlign = rotateAround(siteAlign, deg, viewerAxes().head);
      placeWorld();
    },
    cornerAtFeet: () => {
      const { head } = viewerAxes();
      setSiteCorner({ x: head.x, y: 0, z: head.z });
    },
    wallAlongGaze: () => {
      if (!siteP1) return;
      const { fwd } = viewerAxes();
      setSiteDirection({ x: siteP1.x + fwd.x * 5, y: siteP1.y, z: siteP1.z + fwd.z * 5 });
    },
  },
});
panel.onExport = (text) => {
  navigator.clipboard?.writeText(text).then(
    () => store.set({ message: "Change requests copied — paste them into an email to your architect." }),
    () => store.set({ message: "Copy failed. Open the page on a computer to copy the list." }),
  );
};
const panelTexture = new THREE.CanvasTexture(panel.canvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
panelTexture.anisotropy = 4;
panel.onRedraw = () => (panelTexture.needsUpdate = true);
const PANEL_W = 0.46;
const panelMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(PANEL_W, PANEL_W / panel.aspect),
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, toneMapped: false, fog: false }),
);
panelMesh.visible = false;
panelMesh.renderOrder = 10;
scene.add(panelMesh);

/** Puts a new piece on the floor about 1.6 m in front of the viewer, facing them. */
function addFurnitureInView(catalogId: string) {
  const head = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(head);
  cam.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  let x: number, z: number;
  if (store.s.mode !== "model") {
    const spot = inner.worldToLocal(head.clone().addScaledVector(fwd, 1.6));
    x = spot.x;
    z = -spot.z;
  } else {
    const r = store.s.house.rooms.find((q) => q.id === store.s.roomId) ?? store.s.house.rooms[0]!;
    x = (r.min.x + r.max.x) / 2;
    z = (r.min.z + r.max.z) / 2;
  }
  const viewer = inner.worldToLocal(head.clone());
  const dx = viewer.x - x;
  const dz = -viewer.z - z;
  const rot = Math.round(THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) / 45) * 45;
  store.addFurniture(catalogId, x, z, rot);
}

// Desktop: the same canvas in the page.
panel.canvas.className = "panel";
document.body.appendChild(panel.canvas);
const canvasUV = (e: PointerEvent) => {
  const r = panel.canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
};
panel.canvas.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  panel.canvas.setPointerCapture(e.pointerId);
  panel.press(...canvasUV(e));
});
panel.canvas.addEventListener("pointermove", (e) => panel.dragTo(canvasUV(e)[0]));
panel.canvas.addEventListener("pointerup", () => panel.release());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const raycaster = new THREE.Raycaster();

function pickables(): THREE.Object3D[] {
  if (!built) return [];
  const list = [...built.pickables];
  if (furnitureGroup.visible) for (const p of placed.values()) list.push(p.proxy);
  return list;
}

function pickHit(rc: THREE.Raycaster): { sel: Selection; point: THREE.Vector3; distance: number } | null {
  const h = rc.intersectObjects(pickables(), false)[0];
  const sel = h?.object.userData.pick as Selection | undefined;
  return h && sel ? { sel, point: h.point, distance: h.distance } : null;
}

// ——— Dragging furniture along the floor (hand or mouse). ———
let dragging: { id: string; grab: THREE.Vector2; lastCommit: number; x: number; z: number } | null = null;

function floorHit(ray: THREE.Ray): THREE.Vector2 | null {
  const origin = inner.localToWorld(new THREE.Vector3(0, 0.03, 0));
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y);
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return null;
  const local = inner.worldToLocal(hit);
  return new THREE.Vector2(local.x, -local.z);
}

function startDrag(id: string, ray: THREE.Ray) {
  const item = store.s.house.furniture.find((f) => f.id === id);
  const at = floorHit(ray);
  if (!item || !at) return;
  dragging = { id, grab: new THREE.Vector2(item.x - at.x, item.z - at.y), lastCommit: 0, x: item.x, z: item.z };
}

function dragTo(ray: THREE.Ray) {
  if (!dragging) return;
  const at = floorHit(ray);
  const p = placed.get(dragging.id);
  if (!at || !p) return;
  dragging.x = THREE.MathUtils.clamp(at.x + dragging.grab.x, -1, 13);
  dragging.z = THREE.MathUtils.clamp(at.y + dragging.grab.y, -1, 10);
  placeGroup(p, dragging.x, dragging.z, p.item.rot);
  refreshShadows();
  const now = performance.now();
  if (now - dragging.lastCommit > 180) {
    dragging.lastCommit = now;
    store.moveFurniture(dragging.id, dragging.x, dragging.z);
  }
}

function endDrag() {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  store.moveFurniture(d.id, Math.round(d.x * 20) / 20, Math.round(d.z * 20) / 20);
}

// Desktop mouse: click selects; dragging a piece of furniture moves it.
let downAt = new THREE.Vector2();
const mouseRay = (e: PointerEvent) => {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.clone();
};
renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt.set(e.clientX, e.clientY);
  if (renderer.xr.isPresenting) return;
  const ray = mouseRay(e);
  const hit = pickHit(raycaster);
  if (hit?.sel.type === "furniture") {
    controls.enabled = false;
    store.select(hit.sel);
    startDrag(hit.sel.id, ray);
  }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (dragging) dragTo(mouseRay(e));
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (renderer.xr.isPresenting) return;
  controls.enabled = true;
  if (dragging) {
    endDrag();
    return;
  }
  if (downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 6) return; // was an orbit drag
  mouseRay(e);
  store.select(pickHit(raycaster)?.sel ?? null);
});

// XR: hands (and controllers, if any) give a ray; a pinch is "select".
const handFactory = new XRHandModelFactory().setPath(HAND_PROFILES);
type Pointer = {
  ctrl: THREE.Group;
  line: THREE.Line;
  cursor: THREE.Mesh;
  panelUV: THREE.Vector2 | null;
  floor: THREE.Vector3 | null;
  pick: Selection | null;
  dragging: boolean;
  draggingFurniture: boolean;
  /** The XR input behind this pointer, for hit-testing real surfaces. */
  source: XRInputSource | null;
  /** Where the ray meets the ground while the house is being placed. */
  ground: WorldPoint | null;
};
const pointers: Pointer[] = [];
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const teleportMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.24, 32),
  new THREE.MeshBasicMaterial({ color: COLORS.select, side: THREE.DoubleSide, toneMapped: false }),
);
teleportMarker.rotation.x = -Math.PI / 2;
teleportMarker.visible = false;
scene.add(teleportMarker);

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
  );
  ctrl.add(line);
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 12), new THREE.MeshBasicMaterial({ color: COLORS.select, toneMapped: false }));
  cursor.visible = false;
  scene.add(cursor);
  scene.add(ctrl);
  const p: Pointer = { ctrl, line, cursor, panelUV: null, floor: null, pick: null, dragging: false, draggingFurniture: false, source: null, ground: null };
  pointers.push(p);
  ctrl.addEventListener("connected", (e) => {
    p.source = (e as unknown as { data: XRInputSource }).data ?? null;
    if (p.source) siteXR.addInput(p.source);
  });
  ctrl.addEventListener("disconnected", () => {
    if (p.source) siteXR.removeInput(p.source);
    p.source = null;
  });
  ctrl.addEventListener("selectstart", () => {
    if (p.panelUV) {
      panel.press(p.panelUV.x, p.panelUV.y);
      p.dragging = panel.dragging;
    } else if (siteAligning()) {
      if (!p.ground) return;
      if (sitePhase() === "corner") setSiteCorner(p.ground);
      else setSiteDirection(p.ground);
    } else if (p.pick) {
      store.select(p.pick);
      if (p.pick.type === "furniture") {
        raycaster.setFromXRController(p.ctrl as unknown as THREE.XRTargetRaySpace);
        startDrag(p.pick.id, raycaster.ray);
        p.draggingFurniture = true;
      }
    } else if (store.s.mode === "walk" && p.floor) teleportTo(p.floor);
  });
  ctrl.addEventListener("selectend", () => {
    if (p.dragging) panel.release();
    if (p.draggingFurniture) endDrag();
    p.dragging = false;
    p.draggingFurniture = false;
  });
  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, "mesh"));
  scene.add(hand);
}

function teleportTo(worldPoint: THREE.Vector3) {
  // Convert the floor point to plan coordinates, then stand there.
  const local = inner.worldToLocal(worldPoint.clone());
  walkTarget = new THREE.Vector2(local.x, -local.z);
  const room = store.s.house.rooms.find((r) => walkTarget.x >= r.min.x && walkTarget.x <= r.max.x && walkTarget.y >= r.min.z && walkTarget.y <= r.max.z);
  store.set({ roomId: room?.id ?? store.s.roomId });
}

const tmpPanelInv = new THREE.Matrix4();
function updatePointers() {
  let anyFloor = false;
  for (const p of pointers) {
    p.panelUV = null;
    p.floor = null;
    p.pick = null;
    p.ground = null;
    p.cursor.visible = false;
    if (!p.ctrl.visible) continue;
    raycaster.setFromXRController(p.ctrl as unknown as THREE.XRTargetRaySpace);
    let dist = 3;
    if (p.draggingFurniture) {
      dragTo(raycaster.ray);
      const fh = floorHit(raycaster.ray);
      if (fh) dist = Math.min(8, inner.localToWorld(plan(fh.x, 0, fh.y)).distanceTo(raycaster.ray.origin));
      p.line.scale.z = dist;
      continue;
    }
    const ph = panelMesh.visible ? raycaster.intersectObject(panelMesh, false)[0] : undefined;
    if (p.dragging) {
      // Keep dragging a slider even when the ray slides off the panel.
      tmpPanelInv.copy(panelMesh.matrixWorld).invert();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(panelMesh.quaternion), panelMesh.position);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (hit) {
        const local = hit.clone().applyMatrix4(tmpPanelInv);
        panel.dragTo(local.x / PANEL_W + 0.5);
      }
    }
    if (ph?.uv) {
      p.panelUV = new THREE.Vector2(ph.uv.x, 1 - ph.uv.y);
      dist = ph.distance;
      p.cursor.position.copy(ph.point);
      p.cursor.visible = true;
    } else if (siteAligning()) {
      // Placing the house: the ray looks for the ground, nothing else.
      const g = groundPoint(p, raycaster.ray);
      if (g) {
        p.ground = g;
        previewSite(g);
        p.cursor.position.set(g.x, g.y + 0.01, g.z);
        p.cursor.visible = true;
        dist = p.cursor.position.distanceTo(raycaster.ray.origin);
      }
    } else {
      const hit = pickHit(raycaster);
      if (hit) {
        p.pick = hit.sel;
        dist = hit.distance;
        p.cursor.position.copy(hit.point);
        p.cursor.visible = true;
      } else if (store.s.mode === "walk") {
        const fp = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
        if (fp && fp.distanceTo(raycaster.ray.origin) < 12) {
          p.floor = fp;
          teleportMarker.position.set(fp.x, 0.04, fp.z);
          anyFloor = true;
          dist = fp.distanceTo(raycaster.ray.origin);
        }
      }
    }
    p.line.scale.z = dist;
  }
  teleportMarker.visible = anyFloor;
}

// Keep the panel low and to the left of the view; follow lazily when the head turns.
const headPos = new THREE.Vector3();
const headQuat = new THREE.Quaternion();
function placePanel(force = false, dt = 0.016) {
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(headPos);
  cam.getWorldQuaternion(headQuat);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const target = headPos.clone().addScaledVector(fwd, 0.5).addScaledVector(right, -0.24);
  target.y = headPos.y - 0.3;
  const toPanel = panelMesh.position.clone().sub(headPos).setY(0);
  const away = toPanel.length();
  toPanel.normalize();
  // Walking leaves the panel behind: bring it back within reach, but never while a hand is on it.
  const busy = pointers.some((p) => p.panelUV || p.dragging);
  const lost = toPanel.angleTo(fwd) > THREE.MathUtils.degToRad(55) || away > 0.85 || away < 0.25 || Math.abs(panelMesh.position.y - target.y) > 0.35;
  if (force || (lost && !busy)) panelGoal.copy(target);
  if (force) panelMesh.position.copy(target);
  else if (panelMesh.position.distanceToSquared(panelGoal) > 1e-6) panelMesh.position.lerp(panelGoal, Math.min(1, dt * 6));
  else return;
  panelMesh.lookAt(headPos);
}
const panelGoal = new THREE.Vector3();

let needInitialPlacement = false;
renderer.xr.addEventListener("sessionstart", () => {
  needInitialPlacement = true;
  panelMesh.visible = true;
  panel.canvas.style.display = "none";
  // Mixed reality: your real room replaces sky and clouds.
  const session = renderer.xr.getSession();
  passthrough = session?.environmentBlendMode === "alpha-blend" || session?.environmentBlendMode === "additive";
  env.group.visible = !passthrough;
  if (session) siteXR.start(session);
  for (const p of pointers) if (p.source) siteXR.addInput(p.source);
});
renderer.xr.addEventListener("sessionend", () => {
  panelMesh.visible = false;
  panel.canvas.style.display = "";
  env.group.visible = true;
  passthrough = false;
  siteXR.end();
  // The placement belongs to the headset session; the saved copy brings it back next time.
  siteAlign = sitePreview = siteP1 = null;
  store.s.site = { ...store.s.site, phase: "off", here: "" };
  if (store.s.mode === "site") store.setMode("model");
  else applyState();
});

store.on((_s, houseChanged) => (houseChanged ? rebuild() : applyState()));
setOnTextureLoad(() => refreshShadows());
setOnModelLoad(() => {
  refreshShadows();
  applyHighlightsSoon();
});
let hlTimer = 0;
function applyHighlightsSoon() {
  clearTimeout(hlTimer);
  hlTimer = window.setTimeout(() => applyState(), 120);
}
rebuild();

/** Anchor upkeep: create it when asked, and follow it when the headset refines where it is. */
function updateSiteXR() {
  const frame = renderer.xr.getFrame() as XRFrame | null;
  const tracked = siteXR.update(frame);
  if (sitePlaceAnchor && siteAlign && frame && sitePhase() === "placed") {
    sitePlaceAnchor = false;
    void siteXR.place(siteAlign, frame).then(() => {
      store.setSite({ hold: siteXR.anchorState === "none" ? "saved" : "anchor" });
      saveSiteSoon();
    });
  } else if (tracked && siteActive() && sitePhase() === "placed") {
    const a = siteAlign;
    if (!a || Math.abs(a.x - tracked.x) + Math.abs(a.y - tracked.y) + Math.abs(a.z - tracked.z) + Math.abs(a.yaw - tracked.yaw) > 1e-4) {
      siteAlign = tracked;
      placeWorld();
    }
  }
  if (siteGhost.visible) {
    viewCam().getWorldPosition(headPos);
    const wp = new THREE.Vector3();
    for (const l of ghostLabels) {
      // Readable from anywhere on the plot: the label grows with distance.
      l.scale.setScalar(Math.max(0.6, l.getWorldPosition(wp).distanceTo(headPos) * 0.4));
      l.lookAt(headPos);
    }
  }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (renderer.xr.isPresenting) {
    if (needInitialPlacement) {
      const cam = renderer.xr.getCamera();
      cam.getWorldPosition(headPos);
      if (headPos.lengthSq() > 0) {
        modelAnchor.set(headPos.x + 0.12, headPos.y - 0.45, headPos.z - 0.75);
        anchor.set(headPos.x, 0, headPos.z);
        placePanel(true);
        placeWorld();
        refreshShadows();
        needInitialPlacement = false;
      }
    } else placePanel(false, dt);
    updatePointers();
    updateSiteXR();
  } else controls.update();
  trackSite(performance.now());
  env.tick(dt);
  const bob = Math.sin(performance.now() / 300) * 0.08;
  markers.children.forEach((m) => {
    m.position.y = markerBase() + bob;
    m.rotation.y += 0.02;
  });
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Entry buttons: VR, and passthrough (MR) where the device supports it.
async function addEntryButtons() {
  const bar = document.getElementById("enter")!;
  const xr = navigator.xr;
  const note = () => {
    bar.innerHTML = `<p class="note">Open this page in the Meta Quest browser to step inside. On a computer, drag to look around and click a door, window or socket. <a href="?emulate=1">Try the headset emulator</a>.</p>`;
  };
  if (!xr) return note();
  // Everything beyond local-floor is optional: on site it adds real-surface hit-tests, anchors and large-area tracking.
  const init: XRSessionInit = { optionalFeatures: ["local-floor", "hand-tracking", "bounded-floor", "unbounded", "hit-test", "anchors"] };
  const start = async (mode: XRSessionMode) => {
    const session = await xr.requestSession(mode, init);
    renderer.xr.setReferenceSpaceType("local-floor");
    await renderer.xr.setSession(session);
  };
  for (const [mode, label] of [["immersive-ar", "Enter mixed reality"], ["immersive-vr", "Enter VR"]] as const) {
    if (await xr.isSessionSupported(mode).catch(() => false)) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => start(mode).catch((err) => store.set({ message: `Could not start: ${err.message ?? err}` }));
      bar.appendChild(b);
    }
  }
  if (!bar.children.length) note();
}
// ?emulate=1 installs a Meta Quest 3 emulator (IWER), so the headset flow can be tried on a computer.
async function boot() {
  if (new URLSearchParams(location.search).has("emulate")) {
    const { XRDevice, metaQuest3 } = await import("iwer");
    const device = new XRDevice(metaQuest3);
    device.installRuntime({ forceInstall: true });
    device.primaryInputMode = "hand";
    (window as unknown as { __xrDevice: unknown }).__xrDevice = device;
  }
  await addEntryButtons();
}
void boot();

// Expose for automated checks in the browser.
(window as unknown as { __veridom: unknown }).__veridom = {
  /** Stand at plan (x, z) looking yawDeg (0 = north, 90 = west). For screenshots and tests. */
  view: (x: number, z: number, yawDeg: number, pitch = -0.05) => {
    walkTarget = new THREE.Vector2(x, z);
    walkYaw = THREE.MathUtils.degToRad(yawDeg);
    store.setMode("walk");
    camera.position.set(0, 1.6, 0);
    controls.target.set(0, 1.6 + pitch, -0.1);
  },
  /** On-site state for automated checks. */
  site: () => ({ phase: sitePhase(), align: siteAlign, preview: sitePreview, here: store.s.site.here, heading: store.s.site.heading, hold: store.s.site.hold, anchor: siteXR.anchorState, anchorId: siteXR.anchorId, features: { ...siteXR.features }, space: siteXR.spaceType, passthrough }),
  enterSite, siteGhost,
  store, panel, panelMesh, THREE, renderer, pivot, env, camera, controls, placed, inner, pointers };
