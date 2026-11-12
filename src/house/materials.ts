import * as THREE from "three";

// Physically based materials with real textures (CC0, Poly Haven). Textures
// load in the background; meshes render with the base colour until they arrive.
// UVs are generated in metres by worldUV(), so texture repeat is the tile size.

const loader = new THREE.TextureLoader();
const BASE = `${import.meta.env.BASE_URL}assets/tex/`;
const cache = new Map<string, THREE.Texture>();

function tex(file: string, srgb: boolean): THREE.Texture {
  const key = file + srgb;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = loader.load(`${BASE}${file}.webp`, () => onTextureLoad());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Called each time a texture finishes loading, so shadows and env can refresh. */
export let onTextureLoad: () => void = () => {};
export const setOnTextureLoad = (f: () => void) => (onTextureLoad = f);

type PbrOpts = { color?: number; roughness?: number; normalScale?: number; metalness?: number };

export function pbr(name: string, opts: PbrOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: tex(`${name}_diff`, true),
    normalMap: tex(`${name}_nor`, false),
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    roughnessMap: tex(`${name}_rough`, false),
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
  });
}

export const solid = (color: number, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** Shared materials. Created once; walls get their own clones for X-ray. */
export const M = {
  get parquet() { return once("parquet", () => pbr("parquet", { roughness: 0.9 })); },
  get tiles() { return once("tiles", () => pbr("tiles", { color: 0xf3f1ec, roughness: 0.7 })); },
  // Painted plaster: clean white paint, the texture only adds a faint relief.
  get plaster() {
    // A warm white: the room reads as lit by daylight, not by a grey sky.
    // The colour comes from a painted map: a wall is never one flat tone.
    return once("plaster", () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintedPlaster(), roughness: 0.9, normalMap: tex("plaster_nor", false), normalScale: new THREE.Vector2(0.3, 0.3) }));
  },
  get stucco() { return once("stucco", () => pbr("stucco", { color: 0xf4f1ea, normalScale: 0.6 })); },
  get brick() { return once("brick", () => pbr("brick", { color: 0xe8a27a })); },
  get concrete() { return once("concrete", () => pbr("concrete", { color: 0xcfcfcf })); },
  get grass() { return once("grass", () => pbr("grass")); },
  get soil() { return once("soil", () => pbr("soil")); },
  get oak() { return once("oak", () => pbr("oak", { roughness: 0.8 })); },
  get white() { return once("white", () => solid(0xf2f1ee, 0.45)); },
  get offWhite() { return once("offWhite", () => solid(0xe9e6e0, 0.6)); },
  get anthracite() { return once("anthracite", () => solid(0x2e3236, 0.45, 0.3)); },
  get blackMetal() { return once("blackMetal", () => solid(0x1c1d1f, 0.4, 0.6)); },
  get chrome() { return once("chrome", () => solid(0xd8dadc, 0.12, 1)); },
  get ceramic() {
    return once("ceramic", () => new THREE.MeshPhysicalMaterial({ color: 0xfbfbfa, roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.08 }));
  },
  get glass() {
    // A thin mirror: mostly clear, with the sky reflected in it. Cheaper on a headset than real transmission.
    return once("glass", () => new THREE.MeshStandardMaterial({ color: 0xeaf3f6, roughness: 0.04, metalness: 1, transparent: true, opacity: 0.24, envMapIntensity: 1, depthWrite: false, userData: { glass: true } }));
  },
  get stone() { return once("stone", () => solid(0x3a3b3d, 0.35, 0.05)); },
  get front() { return once("front", () => solid(0xe8e4dc, 0.55)); },
  get duvet() { return once("duvet", () => solid(0xc9ced3, 0.95)); },
  get accent() { return once("accent", () => solid(0x33566b, 0.9)); },
  get fabricGrey() { return once("fabricGrey", () => solid(0x9b968e, 0.95)); },
  get fabricSand() { return once("fabricSand", () => solid(0xcbbfae, 0.95)); },
  get linen() { return once("linen", () => solid(0xf0ede6, 0.9)); },
  get showerTiles() { return once("showerTiles", () => pbr("tiles", { color: 0xb9b7b2, roughness: 0.6 })); },
};

/**
 * Painted plaster, drawn in code: a warm white with soft clouding (how a roller
 * leaves it) and a fine grain. Tiles every 2.5 m without a visible seam.
 */
function paintedPlaster(): THREE.Texture {
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  // Seamless value noise: lattice points wrap around the tile.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lattice = (n: number) => Array.from({ length: n * n }, rnd);
  const octaves = [4, 9, 23].map((n) => ({ n, v: lattice(n) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (o: { n: number; v: number[] }, u: number, v: number) => {
    const x = u * o.n, y = v * o.n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const at = (i: number, j: number) => o.v[(((j % o.n) + o.n) % o.n) * o.n + (((i % o.n) + o.n) % o.n)]!;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const cloud = sample(octaves[0]!, u, v) * 0.6 + sample(octaves[1]!, u, v) * 0.3 + sample(octaves[2]!, u, v) * 0.1;
      const grain = rnd();
      const k = 1 + (cloud - 0.5) * 0.07 + (grain - 0.5) * 0.02;
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, 247 * k);
      img.data[i + 1] = Math.min(255, 242 * k);
      img.data[i + 2] = Math.min(255, 231 * k * (1 - (cloud - 0.5) * 0.02)); // darker patches are a touch warmer
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.4, 0.4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Recolours the shared materials for an interior look. Pieces built afterwards take the new colours. */
export function applyLook(colors: Record<string, number | [number, number, number]>, stoneRoughness: number) {
  for (const [key, tint] of Object.entries(colors)) {
    const m = (M as unknown as Record<string, THREE.MeshStandardMaterial>)[key];
    if (!m) continue;
    if (typeof tint === "number") m.color.set(tint);
    else m.color.setRGB(tint[0], tint[1], tint[2]);
  }
  M.stone.roughness = stoneRoughness;
}

const made = new Map<string, THREE.Material>();
function once<T extends THREE.Material>(k: string, f: () => T): T {
  let m = made.get(k) as T | undefined;
  if (!m) {
    m = f();
    made.set(k, m);
  }
  return m;
}

/**
 * Box-projected UVs in metres, from the mesh's position in its parent's space.
 * Each face picks the plane its normal points along. Call after the mesh is
 * positioned and rotated.
 */
export function worldUV(mesh: THREE.Mesh, tile = 1, offset = new THREE.Vector2()) {
  const g = mesh.geometry;
  mesh.updateMatrix();
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  if (!pos || !nor) return;
  const m = mesh.matrix;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
    else if (ax >= az) { u = p.z; v = p.y; }
    else { u = p.x; v = p.y; }
    uv[i * 2] = u / tile + offset.x;
    uv[i * 2 + 1] = v / tile + offset.y;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
