import { describe, expect, it } from "vitest";
import { DEMO_HOUSE } from "../src/house/demo";
import { runChecks } from "../src/edit/checks";
import { assessImpact } from "../src/edit/impact";
import { applyEdit, changeRequestText } from "../src/edit/changes";
import { stageAt, stageProgress } from "../src/edit/stages";

describe("stages", () => {
  it("maps timeline values to stages", () => {
    expect(stageAt(0)).toBe(0);
    expect(stageAt(2.4)).toBe(2);
    expect(stageAt(9)).toBe(5);
    expect(stageProgress(2.4, 3)).toBeCloseTo(0.4);
    expect(stageProgress(2.4, 2)).toBe(1);
    expect(stageProgress(2.4, 4)).toBe(0);
  });
});

describe("demo checks", () => {
  it("finds exactly the two planted problems", () => {
    const ids = runChecks(DEMO_HOUSE).map((f) => f.id).sort();
    expect(ids).toEqual(["swing-d-bath-f-wc", "switch-sw-bed-d-bed"]);
  });

  it("flipping the bathroom door swing removes the clash", () => {
    const r = applyEdit(DEMO_HOUSE, { type: "door", id: "d-bath" }, "flip-swing", 0, 1);
    if ("error" in r) throw new Error(r.error);
    expect(runChecks(r.house).some((f) => f.id.startsWith("swing-d-bath"))).toBe(false);
  });

  it("moving the switch to the handle side fixes it", () => {
    const r = applyEdit(DEMO_HOUSE, { type: "switch", id: "sw-bed" }, "move", 1.4, 1);
    if ("error" in r) throw new Error(r.error);
    expect(runChecks(r.house).some((f) => f.id.startsWith("switch-sw-bed"))).toBe(false);
  });
});

describe("impact grows with the build stage", () => {
  const order = { plan: 0, low: 1, medium: 2, high: 3 } as const;
  const targets = [
    [{ type: "socket", id: "s-bath" }, "move"],
    [{ type: "door", id: "d-bath" }, "move"],
    [{ type: "window", id: "w-bath" }, "width"],
    [{ type: "counter", id: "f-counter" }, "height"],
  ] as const;
  for (const [t, k] of targets) {
    it(`${t.id} never gets cheaper later`, () => {
      let prev = -1;
      for (let s = 0; s <= 5; s++) {
        const lvl = order[assessImpact(DEMO_HOUSE, t, k, s).level];
        expect(lvl).toBeGreaterThanOrEqual(prev);
        prev = lvl;
      }
    });
  }
  it("is plan-only before anything is built and real rework after", () => {
    expect(assessImpact(DEMO_HOUSE, { type: "socket", id: "s-bath" }, "move", 0).level).toBe("plan");
    const late = assessImpact(DEMO_HOUSE, { type: "socket", id: "s-bath" }, "move", 5);
    expect(late.level).toBe("high");
    expect(late.rework).toContain("Replace wall tiles");
  });
});

describe("edits", () => {
  it("never mutates the input house", () => {
    const before = JSON.stringify(DEMO_HOUSE);
    applyEdit(DEMO_HOUSE, { type: "socket", id: "s-liv-1" }, "height", 0.1, 3);
    expect(JSON.stringify(DEMO_HOUSE)).toBe(before);
  });
  it("refuses moves past the wall end", () => {
    const r = applyEdit(DEMO_HOUSE, { type: "door", id: "d-wc" }, "move", 50, 0);
    expect("error" in r ? "err" : r.house.openings.find((o) => o.id === "d-wc")!.offset).toBeLessThanOrEqual(5 - 0.8 - 0.3 + 1e-9);
  });
  it("writes a readable change request", () => {
    const r = applyEdit(DEMO_HOUSE, { type: "counter", id: "f-counter" }, "height", 0.05, 5);
    if ("error" in r) throw new Error(r.error);
    const text = changeRequestText(DEMO_HOUSE.name, [r.change]);
    expect(text).toContain("Worktop height 90 → 95 cm");
    expect(text).toContain("Re-fit the kitchen base units");
  });
});

describe("furniture", () => {
  it("demo furniture blocks no door", () => {
    expect(runChecks(DEMO_HOUSE).some((f) => f.id.includes("-fu-"))).toBe(false);
  });

  it("a wardrobe in front of the bedroom door is flagged", () => {
    const h = structuredClone(DEMO_HOUSE);
    h.furniture.push({ id: "fu-test", catalogId: "wardrobe", x: 7.6, z: 3.9, rot: 90 });
    expect(runChecks(h).map((f) => f.id)).toContain("swing-d-bed-fu-test");
  });
});

import { FRANZEN, sunPosition } from "../src/env/sun";
describe("sun over Franzen", () => {
  it("stands high in the south at summer noon and low in winter", () => {
    const jun = sunPosition(FRANZEN.lat, FRANZEN.lon, 172, 13.2, 2);
    const dec = sunPosition(FRANZEN.lat, FRANZEN.lon, 355, 12.0, 1);
    expect(jun.elevation).toBeGreaterThan(63);
    expect(jun.elevation).toBeLessThan(66);
    expect(dec.elevation).toBeGreaterThan(17);
    expect(dec.elevation).toBeLessThan(19);
    expect(Math.abs(jun.azimuth - 180)).toBeLessThan(10);
  });
  it("is below the horizon at midnight", () => {
    expect(sunPosition(FRANZEN.lat, FRANZEN.lon, 172, 0, 2).elevation).toBeLessThan(0);
  });
});
