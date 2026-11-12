import { describe, expect, it } from "vitest";
import sample from "../public/plans/sample-house.json?raw";
import { DEMO_HOUSE } from "../src/house/demo";
import { runChecks } from "../src/edit/checks";
import { footprint } from "../src/furnish/catalog";
import { sunHours } from "../src/info/daylight";
import { FRANZEN } from "../src/env/sun";
import { importPlan } from "../src/plan/import";
import { roomAt } from "../src/site/align";
import { buildTour, doorLinks, ramp, route, standIn, stepAt } from "../src/tour";
import { BAR_SECONDS, CHORDS, chordAt } from "../src/tour-music";

const imported = importPlan(sample);
if (!imported.ok) throw new Error("sample plan");
const houses = [["demo house", DEMO_HOUSE], ["sample plan", imported.house]] as const;

describe("guided tour", () => {
  it("goes in through the front door and on from room to room", () => {
    expect(route(DEMO_HOUSE).map((s) => s.room.id)).toEqual(["hall", "living", "office", "bath", "bedroom", "wc"]);
    expect(route(DEMO_HOUSE)[0]!.via).not.toBeNull();
    expect(route(imported.house).map((s) => s.room.id)).toEqual(["hall", "kitchen", "bath", "living", "bedroom"]);
    expect(doorLinks(DEMO_HOUSE).filter((l) => !l.a || !l.b)).toHaveLength(1); // one front door
    // A house without doors is still toured, room after room.
    expect(route({ ...DEMO_HOUSE, openings: [] }).map((s) => s.room.id)).toEqual(DEMO_HOUSE.rooms.map((r) => r.id));
  });

  for (const [name, h] of houses) {
    it(`builds a tour of about a minute for the ${name}`, () => {
      const steps = buildTour(h, runChecks(h), sunHours(h, FRANZEN));
      const end = steps.at(-1)!;
      expect(end.actions).toEqual([{ do: "end" }]);
      expect(end.at).toBeGreaterThanOrEqual(45);
      expect(end.at).toBeLessThanOrEqual(75);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.at).toBeGreaterThan(steps[i - 1]!.at);
      // Every room stop stands in its room, clear of furniture, and is labelled with name and size.
      const stops = steps.filter((s) => s.actions.some((a) => a.do === "pan"));
      expect(stops).toHaveLength(Math.min(6, h.rooms.length));
      for (const s of stops) {
        const m = s.actions.find((a) => a.do === "mode")!;
        if (m.do !== "mode" || !m.at) throw new Error("no view");
        expect(roomAt(h, { x: m.at[0], z: m.at[1] })?.id).toBe(m.room);
        for (const f of h.furniture.map(footprint)) expect(m.at[0] > f.min.x && m.at[0] < f.max.x && m.at[1] > f.min.z && m.at[1] < f.max.z).toBe(false);
        expect(s.caption.title).toMatch(/ · \d+\.\d m²$/);
        expect(s.caption.line!.length).toBeGreaterThan(10);
        expect(s.caption.line!.length).toBeLessThanOrEqual(70);
      }
      // It ends by rising to the dollhouse view.
      expect(steps.at(-2)!.actions.some((a) => a.do === "dollhouse")).toBe(true);
    });
  }

  it("says one useful thing per room", () => {
    const steps = buildTour(DEMO_HOUSE, runChecks(DEMO_HOUSE), sunHours(DEMO_HOUSE, FRANZEN));
    const line = (room: string) => steps.find((s) => s.caption.title.startsWith(room))!.caption.line;
    expect(line("Bathroom")).toBe("⚠ Bathroom door hits the toilet");
    expect(line("Bedroom")).toBe("⚠ Bedroom light switch is behind the bedroom door");
    expect(line("Living")).toMatch(/^Direct sun: 11\.5 h a day in June, 7\.5 h in December$/);
    expect(line("Hall")).toBe("No window to the outside: light comes through the doors");
  });

  it("stands just inside the door, looking into the room", () => {
    const living = DEMO_HOUSE.rooms[0]!;
    const door = { x: 5.55, z: 5.5 };
    const v = standIn(DEMO_HOUSE, living, door);
    expect(Math.hypot(v.x - door.x, v.z - door.z)).toBeLessThan(2.2);
    // Looking south-west-ish, into the room: away from the door.
    expect(Math.cos((v.heading * Math.PI) / 180)).toBeLessThan(0);
  });

  it("finds the step for a time, ramps values and cycles the chords", () => {
    const steps = buildTour(DEMO_HOUSE, [], {});
    expect(stepAt(steps, -1)).toBe(-1);
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 9)).toBe(1);
    expect(stepAt(steps, 999)).toBe(steps.length - 1);
    expect(ramp(0, 5, 10, 5)).toBe(2.5);
    expect(ramp(7, 19, 0, 0)).toBe(19);
    expect(chordAt(0)).toBe(CHORDS[0]);
    expect(chordAt(BAR_SECONDS * 5 + 1)).toBe(CHORDS[1]);
    for (const c of CHORDS) for (const f of c) expect(f).toBeGreaterThan(100);
  });
});
