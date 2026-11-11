import { catalogById } from "../furnish/catalog";
import type { House } from "../house/model";

// What differs between the plan as it came and the owner's version of it.

export type Diff = { id: string; kind: "changed" | "added" | "removed"; label: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function compare<T extends { id: string }>(before: T[], after: T[], label: (t: T) => string, out: Diff[]) {
  const was = new Map(before.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const t of after) {
    seen.add(t.id);
    const old = was.get(t.id);
    if (!old) out.push({ id: t.id, kind: "added", label: label(t) });
    else if (!same(old, t)) out.push({ id: t.id, kind: "changed", label: label(t) });
  }
  for (const t of before) if (!seen.has(t.id)) out.push({ id: t.id, kind: "removed", label: label(t) });
}

/** Doors, windows, sockets, switches, fixtures and furniture that were changed, added or removed. */
export function diffHouses(before: House, after: House): Diff[] {
  const out: Diff[] = [];
  compare(before.openings, after.openings, (o) => o.label, out);
  compare(before.points, after.points, (p) => p.label, out);
  compare(before.fixtures, after.fixtures, (f) => f.label, out);
  compare(before.furniture, after.furniture, (f) => catalogById(f.catalogId)?.label ?? "Furniture", out);
  return out;
}

/** "3 changed · 1 added · 1 removed" */
export function diffSummary(d: Diff[]): string {
  const n = (k: Diff["kind"]) => d.filter((x) => x.kind === k).length;
  const parts = [[n("changed"), "changed"], [n("added"), "added"], [n("removed"), "removed"]] as const;
  return parts.filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}`).join(" · ") || "nothing changed";
}
