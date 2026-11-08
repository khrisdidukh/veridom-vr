import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Merges static meshes under `root` that share a material into one mesh each,
 * to keep draw calls low on a headset. Meshes for which `keep` is true stay as
 * they are (they get highlighted, picked or animated on their own).
 */
export function mergeByMaterial(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o === root || Array.isArray(o.material) || keep(o)) return;
    const g = o.geometry as THREE.BufferGeometry;
    if (!g.getAttribute("position") || !g.getAttribute("normal")) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    let entry = groups.get(key);
    if (!entry) groups.set(key, (entry = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, meshes: [] }));
    entry.meshes.push(o);
  });
  const out: THREE.Mesh[] = [];
  for (const { material, cast, receive, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      let g = (m.geometry as THREE.BufferGeometry).clone();
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
      g.applyMatrix4(rootInv.clone().multiply(m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    for (const m of meshes) m.removeFromParent();
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}
