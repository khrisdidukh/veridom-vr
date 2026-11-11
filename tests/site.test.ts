import { describe, expect, it } from "vitest";
import { DEMO_HOUSE } from "../src/house/demo";
import {
  SITE_KEY, alignCornerAt, alignFromTwoPoints, footprint, headingDeg, loadSite, nudge, planToWorld, referenceCorner,
  rotateAround, roomAt, saveSite, whereAmI, worldToPlan, yawBetween,
} from "../src/site/align";
import { DEFAULT_WALL_OPACITY, PREFS_KEY, Store, XRAY_OPACITY, loadPrefs } from "../src/state";

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: m,
  };
};

describe("two-point alignment", () => {
  const ref = referenceCorner(DEMO_HOUSE);

  it("uses the outer south-west corner and the south wall", () => {
    expect(ref.corner.x).toBeCloseTo(-0.19);
    expect(ref.corner.z).toBeCloseTo(-0.19);
    expect(ref.dir).toEqual({ x: 1, z: 0 });
    const f = footprint(DEMO_HOUSE);
    expect(f.max.x - f.min.x).toBeCloseTo(12.38);
    expect(f.max.z - f.min.z).toBeCloseTo(9.38);
  });

  it("puts the corner on the first point and the wall through the second", () => {
    const p1 = { x: 3, y: 0.1, z: -4 };
    const p2 = { x: 3 + 5 * Math.cos(0.7), y: 0.1, z: -4 - 5 * Math.sin(0.7) };
    const a = alignFromTwoPoints(p1, p2, ref.corner, ref.dir);
    expect(a.yaw).toBeCloseTo(0.7);
    const c = planToWorld(a, ref.corner);
    expect(c.x).toBeCloseTo(p1.x);
    expect(c.y).toBeCloseTo(0.1);
    expect(c.z).toBeCloseTo(p1.z);
    // A point 5 m along the south wall lands on p2.
    const along = planToWorld(a, { x: ref.corner.x + 5, z: ref.corner.z });
    expect(along.x).toBeCloseTo(p2.x);
    expect(along.z).toBeCloseTo(p2.z);
  });

  it("with no turn, plan north is straight ahead (−z) and east to the right", () => {
    const a = alignCornerAt({ x: 0, y: 0, z: 0 }, { x: 0, z: 0 }, 0);
    expect(planToWorld(a, { x: 2, z: 3 })).toEqual({ x: 2, y: 0, z: -3 });
  });

  it("round-trips plan ↔ world for any placement", () => {
    const a = { x: 4.2, y: 0, z: -7.5, yaw: -2.1 };
    for (const p of [{ x: 0, z: 0 }, { x: 12, z: 9 }, { x: 3.3, z: 6.1 }]) {
      const back = worldToPlan(a, planToWorld(a, p));
      expect(back.x).toBeCloseTo(p.x);
      expect(back.z).toBeCloseTo(p.z);
    }
  });

  it("keeps the old angle when the second point is on top of the first", () => {
    const p = { x: 1, y: 0, z: 1 };
    expect(yawBetween(p, { x: 1.01, y: 0, z: 1 }, ref.dir)).toBeNull();
    expect(alignFromTwoPoints(p, { ...p }, ref.corner, ref.dir, 0.3).yaw).toBeCloseTo(0.3);
    expect(alignFromTwoPoints(p, null, ref.corner, ref.dir, 0.3).yaw).toBeCloseTo(0.3);
  });

  it("nudges in world metres and turns around the viewer", () => {
    const a = { x: 1, y: 0, z: 2, yaw: 0.2 };
    expect(nudge(a, 0.1, -0.2, 0.05)).toEqual({ x: 1.1, y: 0.05, z: 1.8, yaw: 0.2 });
    const pivot = { x: 5, z: -3 };
    const before = worldToPlan(a, pivot);
    const turned = rotateAround(a, 5, pivot);
    expect(turned.yaw).toBeCloseTo(0.2 + (5 * Math.PI) / 180);
    // The spot under the viewer's feet is still the same spot of the plan.
    const after = worldToPlan(turned, pivot);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
  });
});

describe("room under your feet", () => {
  it("finds the room for a plan point", () => {
    expect(roomAt(DEMO_HOUSE, { x: 2, z: 2 })?.id).toBe("living");
    expect(roomAt(DEMO_HOUSE, { x: 9, z: 2 })?.id).toBe("bedroom");
    expect(roomAt(DEMO_HOUSE, { x: 8, z: 7 })?.id).toBe("bath");
    expect(roomAt(DEMO_HOUSE, { x: -3, z: 2 })).toBeNull();
  });

  it("follows a walk through the placed house", () => {
    // House turned 90°, pegged 3 m in front of the start point.
    const a = alignCornerAt({ x: 0, y: 0, z: -3 }, referenceCorner(DEMO_HOUSE).corner, Math.PI / 2);
    const at = (p: { x: number; z: number }) => whereAmI(DEMO_HOUSE, worldToPlan(a, planToWorld(a, p)));
    expect(at({ x: 2, z: 2 })).toBe("Living & kitchen");
    expect(at({ x: 5.5, z: 7 })).toBe("Hall");
    expect(whereAmI(DEMO_HOUSE, worldToPlan(a, { x: 0, z: 0 }))).toMatch(/^Outside, .* of the house$/);
  });

  it("says how far outside you are and on which side", () => {
    expect(whereAmI(DEMO_HOUSE, { x: 6, z: -2.19 })).toBe("Outside, 2.0 m south of the house");
    expect(whereAmI(DEMO_HOUSE, { x: 15.19, z: 4 })).toBe("Outside, 3.0 m east of the house");
    expect(whereAmI(DEMO_HOUSE, { x: -0.1, z: 4 })).toBe("In a wall");
  });

  it("gives compass headings from plan directions", () => {
    expect(headingDeg(0, { x: 0, z: 1 })).toBeCloseTo(0);
    expect(headingDeg(0, { x: 1, z: 0 })).toBeCloseTo(90);
    // True north lies 30° clockwise of plan north: plan north itself then looks 30° west of north.
    expect(headingDeg(30, { x: 0, z: 1 })).toBeCloseTo(330);
    expect(headingDeg(30, { x: -1, z: 0 })).toBeCloseTo(240);
  });
});

describe("saved placement", () => {
  it("round-trips through storage", () => {
    const st = memory();
    const saved = { x: 1.5, y: 0.02, z: -4, yaw: 0.6, anchorId: "abc-123", space: "unbounded", savedAt: 42 };
    expect(saveSite(st, saved)).toBe(true);
    expect(loadSite(st)).toEqual(saved);
  });

  it("returns null for nothing, junk or half a record", () => {
    expect(loadSite(memory())).toBeNull();
    expect(loadSite(memory({ [SITE_KEY]: "{not json" }))).toBeNull();
    expect(loadSite(memory({ [SITE_KEY]: JSON.stringify({ x: 1, y: 0, z: "2", yaw: 0 }) }))).toBeNull();
    expect(loadSite(memory({ [SITE_KEY]: JSON.stringify({ x: 1, y: 0, z: null, yaw: 0 }) }))).toBeNull();
    expect(loadSite(null)).toBeNull();
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
      removeItem: () => {},
    };
    expect(saveSite(broken, { x: 0, y: 0, z: 0, yaw: 0, space: "local-floor", savedAt: 0 })).toBe(false);
    expect(loadSite(broken)).toBeNull();
  });
});

describe("wall opacity", () => {
  it("is solid at home and see-through on site by default", () => {
    const s = new Store(memory());
    expect(s.wallOpacity).toBe(1);
    s.setMode("site");
    expect(s.wallOpacity).toBe(DEFAULT_WALL_OPACITY.site);
    s.setMode("walk");
    expect(s.wallOpacity).toBe(1);
  });

  it("keeps a value per kind of mode and remembers it", () => {
    const st = memory();
    const s = new Store(st);
    s.setWallOpacity(0.6);
    s.setMode("site");
    s.setWallOpacity(0.1);
    s.setWallOpacity(7); // clamped
    expect(s.wallOpacity).toBe(1);
    s.setWallOpacity(0);
    const again = new Store(st);
    expect(again.s.wallOpacity).toEqual({ home: 0.6, site: 0 });
    expect(loadPrefs(st).wallOpacity).toEqual({ home: 0.6, site: 0 });
  });

  it("ignores broken saved values", () => {
    expect(loadPrefs(memory({ [PREFS_KEY]: "nope" })).wallOpacity).toEqual(DEFAULT_WALL_OPACITY);
    expect(loadPrefs(memory({ [PREFS_KEY]: JSON.stringify({ wallOpacity: { home: "x", site: 5 } }) })).wallOpacity).toEqual({ home: 1, site: 1 });
    expect(loadPrefs(null).showFloor).toBe(true);
  });

  it("X-ray drops the walls and gives them back", () => {
    const st = memory();
    const s = new Store(st);
    s.setXray(true);
    expect(s.wallOpacity).toBe(XRAY_OPACITY);
    s.setXray(false);
    expect(s.wallOpacity).toBe(1);
    // Already more see-through than X-ray: left alone.
    s.setWallOpacity(0.1);
    s.setXray(true);
    expect(s.wallOpacity).toBe(0.1);
    s.setXray(false);
    expect(s.wallOpacity).toBe(0.1);
    // A hand on the slider during X-ray wins over the restore.
    s.setWallOpacity(1);
    s.setXray(true);
    s.setWallOpacity(0.5);
    s.setXray(false);
    expect(s.wallOpacity).toBe(0.5);
    // Leaving the mode ends X-ray and restores this mode's walls.
    s.setWallOpacity(0.9);
    s.setXray(true);
    s.setMode("site");
    expect(s.s.xray).toBe(false);
    expect(s.s.wallOpacity.home).toBe(0.9);
  });
});

import { ASSEMBLIES, ASSEMBLY_IDS, FITTINGS, SERVICES, insulationShare, layerR, thickness, totalMm, uValue } from "../src/info/catalog";
import { noteFor } from "../src/info/notes";
import { clearStretch, nearestWall, outward, wallAt } from "../src/info/locate";
import { formatLength, measure } from "../src/info/measure";
import { runChecks } from "../src/edit/checks";
import { STAGES } from "../src/edit/stages";
import { wallById } from "../src/house/model";

describe("build-up catalogue", () => {
  it("gives every layer a size, a λ, a reason and a known stage", () => {
    const stages = STAGES.map((s) => s.id as string);
    for (const id of ASSEMBLY_IDS) {
      const a = ASSEMBLIES[id];
      expect(a.layers.length).toBeGreaterThanOrEqual(3);
      expect(new Set(a.layers.map((l) => l.id)).size).toBe(a.layers.length);
      for (const l of a.layers) {
        expect(l.mm).toBeGreaterThan(0);
        expect(l.lambda).toBeGreaterThan(0);
        expect(l.what.length).toBeGreaterThan(10);
        expect(l.why.length).toBeGreaterThan(10);
        expect(l.guide).toMatch(/€/);
        expect(stages).toContain(l.stage);
      }
    }
    for (const n of [...Object.values(SERVICES), ...Object.values(FITTINGS)]) expect(stages).toContain(n.stage);
  });

  it("computes U-values from the layers", () => {
    const wall = ASSEMBLIES["ext-wall"];
    // 0.13 + 0.015/0.7 + 0.25/0.25 + 0.16/0.031 + 0.01/0.7 + 0.04 = 6.367 m²K/W
    expect(uValue(wall)).toBeCloseTo(1 / 6.367, 3);
    expect(totalMm(wall)).toBe(435);
    // A new Austrian house: walls ≤ 0.35, roof ≤ 0.20, floor to ground ≤ 0.40 W/m²K (OIB guideline 6).
    expect(uValue(wall)).toBeLessThan(0.35);
    expect(uValue(ASSEMBLIES.roof)).toBeLessThan(0.2);
    expect(uValue(ASSEMBLIES.floor)).toBeLessThan(0.4);
    expect(uValue(ASSEMBLIES["int-wall"])).toBeGreaterThan(1);
  });

  it("knows the insulation does most of the insulating", () => {
    const wall = ASSEMBLIES["ext-wall"];
    const eps = wall.layers.find((l) => l.id === "eps")!;
    expect(insulationShare(wall, eps)).toBeGreaterThan(0.8);
    expect(wall.layers.reduce((s, l) => s + insulationShare(wall, l), 0)).toBeCloseTo(1);
    expect(layerR(eps)).toBeCloseTo(5.161, 2);
  });

  it("writes thicknesses the way a builder says them", () => {
    expect(thickness(15)).toBe("15 mm");
    expect(thickness(250)).toBe("25 cm");
    expect(thickness(435)).toBe("43.5 cm");
  });
});

describe("footnotes", () => {
  const findings = runChecks(DEMO_HOUSE);

  it("explains a layer and says if it is still free to change", () => {
    const early = noteFor(DEMO_HOUSE, findings, { kind: "layer", assembly: "ext-wall", layer: "eps" }, 2)!;
    expect(early.title).toBe("Façade insulation (EPS) · 16 cm");
    expect(early.lines.join(" ")).toMatch(/λ 0.031/);
    expect(early.lines.join(" ")).toMatch(/Approx\. price: ≈ €70–100 \/ m² — confirm with your builder/);
    expect(early.foot).toBe("Stage: Plaster & drywall · not built yet — still free to change");
    expect(noteFor(DEMO_HOUSE, findings, { kind: "layer", assembly: "ext-wall", layer: "eps" }, 3.5)!.foot).toMatch(/being built/);
    expect(noteFor(DEMO_HOUSE, findings, { kind: "layer", assembly: "ext-wall", layer: "eps" }, 5)!.foot).toMatch(/· built$/);
    expect(noteFor(DEMO_HOUSE, findings, { kind: "layer", assembly: "floor", layer: "nope" }, 5)).toBeNull();
  });

  it("describes a door from the plan and warns about its problem", () => {
    const n = noteFor(DEMO_HOUSE, findings, { kind: "element", target: { type: "door", id: "d-bath" } }, 5)!;
    expect(n.title).toBe("Bathroom door");
    expect(n.lines[0]).toBe("80 cm × 210 cm · hinge at the start, opens right");
    expect(n.lines[1]).toMatch(/^⚠ Bathroom door hits the toilet/);
    expect(n.tone).toBe("warn");
    expect(noteFor(DEMO_HOUSE, findings, { kind: "element", target: { type: "window", id: "w-bath" } }, 5)!.tone).toBe("info");
  });

  it("says what to change for a finding, and covers pipes and fittings", () => {
    const f = noteFor(DEMO_HOUSE, findings, { kind: "finding", id: "swing-d-bath-f-wc" }, 5)!;
    expect(f.lines[0]).toMatch(/Flip the swing/);
    expect(noteFor(DEMO_HOUSE, findings, { kind: "finding", id: "gone" }, 5)).toBeNull();
    expect(noteFor(DEMO_HOUSE, findings, { kind: "service", service: "drain" }, 0)!.foot).toMatch(/Foundation slab · not built yet/);
    expect(noteFor(DEMO_HOUSE, findings, { kind: "element", target: { type: "socket", id: "s-bath" } }, 5)!.lines[0]).toBe("110 cm above the floor");
    expect(noteFor(DEMO_HOUSE, findings, { kind: "element", target: { type: "counter", id: "f-counter" } }, 5)!.lines[0]).toBe("Worktop 90 cm high");
    expect(noteFor(DEMO_HOUSE, findings, { kind: "assembly", assembly: "roof" }, 5)!.lines[0]).toMatch(/^6 layers · 53.2 cm · U = 0.13/);
  });
});

describe("finding the wall you pointed at", () => {
  it("matches a point on a wall face to that wall", () => {
    expect(wallAt(DEMO_HOUSE, { x: 3, z: 0.19 })?.wall.id).toBe("ext-s");
    expect(wallAt(DEMO_HOUSE, { x: 7.07, z: 2 })?.wall.id).toBe("int-1");
    expect(wallAt(DEMO_HOUSE, { x: 3, z: 2 })).toBeNull();
    const spot = nearestWall(DEMO_HOUSE, { x: 3, z: 2 }, (w) => w.exterior)!;
    expect(spot.wall.id).toBe("ext-s");
    expect(spot.along).toBeCloseTo(3);
    expect(spot.dist).toBeCloseTo(2);
  });

  it("knows which way is outdoors", () => {
    expect(outward(DEMO_HOUSE, wallById(DEMO_HOUSE, "ext-s")).z).toBeCloseTo(-1);
    expect(outward(DEMO_HOUSE, wallById(DEMO_HOUSE, "ext-n")).z).toBeCloseTo(1);
    expect(outward(DEMO_HOUSE, wallById(DEMO_HOUSE, "ext-e")).x).toBeCloseTo(1);
    expect(outward(DEMO_HOUSE, wallById(DEMO_HOUSE, "ext-w")).x).toBeCloseTo(-1);
  });

  it("keeps the sample off doors, windows and wall ends", () => {
    const w = wallById(DEMO_HOUSE, "ext-s");
    // Pointing at the terrace door (1–3 m): the sample moves to the free stretch beside it.
    const a = clearStretch(DEMO_HOUSE, w, 2, 0.45);
    expect(a - 0.45 >= 3 - 1e-9 || a + 0.45 <= 1 + 1e-9).toBe(true);
    expect(clearStretch(DEMO_HOUSE, w, 0, 0.45)).toBeCloseTo(0.45);
    expect(clearStretch(DEMO_HOUSE, w, 6.5, 0.45)).toBeCloseTo(6.5);
  });
});

describe("measuring tape", () => {
  it("formats lengths", () => {
    expect(formatLength(0.874)).toBe("87 cm");
    expect(formatLength(3.4159)).toBe("3.42 m");
    expect(formatLength(0.999)).toBe("1.00 m");
  });
  it("measures in house metres and splits a slanted tape", () => {
    expect(measure({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 })).toEqual({ title: "5.00 m", lines: [], length: 5 });
    const r = measure({ x: 0, y: 0, z: 0 }, { x: 3, y: 2.6, z: 4 });
    expect(r.title).toBe("5.64 m");
    expect(r.lines).toEqual(["5.00 m along · 2.60 m up"]);
  });
});

describe("info state", () => {
  it("opens and closes a build-up and its layers", () => {
    const s = new Store(memory());
    const spec = { assembly: "ext-wall" as const, x: 6.5, z: 0, y: 1.3, nx: 0, nz: 1, roomSide: true, wallId: "ext-s" };
    s.openCutaway(spec);
    expect(s.s.info).toEqual({ kind: "assembly", assembly: "ext-wall" });
    expect(s.s.view).toBe("layers");
    s.setInfo({ kind: "layer", assembly: "ext-wall", layer: "brick" });
    expect(s.s.info).toEqual({ kind: "layer", assembly: "ext-wall", layer: "brick" });
    s.setInfo({ kind: "layer", assembly: "ext-wall", layer: "brick" }); // again: back to the summary
    expect(s.s.info).toEqual({ kind: "assembly", assembly: "ext-wall" });
    s.select({ type: "door", id: "d-bath" });
    expect(s.s.info).toEqual({ kind: "element", target: { type: "door", id: "d-bath" } });
    s.select(null);
    expect(s.s.info).toEqual({ kind: "assembly", assembly: "ext-wall" });
    s.closeCutaway();
    expect(s.s.cutaway).toBeNull();
    expect(s.s.info).toBeNull();
    expect(s.s.view).toBe("main");
  });
});

import { TOUR, TOUR_SECONDS, ramp, stepAt } from "../src/tour";
describe("guided tour", () => {
  it("fits in about a minute and runs in order", () => {
    expect(TOUR_SECONDS).toBeGreaterThanOrEqual(55);
    expect(TOUR_SECONDS).toBeLessThanOrEqual(65);
    for (let i = 1; i < TOUR.length; i++) expect(TOUR[i]!.at).toBeGreaterThan(TOUR[i - 1]!.at);
    expect(TOUR.at(-1)!.actions).toEqual([{ do: "end" }]);
    for (const s of TOUR) expect(s.caption.length).toBeLessThanOrEqual(90);
  });
  it("undoes the change it makes, and names only things that exist", () => {
    const all = TOUR.flatMap((s) => s.actions);
    expect(all.filter((a) => a.do === "edit").length).toBe(all.filter((a) => a.do === "undo").length);
    for (const a of all) {
      if (a.do === "select") expect(DEMO_HOUSE.openings.some((o) => o.id === a.id)).toBe(true);
      if (a.do === "mode" && a.room) expect(DEMO_HOUSE.rooms.some((r) => r.id === a.room)).toBe(true);
      if (a.do === "mode" && a.at) expect(roomAt(DEMO_HOUSE, { x: a.at[0], z: a.at[1] })?.id).toBe(a.room);
      if (a.do === "layer") expect(ASSEMBLIES[a.assembly].layers.some((l) => l.id === a.layer)).toBe(true);
    }
  });
  it("finds the step for a time and ramps values", () => {
    expect(stepAt(-1)).toBe(-1);
    expect(stepAt(0)).toBe(0);
    expect(stepAt(16)).toBe(2);
    expect(stepAt(999)).toBe(TOUR.length - 1);
    expect(ramp(0, 5, 10, 5)).toBe(2.5);
    expect(ramp(0, 5, 10, 50)).toBe(5);
    expect(ramp(7, 19, 0, 0)).toBe(19);
  });
});

import { fitTwoCorners, northOffsetOf, northYawFromHeading, northYawOf, secondCorner } from "../src/site/align";
import { headingFromOrientation, Compass } from "../src/site/compass";
import { dayAndHour } from "../src/env/sun";

describe("real north on site", () => {
  const northDir = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

  it("takes north from where the viewer looks", () => {
    // Looking along world +x and saying "this is north".
    const n = northYawFromHeading(1, 0);
    expect(northDir(n).x).toBeCloseTo(1);
    expect(northDir(n).z).toBeCloseTo(0);
    // Looking along −z while facing east (heading 90): north is to the left, world −x.
    const e = northYawFromHeading(0, -1, 90);
    expect(northDir(e).x).toBeCloseTo(-1);
    expect(northDir(e).z).toBeCloseTo(0);
  });

  it("turns north into the plan's north offset and back", () => {
    // House placed without a turn: plan north is world −z.
    const a = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(northOffsetOf(a, northYawFromHeading(0, -1))).toBeCloseTo(0);
    // Real north is world +x, which is the plan's east: 90° clockwise of plan north.
    const n = northYawFromHeading(1, 0);
    expect(northOffsetOf(a, n)).toBeCloseTo(90);
    expect(headingDeg(northOffsetOf(a, n), { x: 1, z: 0 })).toBeCloseTo(0);
    // The offset survives a re-placed house: same offset, new yaw, north follows.
    const b = { x: 3, y: 0, z: 1, yaw: 0.8 };
    expect(northOffsetOf(b, northYawOf(b, 90))).toBeCloseTo(90);
  });

  it("is saved with the placement", () => {
    const st = memory();
    saveSite(st, { x: 0, y: 0, z: 0, yaw: 0.1, northOffsetDeg: 12.5, space: "local-floor", savedAt: 1 });
    expect(loadSite(st)!.northOffsetDeg).toBe(12.5);
    saveSite(st, { x: 0, y: 0, z: 0, yaw: 0.1, space: "local-floor", savedAt: 1 });
    expect(loadSite(st)!.northOffsetDeg).toBeUndefined();
  });

  it("reads a compass heading only from absolute readings", () => {
    expect(headingFromOrientation({ absolute: true, alpha: 90 })).toBe(270);
    expect(headingFromOrientation({ absolute: false, alpha: 90 })).toBeNull();
    expect(headingFromOrientation({ webkitCompassHeading: 45 })).toBe(45);
    expect(headingFromOrientation({ absolute: true, alpha: null })).toBeNull();
    let fire: (e: Event) => void = () => {};
    const c = new Compass({ addEventListener: (_n: string, f: (e: Event) => void) => void (fire = f) } as unknown as Window);
    expect(c.heading()).toBeNull();
    fire({ absolute: true, alpha: 350 } as unknown as Event);
    expect(c.heading()).toBe(10);
    expect(c.heading(Date.now() + 5000)).toBeNull();
  });

  it("finds the day of the year and the clock hour", () => {
    const d = dayAndHour(new Date(2026, 5, 21, 13, 30));
    expect(d.day).toBe(172);
    expect(d.hour).toBe(13.5);
  });
});

describe("third alignment point", () => {
  it("sets the house between two pegged corners", () => {
    const sw = referenceCorner(DEMO_HOUSE).corner;
    const se = secondCorner(DEMO_HOUSE);
    expect(se.x - sw.x).toBeCloseTo(12.38);
    // Pegs 12.48 m apart (10 cm too far), along a line turned by 0.3 rad.
    const A = { x: 1, y: 0, z: 2 };
    const B = { x: 1 + 12.48 * Math.cos(0.3), y: 0, z: 2 - 12.48 * Math.sin(0.3) };
    const fit = fitTwoCorners(sw, A, se, B);
    expect(fit.align.yaw).toBeCloseTo(0.3);
    expect(fit.measured - fit.planned).toBeCloseTo(0.1);
    // Each corner misses its peg by half the difference.
    const a = planToWorld(fit.align, sw);
    const b = planToWorld(fit.align, se);
    expect(Math.hypot(a.x - A.x, a.z - A.z)).toBeCloseTo(0.05);
    expect(Math.hypot(b.x - B.x, b.z - B.z)).toBeCloseTo(0.05);
  });
});
