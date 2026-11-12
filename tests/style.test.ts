import { describe, expect, it } from "vitest";
import sample from "../public/plans/sample-house.json?raw";
import { DEMO_HOUSE } from "../src/house/demo";
import { importPlan } from "../src/plan/import";
import { roomAt } from "../src/site/align";
import { doorSwing } from "../src/edit/checks";
import { STYLES, dressing, freeWall, livingRoom, nextStyle, styleById } from "../src/style/styles";
import { Store, loadPrefs } from "../src/state";

const sampleHouse = (() => {
  const r = importPlan(sample);
  if (!r.ok) throw new Error("sample");
  return r.house;
})();

describe("interior styles", () => {
  it("has three complete looks and cycles through them", () => {
    expect(STYLES.map((s) => s.label)).toEqual(["Modern", "Scandinavian", "Warm luxury"]);
    const keys = Object.keys(STYLES[0]!.colors).sort();
    for (const s of STYLES) expect(Object.keys(s.colors).sort()).toEqual(keys);
    expect(nextStyle("modern")).toBe("scandi");
    expect(nextStyle("luxury")).toBe("modern");
    expect(styleById("nonsense").id).toBe("modern");
  });

  for (const [name, h] of [["demo house", DEMO_HOUSE], ["sample plan", sampleHouse]] as const) {
    it(`dresses the ${name} sensibly`, () => {
      expect(livingRoom(h)?.id).toBe("living");
      for (const s of STYLES) {
        const d = dressing(h, s.id);
        const rugs = d.filter((x) => x.kind === "rug");
        const art = d.filter((x) => x.kind === "art");
        expect(rugs).toHaveLength(1);
        expect(roomAt(h, rugs[0]!)?.id).toBe("living");
        expect(art.length).toBeGreaterThanOrEqual(1);
        for (const a of art) {
          if (a.kind !== "art") continue;
          // On a wall face, not over a door or window.
          const w = h.walls.find((x) => x.id === a.wallId)!;
          const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
          const t = ((a.x - w.a.x) * (w.b.x - w.a.x) + (a.z - w.a.z) * (w.b.z - w.a.z)) / len;
          for (const o of h.openings.filter((x) => x.wallId === w.id)) expect(t + a.w / 2 <= o.offset || t - a.w / 2 >= o.offset + o.width).toBe(true);
        }
        for (const l of d.filter((x) => x.kind === "lamp")) {
          expect(roomAt(h, l)?.id).toBe("living");
          // Not in the sweep of a door.
          for (const door of h.openings.filter((o) => o.kind === "door")) {
            const sw = doorSwing(h, door);
            expect(Math.hypot(l.x - sw.hinge.x, l.z - sw.hinge.z)).toBeGreaterThan(sw.radius);
          }
        }
      }
    });
  }

  it("finds no wall where there is none free", () => {
    const hall = DEMO_HOUSE.rooms.find((r) => r.id === "hall")!;
    expect(freeWall(DEMO_HOUSE, hall, 9)).toBeNull();
    expect(freeWall(DEMO_HOUSE, DEMO_HOUSE.rooms[0]!, 1.5)?.length).toBeGreaterThanOrEqual(1.5);
  });

  it("remembers the chosen style", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const s = new Store(st);
    expect(s.s.style).toBe("modern");
    s.setStyle("luxury");
    expect(new Store(st).s.style).toBe("luxury");
    expect(loadPrefs(st).style).toBe("luxury");
    expect(loadPrefs({ getItem: () => JSON.stringify({ style: "baroque" }), setItem: () => {} }).style).toBe("modern");
  });
});
