import * as THREE from "three";
import { M, solid } from "../house/materials";
import { ASSEMBLIES, thickness, type AssemblyId, type Layer, type LayerLook } from "./catalog";

// A sample of a wall, floor or roof pulled out of the house and slid apart
// into its real layers. Thicknesses are true to scale; the sample steps down
// in size towards the viewer, so every layer shows from the front too.

const speckle = (base: string, dots: string, n: number, seed: number) => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dots;
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.beginPath();
    ctx.arc(rnd() * 128, rnd() * 128, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const looks = new Map<LayerLook, THREE.MeshStandardMaterial>();
function lookMaterial(look: LayerLook): THREE.MeshStandardMaterial {
  let m = looks.get(look);
  if (m) return m;
  const make: Record<LayerLook, () => THREE.MeshStandardMaterial> = {
    plaster: () => solid(0xf1eee8, 0.9),
    brick: () => M.brick.clone(),
    eps: () => new THREE.MeshStandardMaterial({ map: speckle("#8f949a", "#c9ced4", 900, 3), roughness: 0.95 }),
    render: () => M.stucco.clone(),
    parquet: () => M.parquet.clone(),
    screed: () => Object.assign(M.concrete.clone(), { color: new THREE.Color(0xe2ded6) }),
    membrane: () => solid(0x1b1c1f, 0.55),
    concrete: () => M.concrete.clone(),
    xps: () => new THREE.MeshStandardMaterial({ map: speckle("#e7a9b5", "#f3c9d1", 300, 5), roughness: 0.9 }),
    gravel: () => new THREE.MeshStandardMaterial({ map: speckle("#8b8782", "#d8d4cc", 1600, 9), roughness: 1 }),
  };
  m = make[look]();
  looks.set(look, m);
  return m;
}

export type CutawaySlab = { layer: Layer; mesh: THREE.Mesh; closed: number; open: number; half: number };

export class Cutaway {
  /** Local axes: x along the surface, y up the sample, z through the build-up towards the viewer. */
  readonly group = new THREE.Group();
  readonly slabs: CutawaySlab[] = [];
  /** 0 closed, 1 fully slid apart. */
  t = 0;
  target = 1;
  readonly depth: number;

  /**
   * @param fromViewer true when the viewer stands on the room side (the room-side layer is nearest to them)
   * @param size edge length of the sample in metres
   * @param gap air between two layers when open
   * @param lift how far the whole sample comes out before it opens: 0 leaves the far layer where it is built
   */
  constructor(readonly assembly: AssemblyId, fromViewer: boolean, size = 0.9, gap = 0.12, lift = 0) {
    const a = ASSEMBLIES[assembly];
    // Nearest to the viewer first.
    const layers = fromViewer ? [...a.layers] : [...a.layers].reverse();
    const total = a.layers.reduce((s, l) => s + l.mm, 0) / 1000;
    this.depth = total;
    const n = layers.length;
    let cum = 0;
    layers.forEach((layer, k) => {
      const d = layer.mm / 1000;
      // Nearest is smallest; each layer behind it shows a border around it.
      const edge = size * (n === 1 ? 1 : 0.5 + (0.5 * k) / (n - 1));
      const geo = new THREE.BoxGeometry(edge, edge, Math.max(d, 0.003));
      const mesh = new THREE.Mesh(geo, lookMaterial(layer.look));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.info = { kind: "layer", assembly, layer: layer.id };
      // Closed: in its true place, the build-up centred on z = 0. Local +z looks at the viewer.
      const closed = total / 2 - cum - d / 2;
      cum += d;
      const open = closed + lift * total + (n - 1 - k) * gap + (lift ? gap : 0);
      mesh.position.set(0, 0, closed);
      this.group.add(mesh);
      this.slabs.push({ layer, mesh, closed, open, half: edge / 2 });
      if (layer.look === "screed") mesh.add(heatingLoop(edge, d));
    });
  }

  /** Advances the slide. Returns true while it is still moving. */
  step(dt: number): boolean {
    if (this.t === this.target) return false;
    const dir = Math.sign(this.target - this.t);
    this.t = THREE.MathUtils.clamp(this.t + dir * dt * 1.8, 0, 1);
    const e = this.t * this.t * (3 - 2 * this.t);
    // Layers leave one after another, nearest first.
    const n = this.slabs.length;
    this.slabs.forEach((s, k) => {
      const local = THREE.MathUtils.clamp(e * (1 + 0.5) - (0.5 * k) / n, 0, 1);
      s.mesh.position.z = THREE.MathUtils.lerp(s.closed, s.open, local);
    });
    return true;
  }

  get closedNow() {
    return this.t === 0 && this.target === 0;
  }

  tagFor(s: CutawaySlab) {
    return `${s.layer.name} · ${thickness(s.layer.mm)}`;
  }

  dispose() {
    this.group.removeFromParent();
    for (const s of this.slabs) s.mesh.geometry.dispose();
  }
}

/** Underfloor heating: a red pipe snaking through the screed, 15 cm apart. */
function heatingLoop(edge: number, d: number): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const m = edge / 2 - 0.05;
  const rows = Math.max(2, Math.floor((edge - 0.1) / 0.15));
  for (let i = 0; i <= rows; i++) {
    const y = -m + (2 * m * i) / rows;
    const xs = i % 2 ? [m, -m] : [-m, m];
    pts.push(new THREE.Vector3(xs[0]!, y, 0), new THREE.Vector3(xs[1]!, y, 0));
  }
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 4, 0.008, 6, false), solid(0xe0402f, 0.4, 0, { emissive: 0xe0402f, emissiveIntensity: 0.3 }));
  // Just proud of the viewer-side face, so the loop shows on the screed.
  tube.position.z = d / 2 + 0.002;
  tube.userData.info = { kind: "layer", assembly: "floor", layer: "screed" };
  return tube;
}
