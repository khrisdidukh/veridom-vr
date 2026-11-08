import { cloneHouse, wallById, wallLength, type House } from "../house/model";
import { assessImpact, type ChangeKind, type Impact, type Target } from "./impact";
import { STAGES, stageAt } from "./stages";

export type Change = {
  id: string;
  at: string;
  target: Target;
  label: string;
  kind: ChangeKind;
  description: string;
  stageName: string;
  impact: Impact;
};

export type EditResult = { house: House; change: Change } | { error: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Applies one owner edit to a copy of the house and records what it would
 * cost at the current point on the timeline.
 */
export function applyEdit(h: House, target: Target, kind: ChangeKind, amount: number, timeline: number, now = new Date()): EditResult {
  const next = cloneHouse(h);
  let label = "";
  let description = "";

  if (target.type === "door" || target.type === "window") {
    const o = next.openings.find((x) => x.id === target.id);
    if (!o) return { error: "Unknown opening" };
    label = o.label;
    const len = wallLength(wallById(next, o.wallId));
    if (kind === "move") {
      const before = o.offset;
      o.offset = round(clamp(o.offset + amount, 0.3, len - o.width - 0.3));
      if (o.offset === before) return { error: "It can't move further along this wall." };
      description = `Moved ${Math.abs(round(o.offset - before)) * 100} cm ${amount > 0 ? "along" : "back along"} the wall`;
    } else if (kind === "width") {
      const before = o.width;
      o.width = round(clamp(o.width + amount, 0.6, Math.min(3, len - o.offset - 0.3)));
      if (o.width === before) return { error: "That width doesn't fit here." };
      description = `Width ${before * 100} → ${o.width * 100} cm`;
    } else if (kind === "flip-swing" && o.kind === "door") {
      o.swing = o.swing === "left" ? "right" : "left";
      description = "Door now opens to the other side";
    } else if (kind === "flip-hinge" && o.kind === "door") {
      o.hinge = o.hinge === "end" ? "start" : "end";
      description = "Hinge moved to the other jamb";
    } else return { error: "Not possible for this element." };
  } else if (target.type === "socket" || target.type === "switch") {
    const p = next.points.find((x) => x.id === target.id);
    if (!p) return { error: "Unknown point" };
    label = p.label;
    if (kind === "move") {
      const len = wallLength(wallById(next, p.wallId));
      const before = p.offset;
      p.offset = round(clamp(p.offset + amount, 0.15, len - 0.15));
      if (p.offset === before) return { error: "It can't move further along this wall." };
      description = `Moved ${Math.abs(round(p.offset - before)) * 100} cm along the wall`;
    } else if (kind === "height") {
      const before = p.height;
      p.height = round(clamp(p.height + amount, 0.2, 1.6));
      if (p.height === before) return { error: "Height limit reached." };
      description = `Height ${Math.round(before * 100)} → ${Math.round(p.height * 100)} cm`;
    } else return { error: "Not possible for this element." };
  } else if (target.type === "counter") {
    const f = next.fixtures.find((x) => x.id === target.id);
    if (!f) return { error: "Unknown fixture" };
    label = f.label;
    if (kind !== "height") return { error: "Not possible for this element." };
    const before = f.height;
    f.height = round(clamp(f.height + amount, 0.8, 1.05));
    if (f.height === before) return { error: "Height limit reached." };
    description = `Worktop height ${Math.round(before * 100)} → ${Math.round(f.height * 100)} cm`;
  }

  const impact = assessImpact(next, target, kind, timeline);
  return {
    house: next,
    change: {
      id: `chg-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      at: now.toISOString(),
      target,
      label,
      kind,
      description,
      stageName: STAGES[stageAt(timeline)]!.name,
      impact,
    },
  };
}

/** Plain-text change request the owner can send to the architect. */
export function changeRequestText(houseName: string, changes: Change[]): string {
  const lines = [`Change requests — ${houseName}`, ""];
  changes.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.label}: ${c.description}.`);
    lines.push(`   Checked at stage "${c.stageName}". ${c.impact.summary}`);
    if (c.impact.rework.length) lines.push(`   Rework: ${c.impact.rework.join("; ")}.`);
  });
  return lines.join("\n");
}
