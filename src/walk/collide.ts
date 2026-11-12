import { wallFrame, type House, type Vec2 } from "../house/model";

// Walking on a laptop or phone: the walker is a small circle on the plan that
// cannot pass through walls, but can through doors and floor-length glazing.

export type Blocker = { a: Vec2; b: Vec2; half: number };
export const BODY_RADIUS = 0.22;

/** The solid stretches of every wall: the wall minus its doors and floor-length windows. */
export function blockers(h: House): Blocker[] {
  const out: Blocker[] = [];
  for (const w of h.walls) {
    const { len, dir } = wallFrame(w);
    const gaps = h.openings
      .filter((o) => o.wallId === w.id && (o.kind === "door" || o.sill <= 0.05))
      .map((o) => [o.offset, o.offset + o.width] as const)
      .sort((p, q) => p[0] - q[0]);
    let from = 0;
    const add = (s: number, e: number) => {
      if (e - s > 0.02) out.push({ a: { x: w.a.x + dir.x * s, z: w.a.z + dir.z * s }, b: { x: w.a.x + dir.x * e, z: w.a.z + dir.z * e }, half: w.thickness / 2 });
    };
    for (const [s, e] of gaps) {
      add(from, s);
      from = Math.max(from, e);
    }
    add(from, len);
  }
  return out;
}

/** Pushes a point out of every blocker it overlaps. */
export function pushOut(list: Blocker[], p: Vec2, radius = BODY_RADIUS): Vec2 {
  let x = p.x, z = p.z;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const s of list) {
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2));
      const qx = s.a.x + dx * t, qz = s.a.z + dz * t;
      const d = Math.hypot(x - qx, z - qz);
      const min = s.half + radius;
      if (d >= min) continue;
      if (d > 1e-6) {
        x = qx + ((x - qx) / d) * min;
        z = qz + ((z - qz) / d) * min;
      } else {
        // Exactly on the centre line: leave along the wall's normal.
        const l = Math.sqrt(l2);
        x = qx - (dz / l) * min;
        z = qz + (dx / l) * min;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** Walks from `from` towards `to` in small steps, sliding along whatever is in the way. */
export function walk(list: Blocker[], from: Vec2, to: Vec2, radius = BODY_RADIUS): Vec2 {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(dist / 0.08));
  let p = from;
  for (let i = 1; i <= steps; i++) {
    p = pushOut(list, { x: p.x + (to.x - from.x) / steps, z: p.z + (to.z - from.z) / steps }, radius);
  }
  return p;
}

/** Turns a joystick or key vector (right, forward) into a plan step for a viewer looking along plan direction `fwd`. */
export function stepFor(fwd: Vec2, right: number, forward: number, metres: number): Vec2 {
  const l = Math.hypot(right, forward);
  if (l < 1e-6) return { x: 0, z: 0 };
  const k = metres / Math.max(1, l);
  // To the right of plan direction (fx, fz) lies (fz, −fx).
  return { x: (fwd.x * forward + fwd.z * right) * k, z: (fwd.z * forward - fwd.x * right) * k };
}
