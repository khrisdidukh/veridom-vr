import type { House } from "../house/model";
import { STAGES, stageAt } from "./stages";

// What an edit costs depends on how far the house is built. The rules say
// which work has to be redone; they do not invent prices.

export type ChangeKind =
  | "move"
  | "height"
  | "width"
  | "flip-swing"
  | "flip-hinge";

export type Target =
  | { type: "door" | "window"; id: string }
  | { type: "socket" | "switch"; id: string }
  | { type: "counter"; id: string };

export type Impact = {
  level: "plan" | "low" | "medium" | "high";
  /** Work that has to be redone, in build order. Empty for plan-only changes. */
  rework: string[];
  /** A sentence the owner can read in the headset. */
  summary: string;
  stage: number;
};

const SUMMARY: Record<Impact["level"], string> = {
  plan: "Only the plan changes. Nothing built has to be touched.",
  low: "Small rework on site.",
  medium: "Built work has to be opened and redone.",
  high: "Structural or finished work has to be torn out and rebuilt.",
};

function impact(level: Impact["level"], rework: string[], stage: number, note?: string): Impact {
  return { level, rework, stage, summary: note ? `${SUMMARY[level]} ${note}` : SUMMARY[level] };
}

function inWetRoom(h: House, roomId: string): boolean {
  return h.rooms.find((r) => r.id === roomId)?.wet ?? false;
}

export function assessImpact(h: House, target: Target, kind: ChangeKind, timeline: number): Impact {
  const s = stageAt(timeline);
  const STAGE = (id: string) => STAGES.findIndex((x) => x.id === id);
  const SHELL = STAGE("shell");
  const ROUGHIN = STAGE("roughin");
  const PLASTER = STAGE("plaster");
  const FINISH = STAGE("finish");

  switch (target.type) {
    case "socket":
    case "switch": {
      const p = h.points.find((x) => x.id === target.id);
      const wet = p ? inWetRoom(h, p.roomId) : false;
      if (s < ROUGHIN) return impact("plan", [], s);
      if (s === ROUGHIN) return impact("low", ["Re-route the cable", "Set a new wall box"], s);
      const rework = ["Cut a chase in the plastered wall", "Re-route the cable", "Set a new wall box", "Re-plaster and repaint"];
      if (s >= FINISH && wet) return impact("high", [...rework, "Replace wall tiles"], s);
      return impact("medium", rework, s);
    }
    case "door":
    case "window": {
      if (kind === "flip-swing" || kind === "flip-hinge") {
        if (s < FINISH) return impact("plan", [], s, "Order the frame for the new side.");
        return impact("low", ["Replace or re-hang the door frame"], s);
      }
      if (s < SHELL) return impact("plan", [], s);
      const rework = ["Rebuild the wall opening", "New lintel"];
      const note = "Ask your structural engineer before moving openings in a built wall.";
      if (s < PLASTER) return impact("high", rework, s, note);
      const more = target.type === "window" ? ["Repair insulation and facade"] : [];
      const fin = s >= FINISH ? ["Re-fit flooring and skirting", "Re-hang the " + target.type] : [];
      return impact("high", [...rework, ...more, "Re-plaster both sides", ...fin], s, note);
    }
    case "counter": {
      if (s < FINISH) return impact("plan", [], s, "Tell the kitchen maker before they build.");
      return impact("medium", ["Re-fit the kitchen base units", "New worktop cut-outs"], s);
    }
  }
}
