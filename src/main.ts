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
const LITE = new URLSearchParams(location.search).has("lite");
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
  built.ceiling.visible = s.mode === "walk" && prog(2) >= 1;
  built.ghostWalls.visible = prog(2) < 1;
  built.roughIn.visible = prog(3) > 0 && (prog(4) < 0.5 || s.xray);
  built.stageGroups[4]!.visible = prog(4) >= 0.5;
  built.stageGroups[5]!.visible = prog(5) > 0.25;
  const wallMat = prog(4) >= 0.5 ? built.wallPlaster : built.wallBrick;
  for (const m of [built.wallBrick, built.wallPlaster]) {
    m.transparent = s.xray;
    m.opacity = s.xray ? 0.25 : 1;
    m.depthWrite = !s.xray;
  }
  for (const w of built.walls) w.material = wallMat;
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
const markerBase = () => (store.s.mode === "walk" ? 2.15 : store.s.house.storeyHeight + 0.6);
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
    m.scale.setScalar(store.s.mode === "walk" ? 0.3 : 1);
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
  } else {
    worldScale = 1;
    pivot.scale.setScalar(1);
    pivot.position.set(xr ? anchor.x : 0, 0, xr ? anchor.z : 0);
    pivot.rotation.set(0, walkYaw, 0);
    inner.position.copy(plan(walkTarget.x, 0, walkTarget.y)).multiplyScalar(-1);
  }
  pivot.updateMatrixWorld(true);
  // Shadow box around what you look at; lamps scaled with the world (light falls off with distance²).
  const centre = inner.localToWorld(HOUSE_CENTER.clone());
  env.focus(centre, 16 * worldScale);
  for (const l of env.lamps) l.intensity = 9 * env.darkness * worldScale * worldScale;
  if (!xr) {
    if (s.mode === "walk") {
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

// Panel: canvas UI used by both the headset and the desktop.
const panel = new Panel(store, {
  enterRoom: (id) => {
    const r = store.s.house.rooms.find((x) => x.id === id);
    if (!r) return;
    walkTarget = new THREE.Vector2((r.min.x + r.max.x) / 2, (r.min.z + r.max.z) / 2);
    store.set({ roomId: id, mode: "walk" });
  },
  turn: (deg) => {
    walkYaw += THREE.MathUtils.degToRad(deg);
    placeWorld();
    refreshShadows();
  },
  rotateModel: (deg) => store.set({ modelYaw: (store.s.modelYaw + deg) % 360 }),
  addFurniture: (catalogId) => addFurnitureInView(catalogId),
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
  if (store.s.mode === "walk") {
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
  const p: Pointer = { ctrl, line, cursor, panelUV: null, floor: null, pick: null, dragging: false, draggingFurniture: false };
  pointers.push(p);
  ctrl.addEventListener("selectstart", () => {
    if (p.panelUV) {
      panel.press(p.panelUV.x, p.panelUV.y);
      p.dragging = panel.dragging;
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
function placePanel(force = false) {
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(headPos);
  cam.getWorldQuaternion(headQuat);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const target = headPos.clone().addScaledVector(fwd, 0.5).addScaledVector(right, -0.24);
  target.y = headPos.y - 0.3;
  const toPanel = panelMesh.position.clone().sub(headPos).setY(0).normalize();
  if (force || toPanel.angleTo(fwd) > THREE.MathUtils.degToRad(55)) {
    panelMesh.position.copy(target);
    panelMesh.lookAt(headPos);
  }
}

let needInitialPlacement = false;
renderer.xr.addEventListener("sessionstart", () => {
  needInitialPlacement = true;
  panelMesh.visible = true;
  panel.canvas.style.display = "none";
  // Mixed reality: your real room replaces sky and clouds.
  const passthrough = renderer.xr.getSession()?.environmentBlendMode === "alpha-blend";
  env.group.visible = !passthrough;
});
renderer.xr.addEventListener("sessionend", () => {
  panelMesh.visible = false;
  panel.canvas.style.display = "";
  env.group.visible = true;
  applyState();
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
    } else placePanel();
    updatePointers();
  } else controls.update();
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
  const init: XRSessionInit = { optionalFeatures: ["local-floor", "hand-tracking", "bounded-floor"] };
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
    store.set({ mode: "walk" });
    camera.position.set(0, 1.6, 0);
    controls.target.set(0, 1.6 + pitch, -0.1);
  },
  store, panel, panelMesh, THREE, renderer, pivot, env, camera, controls, placed, inner, pointers };
