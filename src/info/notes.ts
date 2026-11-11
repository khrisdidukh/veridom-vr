import type { Finding } from "../edit/checks";
import { STAGES } from "../edit/stages";
import type { Target } from "../edit/impact";
import type { House } from "../house/model";
import { ASSEMBLIES, FITTINGS, SERVICES, insulationShare, stageName, thickness, totalMm, uValue, type AssemblyId, type ServiceId } from "./catalog";

// Turns "what did the owner tap" into the few lines a floating label shows.

export type InfoTarget =
  | { kind: "assembly"; assembly: AssemblyId }
  | { kind: "layer"; assembly: AssemblyId; layer: string }
  | { kind: "service"; service: ServiceId }
  | { kind: "finding"; id: string }
  | { kind: "element"; target: Target };

export type NoteText = { title: string; lines: string[]; foot: string; tone: "info" | "warn" };

/** Prices are rough ranges; every place that shows one says so. */
export const APPROX_NOTE = "Approximate figures — confirm with your builder";
const approx = (guide: string) => `Approx. price: ≈ ${guide} — confirm with your builder`;

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** Is this stage already built at timeline value t? Tells the owner if a change is still free. */
function stageLine(stageId: (typeof STAGES)[number]["id"], timeline: number): string {
  const i = STAGES.findIndex((s) => s.id === stageId);
  const state = timeline >= i ? "built" : timeline > i - 1 ? "being built" : "not built yet — still free to change";
  return `Stage: ${stageName(stageId)} · ${state}`;
}

export function assemblySummary(id: AssemblyId): string {
  const a = ASSEMBLIES[id];
  return `${a.layers.length} layers · ${thickness(totalMm(a))} · U = ${uValue(a).toFixed(2)} W/m²K`;
}

export function noteFor(h: House, findings: Finding[], t: InfoTarget, timeline: number): NoteText | null {
  if (t.kind === "assembly") {
    const a = ASSEMBLIES[t.assembly];
    return {
      title: a.name,
      lines: [assemblySummary(t.assembly), `Layers, ${a.order}: ${a.layers.map((l) => l.name.toLowerCase()).join(", ")}.`, "Pinch a layer to see what it does.", `${APPROX_NOTE}.`],
      foot: "Pinch the wall again to close it",
      tone: "info",
    };
  }
  if (t.kind === "layer") {
    const a = ASSEMBLIES[t.assembly];
    const l = a.layers.find((x) => x.id === t.layer);
    if (!l) return null;
    const share = Math.round(insulationShare(a, l) * 100);
    return {
      title: `${l.name} · ${thickness(l.mm)}`,
      lines: [l.what, `λ ${l.lambda} W/mK · ${share < 1 ? "under 1" : share} % of the ${a.name.toLowerCase()}'s insulation`, l.why, approx(l.guide)],
      foot: stageLine(l.stage, timeline),
      tone: "info",
    };
  }
  if (t.kind === "service") {
    const s = SERVICES[t.service];
    return { title: s.title, lines: [s.spec, s.why, approx(s.guide)], foot: stageLine(s.stage, timeline), tone: "info" };
  }
  if (t.kind === "finding") {
    const f = findings.find((x) => x.id === t.id);
    if (!f) return null;
    return { title: f.title, lines: [f.detail], foot: "Pinch the door or fitting to change it", tone: "warn" };
  }
  const e = t.target;
  const problem = findings.find((f) => f.elementIds.includes(e.id));
  const warn = problem ? [`⚠ ${problem.title}. ${problem.detail}`] : [];
  if (e.type === "door" || e.type === "window") {
    const o = h.openings.find((x) => x.id === e.id);
    if (!o) return null;
    const f = FITTINGS[e.type];
    const spec = e.type === "door"
      ? `${cm(o.width)} × ${cm(o.height)} · hinge at the ${o.hinge ?? "start"}, opens ${o.swing ?? "right"}`
      : `${cm(o.width)} × ${cm(o.height)} · sill ${cm(o.sill)} above the floor`;
    return { title: o.label, lines: [spec, ...(problem ? warn : [f.why]), approx(f.guide)], foot: stageLine(f.stage, timeline), tone: problem ? "warn" : "info" };
  }
  if (e.type === "socket" || e.type === "switch") {
    const p = h.points.find((x) => x.id === e.id);
    if (!p) return null;
    const f = FITTINGS[e.type];
    return { title: p.label, lines: [`${cm(p.height)} above the floor`, ...(problem ? warn : [f.why]), approx(f.guide)], foot: stageLine(f.stage, timeline), tone: problem ? "warn" : "info" };
  }
  const fx = h.fixtures.find((x) => x.id === e.id);
  if (!fx) return null;
  const f = FITTINGS.counter;
  return { title: fx.label, lines: [`Worktop ${cm(fx.height)} high`, ...(problem ? warn : [f.why]), approx(f.guide)], foot: stageLine(f.stage, timeline), tone: problem ? "warn" : "info" };
}
