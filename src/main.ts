import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
import { stageProgress } from "./edit/stages";
import { buildHouse, COLORS, type Built } from "./house/build";
import type { Target } from "./edit/impact";
import { Store } from "./state";
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
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color(0xb9d3e6);
scene.background = sky;
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a4a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-14, 18, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.02, 200);
camera.position.set(-6, 14, 18);

// World rig: pivot (placement, yaw, scale) → inner (plan offset) → house.
const pivot = new THREE.Group();
const inner = new THREE.Group();
pivot.add(inner);
scene.add(pivot);
sun.target = pivot;

let built: Built | null = null;
const HOUSE_CENTER = plan(6, 0, 4.5);
let walkTarget = new THREE.Vector2(3.5, 3); // plan x, z
let walkYaw = 0;
const anchor = new THREE.Vector3(); // where the user stands, in XR space
const modelAnchor = new THREE.Vector3(0.1, 0.8, -0.75);

function rebuild() {
  if (built) inner.remove(built.root);
  built = buildHouse(store.s.house);
  inner.add(built.root);
  applyState();
}

function setEmissive(m: THREE.Mesh, color: number | null) {
  const mat = m.material as THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number; color?: THREE.Color };
  if (mat instanceof THREE.MeshStandardMaterial) {
    mat.emissive.set(color ?? 0x000000);
    mat.emissiveIntensity = color ? 0.7 : 0;
  } else if (mat instanceof THREE.MeshBasicMaterial) {
    if (mat.userData.base === undefined) mat.userData.base = mat.color.getHex();
    mat.color.set(color ?? mat.userData.base);
    mat.opacity = color ? 0.9 : mat.userData.baseOpacity ?? mat.opacity;
  }
}

function applyState() {
  if (!built) return;
  const s = store.s;
  const t = s.timeline;
  const prog = (i: number) => stageProgress(t, i);
  built.stageGroups.forEach((g, i) => (g.visible = prog(i) > 0.001));
  const slab = built.stageGroups[1]!;
  slab.scale.y = Math.max(0.001, prog(1));
  const shell = built.stageGroups[2]!;
  shell.scale.y = Math.max(0.001, prog(2));
  built.ceiling.visible = s.mode === "walk" && prog(2) >= 1;
  built.ghostWalls.visible = prog(2) < 1;
  built.roughIn.visible = prog(3) > 0 && (prog(4) < 0.5 || s.xray);
  built.stageGroups[4]!.visible = prog(4) >= 0.5;
  built.stageGroups[5]!.visible = prog(5) > 0.25;
  const wm = built.wallMaterial;
  wm.color.set(COLORS.brick).lerp(new THREE.Color(COLORS.plaster), prog(4));
  wm.transparent = s.xray;
  wm.opacity = s.xray ? 0.28 : 1;
  wm.depthWrite = !s.xray;

  // Highlights: plan problems in orange, the selected element in cyan.
  for (const meshes of built.byElement.values()) for (const m of meshes) setEmissive(m, null);
  for (const f of s.findings) for (const id of f.elementIds) for (const m of built.byElement.get(id) ?? []) setEmissive(m, COLORS.highlight);
  if (s.selected) for (const m of built.byElement.get(s.selected.id) ?? []) setEmissive(m, COLORS.select);
  placeWorld();
  placeMarkers();
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
    for (const id of f.elementIds) for (const m of built.byElement.get(id) ?? []) box.expandByObject(m);
    if (box.isEmpty()) continue;
    const c = inner.worldToLocal(box.getCenter(new THREE.Vector3()));
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.position.set(c.x, markerBase(), c.z);
    m.scale.setScalar(store.s.mode === "walk" ? 0.3 : 1);
    markers.add(m);
  }
}

function placeWorld() {
  const s = store.s;
  const xr = renderer.xr.isPresenting;
  if (s.mode === "model") {
    const scale = xr ? MODEL_SCALE : 1;
    pivot.scale.setScalar(scale);
    pivot.position.copy(xr ? modelAnchor : new THREE.Vector3());
    pivot.rotation.set(0, THREE.MathUtils.degToRad(s.modelYaw), 0);
    inner.position.copy(HOUSE_CENTER).multiplyScalar(-1);
  } else {
    pivot.scale.setScalar(1);
    pivot.position.set(xr ? anchor.x : 0, 0, xr ? anchor.z : 0);
    pivot.rotation.set(0, walkYaw, 0);
    inner.position.copy(plan(walkTarget.x, 0, walkTarget.y)).multiplyScalar(-1);
  }
  if (!xr) {
    if (s.mode === "walk") {
      controls.target.set(0, 1.6, -0.1);
      if (!desktopWalkSet) {
        camera.position.set(0, 1.6, 0);
        desktopWalkSet = true;
      }
    } else if (desktopWalkSet) {
      camera.position.set(-6, 14, 18);
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
  },
  rotateModel: (deg) => store.set({ modelYaw: (store.s.modelYaw + deg) % 360 }),
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
  new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true }),
);
panelMesh.visible = false;
scene.add(panelMesh);

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
controls.maxPolarAngle = Math.PI * 0.49;
let desktopWalkSet = false;

const raycaster = new THREE.Raycaster();
let downAt = new THREE.Vector2();
renderer.domElement.addEventListener("pointerdown", (e) => downAt.set(e.clientX, e.clientY));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (renderer.xr.isPresenting) return;
  if (downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 6) return; // was a drag
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = pickHit(raycaster);
  store.select(hit);
});

function pickHit(rc: THREE.Raycaster): Target | null {
  if (!built) return null;
  const hits = rc.intersectObjects(built.pickables, false);
  const h = hits[0];
  return (h?.object.userData.pick as Target | undefined) ?? null;
}

// XR: hands (and controllers, if any) give a ray; a pinch is "select".
const handFactory = new XRHandModelFactory().setPath(HAND_PROFILES);
type Pointer = {
  ctrl: THREE.Group;
  line: THREE.Line;
  cursor: THREE.Mesh;
  panelUV: THREE.Vector2 | null;
  floor: THREE.Vector3 | null;
  pick: Target | null;
  dragging: boolean;
};
const pointers: Pointer[] = [];
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const teleportMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.24, 32),
  new THREE.MeshBasicMaterial({ color: COLORS.select, side: THREE.DoubleSide }),
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
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 12), new THREE.MeshBasicMaterial({ color: COLORS.select }));
  cursor.visible = false;
  scene.add(cursor);
  scene.add(ctrl);
  const p: Pointer = { ctrl, line, cursor, panelUV: null, floor: null, pick: null, dragging: false };
  pointers.push(p);
  ctrl.addEventListener("selectstart", () => {
    if (p.panelUV) {
      panel.press(p.panelUV.x, p.panelUV.y);
      p.dragging = panel.dragging;
    } else if (p.pick) store.select(p.pick);
    else if (store.s.mode === "walk" && p.floor) teleportTo(p.floor);
  });
  ctrl.addEventListener("selectend", () => {
    if (p.dragging) panel.release();
    p.dragging = false;
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
    const ph = panelMesh.visible ? raycaster.intersectObject(panelMesh, false)[0] : undefined;
    if (p.dragging) {
      // Keep dragging the timeline even when the ray slides off the panel.
      tmpPanelInv.copy(panelMesh.matrixWorld).invert();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 0, 1).applyQuaternion(panelMesh.quaternion),
        panelMesh.position,
      );
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
      const target = pickHit(raycaster);
      if (target && built) {
        const h = raycaster.intersectObjects(built.pickables, false)[0]!;
        p.pick = target;
        dist = h.distance;
        p.cursor.position.copy(h.point);
        p.cursor.visible = true;
      } else if (store.s.mode === "walk") {
        const fp = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
        if (fp && fp.distanceTo(raycaster.ray.origin) < 12) {
          p.floor = fp;
          teleportMarker.position.set(fp.x, 0.02, fp.z);
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
  renderer.shadowMap.enabled = false;
  scene.background = renderer.xr.getSession()?.environmentBlendMode === "alpha-blend" ? null : sky;
});
renderer.xr.addEventListener("sessionend", () => {
  panelMesh.visible = false;
  panel.canvas.style.display = "";
  renderer.shadowMap.enabled = true;
  scene.background = sky;
  applyState();
});

store.on((_s, houseChanged) => (houseChanged ? rebuild() : applyState()));
rebuild();

renderer.setAnimationLoop(() => {
  if (renderer.xr.isPresenting) {
    if (needInitialPlacement) {
      const cam = renderer.xr.getCamera();
      cam.getWorldPosition(headPos);
      if (headPos.lengthSq() > 0) {
        modelAnchor.set(headPos.x + 0.12, headPos.y - 0.45, headPos.z - 0.75);
        anchor.set(headPos.x, 0, headPos.z);
        placePanel(true);
        placeWorld();
        needInitialPlacement = false;
      }
    } else placePanel();
    updatePointers();
  } else controls.update();
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
(window as unknown as { __veridom: unknown }).__veridom = { store, panel, panelMesh, THREE, renderer, pivot };
