import * as THREE from "three";
import { wallFrame, type Wall } from "./model";

// Cheap ambient occlusion, drawn instead of computed: a soft dark band where
// a wall meets the floor or the ceiling, and a soft blob under each piece of
// furniture. Two textures, a handful of quads, no extra render passes.

function gradientTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(4, 64);
  for (let y = 0; y < 64; y++) {
    // Row 0 is the far edge (clear), the last row touches the wall (dark).
    const t = y / 63;
    const a = Math.pow(t, 2.2);
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function blobTexture(): THREE.Texture {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Distance to a centred rounded rectangle: dark inside, fading over the outer quarter.
      const u = Math.abs(x / (n - 1) - 0.5) * 2;
      const v = Math.abs(y / (n - 1) - 0.5) * 2;
      const dx = Math.max(0, u - 0.62) / 0.38;
      const dy = Math.max(0, v - 0.62) / 0.38;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = (1 - d) * (1 - d) * (3 - 2 * (1 - d)); // smoothstep
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

let bandMat: THREE.MeshBasicMaterial | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
const shade = (map: THREE.Texture, opacity: number) =>
  new THREE.MeshBasicMaterial({ map, color: 0x1a140f, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

export type WallRun = { wall: Wall; from: number; to: number };

/**
 * One mesh of soft bands along the given wall runs, lying flat at height y,
 * on both faces of each wall (only the room face of an exterior wall).
 */
export function occlusionBands(runs: WallRun[], y: number, width = 0.42, roomSide: (w: Wall) => 1 | -1 | 0 = () => 0): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const { wall, from, to } of runs) {
    if (to - from < 0.02) continue;
    const { dir, left } = wallFrame(wall);
    const only = roomSide(wall);
    for (const s of [1, -1] as const) {
      if (only !== 0 && s !== only) continue;
      const near = wall.thickness / 2;
      const far = near + width;
      const p = (along: number, across: number) => [wall.a.x + dir.x * along + left.x * across * s, y, -(wall.a.z + dir.z * along + left.z * across * s)];
      const base = pos.length / 3;
      pos.push(...p(from, near), ...p(to, near), ...p(to, far), ...p(from, far));
      // flipY puts canvas row 0 at v = 1: v = 0 (dark) at the wall, v = 1 (clear) away from it.
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  bandMat ??= shade(gradientTexture(), 0.62);
  const m = new THREE.Mesh(g, bandMat);
  m.renderOrder = 3;
  m.name = "occlusion";
  return m;
}

const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** A soft contact shadow for a piece with a w × d footprint, to lay on the floor under it. */
export function contactShadow(w: number, d: number): THREE.Mesh {
  blobMat ??= shade(blobTexture(), 0.62);
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.set(w * 1.25 + 0.12, 1, d * 1.25 + 0.12);
  m.renderOrder = 3;
  m.name = "contact-shadow";
  return m;
}
