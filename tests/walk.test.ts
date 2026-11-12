import { describe, expect, it } from "vitest";
import { DEMO_HOUSE } from "../src/house/demo";
import { BODY_RADIUS, blockers, pushOut, stepFor, walk } from "../src/walk/collide";
import { roomAt } from "../src/site/align";

describe("walking with collision", () => {
  const list = blockers(DEMO_HOUSE);

  it("stops at a wall", () => {
    // Living room, walking west into the outer wall (centre line x = 0, 38 cm thick).
    const p = walk(list, { x: 2, z: 2.5 }, { x: -3, z: 2.5 });
    expect(p.x).toBeCloseTo(0.19 + BODY_RADIUS);
    expect(p.z).toBeCloseTo(2.5);
  });

  it("slides along a wall instead of sticking", () => {
    const p = walk(list, { x: 1, z: 4.4 }, { x: -2, z: 3.4 });
    expect(p.x).toBeCloseTo(0.19 + BODY_RADIUS);
    expect(p.z).toBeCloseTo(3.4, 1);
  });

  it("passes through doors", () => {
    // Living room door: wall int-2 (z = 5.5), 5.1 … 6.0 m from x = 0.
    const hall = walk(list, { x: 5.55, z: 4.5 }, { x: 5.55, z: 6.6 });
    expect(roomAt(DEMO_HOUSE, hall)?.id).toBe("hall");
    // The same walk one metre to the left hits the wall.
    const stuck = walk(list, { x: 4.4, z: 4.5 }, { x: 4.4, z: 6.6 });
    expect(roomAt(DEMO_HOUSE, stuck)?.id).toBe("living");
    // Out through the terrace door (a floor-length window), but not through an ordinary window.
    expect(walk(list, { x: 2, z: 1 }, { x: 2, z: -1.5 }).z).toBeCloseTo(-1.5);
    expect(walk(list, { x: 4.8, z: 1 }, { x: 4.8, z: -1.5 }).z).toBeGreaterThan(0.19);
  });

  it("never ends inside a wall, even on a long diagonal", () => {
    const p = walk(list, { x: 2, z: 2 }, { x: 11, z: 8 });
    for (const s of list) {
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / (dx * dx + dz * dz)));
      expect(Math.hypot(p.x - s.a.x - dx * t, p.z - s.a.z - dz * t)).toBeGreaterThanOrEqual(s.half + BODY_RADIUS - 1e-6);
    }
    expect(Math.abs(pushOut(list, { x: 0, z: 3 }).x)).toBeCloseTo(0.19 + BODY_RADIUS); // from a centre line: out along the normal
  });

  it("turns keys into plan steps", () => {
    expect(stepFor({ x: 0, z: 1 }, 0, 1, 0.5)).toEqual({ x: 0, z: 0.5 }); // forward while facing north
    const r = stepFor({ x: 0, z: 1 }, 1, 0, 0.5); // strafe right while facing north = east
    expect(r.x).toBeCloseTo(0.5);
    expect(r.z).toBeCloseTo(0);
    const d = stepFor({ x: 1, z: 0 }, 1, 1, 1); // diagonal is not faster
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
    expect(stepFor({ x: 0, z: 1 }, 0, 0, 1)).toEqual({ x: 0, z: 0 });
  });
});
