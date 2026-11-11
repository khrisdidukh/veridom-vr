import * as THREE from "three";

// Text in the air: small tags and footnote-style callouts with a leader line
// to the exact spot they explain. Drawn to a canvas, shown on a plane that
// turns to the viewer and keeps a readable size at any distance.

const PX = 640;
const PAD = 26;

export type LabelText = { title: string; lines?: string[]; accent?: string; foot?: string };

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const TITLE_FONT = "700 34px system-ui, sans-serif";
const LINE_FONT = "27px system-ui, sans-serif";
const FOOT_FONT = "600 23px system-ui, sans-serif";

/** Paints the text and returns a plane `width` metres wide; its height follows the text. */
export function textPlane(t: LabelText, width = 0.3): THREE.Mesh {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const inner = PX - PAD * 2;
  ctx.font = TITLE_FONT;
  const title = wrapLines(ctx, t.title, inner - 14);
  ctx.font = LINE_FONT;
  const body = (t.lines ?? []).flatMap((l) => wrapLines(ctx, l, inner));
  ctx.font = FOOT_FONT;
  const foot = t.foot ? wrapLines(ctx, t.foot, inner) : [];
  const h = PAD * 2 + title.length * 42 + (body.length ? 10 + body.length * 36 : 0) + (foot.length ? 14 + foot.length * 30 : 0);
  // A bare title gets a plate just wide enough for it.
  ctx.font = TITLE_FONT;
  const W = body.length || foot.length ? PX : Math.min(PX, Math.ceil(Math.max(...title.map((l) => ctx.measureText(l).width)) + PAD * 2 + 20));
  canvas.width = W;
  canvas.height = h;
  const accent = t.accent ?? "#29c4d6";
  ctx.fillStyle = "rgba(15, 18, 23, 0.94)";
  roundRect(ctx, 2, 2, W - 4, h - 4, 22);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRect(ctx, 2, 2, 12, h - 4, 6);
  ctx.fill();
  ctx.textBaseline = "top";
  let y = PAD;
  ctx.font = TITLE_FONT;
  ctx.fillStyle = "#ffffff";
  for (const l of title) {
    ctx.fillText(l, PAD + 6, y);
    y += 42;
  }
  if (body.length) {
    y += 10;
    ctx.font = LINE_FONT;
    ctx.fillStyle = "#d5dbe3";
    for (const l of body) {
      ctx.fillText(l, PAD + 6, y);
      y += 36;
    }
  }
  if (foot.length) {
    y += 14;
    ctx.font = FOOT_FONT;
    ctx.fillStyle = accent;
    for (const l of foot) {
      ctx.fillText(l, PAD + 6, y);
      y += 30;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry((width * W) / PX, (width * h) / PX),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, depthTest: false, depthWrite: false }),
  );
  mesh.renderOrder = 30;
  mesh.userData.heightRatio = h / PX;
  mesh.userData.widthRatio = W / PX;
  return mesh;
}

export function disposeTextPlane(m: THREE.Mesh) {
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
  m.geometry.dispose();
}

const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false, toneMapped: false });
const dotGeo = new THREE.SphereGeometry(1, 12, 10);

/**
 * A label with a leader line. `target` is the spot it explains, in world
 * space; the label floats beside it and is re-laid out every frame.
 */
export class Callout {
  readonly group = new THREE.Group();
  readonly target = new THREE.Vector3();
  /** Sideways and upward offset of the label from its target, in label widths. */
  offset = new THREE.Vector2(0.18, 0.22);
  /** Label width in metres per metre of viewing distance. */
  sizePerMetre = 0.34;
  private plane: THREE.Mesh;
  private line: THREE.Line;
  private dot: THREE.Mesh;

  constructor(text: LabelText, private accent = 0x29c4d6) {
    this.plane = textPlane({ ...text, accent: `#${accent.toString(16).padStart(6, "0")}` }, 1);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    this.line.renderOrder = 29;
    this.line.frustumCulled = false;
    this.dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: accent, depthTest: false, toneMapped: false, fog: false }));
    this.dot.renderOrder = 29;
    this.group.add(this.line, this.dot, this.plane);
  }

  /** Lays the label out for a viewer at `eye` whose view is turned by `quat`. */
  update(eye: THREE.Vector3, quat: THREE.Quaternion) {
    const d = Math.max(0.15, eye.distanceTo(this.target));
    const w = THREE.MathUtils.clamp(d * this.sizePerMetre, 0.05, 60);
    const h = w * (this.plane.userData.heightRatio as number);
    const pw = w * (this.plane.userData.widthRatio as number);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const sx = Math.sign(this.offset.x || 1);
    const pos = this.target.clone().addScaledVector(right, w * this.offset.x + (sx * pw) / 2).add(new THREE.Vector3(0, w * this.offset.y + h / 2, 0));
    this.plane.position.copy(pos);
    this.plane.quaternion.copy(quat);
    this.plane.scale.setScalar(w);
    this.dot.position.copy(this.target);
    this.dot.scale.setScalar(d * 0.008);
    // Leader: from the spot to the nearest bottom corner of the label.
    const corner = pos.clone().addScaledVector(right, (-sx * pw) / 2).add(new THREE.Vector3(0, -h / 2, 0));
    const a = this.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(0, this.target.x, this.target.y, this.target.z);
    a.setXYZ(1, corner.x, corner.y, corner.z);
    a.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    disposeTextPlane(this.plane);
    this.line.geometry.dispose();
    (this.dot.material as THREE.Material).dispose();
  }
}
