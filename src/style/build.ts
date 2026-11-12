import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { solid } from "../house/materials";
import type { Dressing, Look } from "./styles";

// Builds the dressing pieces of a look: a rug, pictures and a floor lamp.
// Everything is drawn in code — a few boxes and three small canvas textures.

const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, -z);

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rugTexture(look: Look): THREE.Texture {
  return canvasTexture(256, 180, (ctx) => {
    ctx.fillStyle = look.rug.base;
    ctx.fillRect(0, 0, 256, 180);
    ctx.strokeStyle = look.rug.line;
    if (look.rug.pattern === "stripes") {
      ctx.lineWidth = 3;
      for (let x = 20; x < 256; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 180);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = look.rug.pattern === "frame" ? 6 : 3;
      ctx.strokeRect(14, 14, 228, 152);
      if (look.rug.pattern === "frame") {
        ctx.lineWidth = 2;
        ctx.strokeRect(28, 28, 200, 124);
        ctx.beginPath();
        ctx.ellipse(128, 90, 46, 30, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // A little weave, so it does not look printed.
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
      ctx.fillRect((i * 97) % 256, (i * 57) % 180, 2, 1);
    }
  });
}

/** An abstract picture from the look's palette; `seed` makes each one different but always the same. */
function artTexture(look: Look, seed: number): THREE.Texture {
  return canvasTexture(200, 140, (ctx) => {
    let s = seed * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pal = look.art.palette;
    ctx.fillStyle = pal[0]!;
    ctx.fillRect(0, 0, 200, 140);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = pal[1 + Math.floor(rnd() * (pal.length - 1))]!;
      ctx.globalAlpha = 0.75 + rnd() * 0.25;
      if (rnd() > 0.45) ctx.fillRect(rnd() * 150, rnd() * 100, 30 + rnd() * 90, 20 + rnd() * 70);
      else {
        ctx.beginPath();
        ctx.arc(30 + rnd() * 140, 30 + rnd() * 80, 14 + rnd() * 30, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
}

export function buildDressing(items: Dressing[], look: Look): THREE.Group {
  const g = new THREE.Group();
  g.name = "dressing";
  const frameMat = solid(look.art.frame, 0.4, look.art.frame === 0xc9a45c ? 0.8 : 0.1);
  items.forEach((it, i) => {
    if (it.kind === "rug") {
      const m = new THREE.Mesh(new RoundedBoxGeometry(it.w, 0.012, it.d, 1, 0.005), new THREE.MeshStandardMaterial({ map: rugTexture(look), roughness: 1 }));
      m.position.copy(P(it.x, 0.037, it.z));
      m.rotation.y = THREE.MathUtils.degToRad(it.rot);
      m.receiveShadow = true;
      g.add(m);
    } else if (it.kind === "art") {
      const holder = new THREE.Group();
      holder.position.copy(P(it.x, it.y, it.z));
      holder.rotation.y = it.rot;
      const n = look.art.count;
      const w = n === 2 ? (it.w - 0.15) / 2 : it.w;
      for (let k = 0; k < n; k++) {
        const x = n === 2 ? (k ? 1 : -1) * (w / 2 + 0.075) : 0;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w, it.h, 0.03), frameMat);
        frame.position.set(x, 0, 0.015);
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.07, it.h - 0.07), new THREE.MeshStandardMaterial({ map: artTexture(look, i * 3 + k + look.id.length), roughness: 0.9 }));
        pic.position.set(x, 0, 0.0312);
        holder.add(frame, pic);
      }
      g.add(holder);
    } else {
      const lamp = new THREE.Group();
      lamp.position.copy(P(it.x, 0.03, it.z));
      const metal = solid(look.art.frame === 0xd9c8a9 ? 0xd9c8a9 : look.art.frame, 0.4, 0.6);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.025, 20), metal);
      base.position.y = 0.0125;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), metal);
      pole.position.y = 0.75;
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.28, 20, 1, true), new THREE.MeshStandardMaterial({ color: look.lampShade, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffd9a8, emissiveIntensity: 0.25 }));
      shade.position.y = 1.52;
      shade.castShadow = base.castShadow = true;
      lamp.add(base, pole, shade);
      g.add(lamp);
    }
  });
  return g;
}

export function disposeDressing(g: THREE.Group) {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });
  g.removeFromParent();
}
