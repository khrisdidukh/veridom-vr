import sample from "../public/plans/sample-house.json?raw";
import { describe, expect, it } from "vitest";
import { importPlan } from "../src/plan/import";
import { runChecks } from "../src/edit/checks";
import { footprint, roomAt } from "../src/site/align";
import { sunHours } from "../src/info/daylight";

const ok = (input: unknown) => {
  const r = importPlan(input);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r;
};
const errorsOf = (input: unknown) => {
  const r = importPlan(input);
  return r.ok ? [] : r.errors;
};
const base = () => JSON.parse(sample) as { units?: string; levels: { walls: Record<string, unknown>[]; openings: Record<string, unknown>[]; rooms: Record<string, unknown>[]; height?: number }[] };

describe("plan import", () => {
  it("reads the sample plan", () => {
    const r = ok(sample);
    const h = r.house;
    expect(h.name).toBe("Sample bungalow, 9 × 7 m");
    expect(h.walls).toHaveLength(8);
    expect(h.openings.filter((o) => o.kind === "door")).toHaveLength(5);
    expect(h.rooms.map((x) => x.id)).toEqual(["living", "kitchen", "bedroom", "bath", "hall"]);
    expect(h.northOffsetDeg).toBe(20);
    expect(h.location).toEqual({ lat: 48.3, lon: 15.6, name: "Sample plot, Lower Austria" });
    expect(h.furniture).toHaveLength(3);
    expect(r.warnings).toEqual([]);
    expect(r.level).toBe("eg");
    // Defaults: a window without height and sill gets 1.4 m at 0.9 m.
    expect(h.openings.find((o) => o.id === "win-living-w")).toMatchObject({ height: 1.4, sill: 0.9 });
    // The rest of the app works on it.
    expect(footprint(h).max.x).toBeCloseTo(9.19);
    expect(roomAt(h, { x: 8, z: 5 })?.id).toBe("hall");
    expect(Array.isArray(runChecks(h))).toBe(true);
    expect(sunHours(h, h.location!).living![5]).toBeGreaterThan(5);
  });

  it("converts units and moves the plan to the origin", () => {
    const p = base();
    p.units = "cm";
    for (const l of p.levels) {
      l.height = 260;
      for (const w of l.walls) {
        w.from = (w.from as number[]).map((v) => v * 100 + 5000);
        w.to = (w.to as number[]).map((v) => v * 100 + 5000);
        w.thickness = (w.thickness as number) * 100;
      }
      for (const o of l.openings) for (const k of ["offset", "width", "height", "sill"]) if (typeof o[k] === "number") o[k] = (o[k] as number) * 100;
      for (const r of l.rooms) {
        r.min = (r.min as number[]).map((v) => v * 100 + 5000);
        r.max = (r.max as number[]).map((v) => v * 100 + 5000);
      }
      delete (l as Record<string, unknown>).points;
      delete (l as Record<string, unknown>).fixtures;
      delete (l as Record<string, unknown>).furniture;
    }
    const h = ok(p).house;
    expect(h.walls[0]!.a).toEqual({ x: 0, z: 0 });
    expect(h.walls[0]!.b.x).toBeCloseTo(9);
    expect(h.walls[0]!.thickness).toBeCloseTo(0.38);
    expect(h.rooms[1]!.min.x).toBeCloseTo(5);
    expect(h.openings[0]!.width).toBeCloseTo(1);
  });

  it("accepts a flat file and guesses the outer walls", () => {
    const r = ok({ walls: [
      { id: "a", from: [0, 0], to: [6, 0] }, { id: "b", from: [6, 0], to: [6, 5] }, { id: "c", from: [6, 5], to: [0, 5] }, { id: "d", from: [0, 5], to: [0, 0] },
      { id: "e", from: [3, 0], to: [3, 5] },
    ] });
    expect(r.house.walls.map((w) => w.exterior)).toEqual([true, true, true, true, false]);
    expect(r.house.rooms).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/taken as outer walls/);
    expect(r.warnings.join(" ")).toMatch(/no rooms/);
    expect(r.house.panel.wallId).toBe("e");
  });

  it("says clearly what is wrong", () => {
    expect(errorsOf("{ not json")[0]).toMatch(/^This is not valid JSON/);
    expect(errorsOf([1, 2])[0]).toMatch(/must be a JSON object/);
    expect(errorsOf({ name: "x" })[0]).toMatch(/No levels found/);
    expect(errorsOf({ units: "inch", walls: [] })[0]).toMatch(/units: expected "m", "cm" or "mm"/);

    let p = base();
    p.levels[0]!.openings[6]!.offset = 8.5; // kitchen window pushed past the end of the 9 m wall
    expect(errorsOf(p)).toEqual(['levels[0].openings[6] ("Kitchen window"): is 1.40 m wide at offset 8.50 m, but wall "south" is only 9.00 m long']);

    p = base();
    p.levels[0]!.openings[1]!.wall = "nowhere";
    p.levels[0]!.walls[4]!.thickness = 3;
    p.levels[0]!.rooms[0]!.max = [0.2, 4];
    const e = errorsOf(p);
    expect(e).toContain('levels[0].walls[4] ("spine").thickness: must be between 0.05 and 1 m, got 3');
    expect(e.some((x) => x.includes('there is no wall "nowhere"'))).toBe(true);
    expect(e.some((x) => x.includes('rooms[0] ("Living room")'))).toBe(true);

    p = base();
    p.levels[0]!.walls[1]!.id = "south";
    expect(errorsOf(p)[0]).toMatch(/"south" is used twice/);

    p = base();
    p.levels[0]!.openings[6]!.offset = 2.5; // into the living room window
    expect(errorsOf(p)[0]).toMatch(/overlaps "Living room window" on wall "south"/);

    p = base();
    p.units = "mm"; // metres read as millimetres: nothing is long enough
    expect(errorsOf(p).length).toBeGreaterThan(0);
    p = base();
    for (const w of p.levels[0]!.walls) { w.from = (w.from as number[]).map((v) => v * 1000); w.to = (w.to as number[]).map((v) => v * 1000); }
    expect(errorsOf(p).some((x) => /Is "units" right/.test(x))).toBe(true);
  });

  it("picks a level by id", () => {
    const p = base() as unknown as { levels: Record<string, unknown>[] };
    p.levels.push({ ...p.levels[0]!, id: "og", name: "Upper floor" });
    const r = importPlan(p, "og");
    expect(r.ok && r.level).toBe("og");
    expect(r.ok && r.warnings[0]).toMatch(/2 levels/);
    const bad = importPlan(p, "attic");
    expect(!bad.ok && bad.errors[0]).toMatch(/Level "attic" is not in the file. It has: eg, og/);
  });
});

import { runChecks as checks } from "../src/edit/checks";
describe("sample plan", () => {
  it("has no plan problems of its own", () => {
    const r = importPlan(sample);
    expect(r.ok && checks(r.house)).toEqual([]);
  });
});
