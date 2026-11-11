// A small reader for IFC files (STEP text, IFC2x3 and IFC4): enough to get the
// walls, doors, windows and storeys of an ordinary house into the plan format.
// It reads straight walls with an "Axis" line or an extruded rectangular or
// polyline profile, doors and windows from their placement and overall size,
// storeys, length units and Pset_WallCommon.IsExternal. It does not read rooms,
// slabs, roofs, stairs, curved or sloped walls. The result goes through the
// same checks as a JSON plan.

type Ref = { ref: number };
type Val = number | string | null | Ref | Val[];
type Entity = { id: number; type: string; a: Val[] };
export type IfcResult = { plan: Record<string, unknown>; warnings: string[] } | { errors: string[] };

const isRef = (v: Val | undefined): v is Ref => typeof v === "object" && v !== null && !Array.isArray(v);
const asNum = (v: Val | undefined): number | null => (typeof v === "number" ? v : null);
const asList = (v: Val | undefined): Val[] => (Array.isArray(v) ? v : []);

/** Parses the arguments of one STEP entity: numbers, 'strings', #refs, .ENUMS., $, lists, and TYPED(values). */
function parseArgs(src: string): Val[] {
  let i = 0;
  const list = (): Val[] => {
    const out: Val[] = [];
    for (;;) {
      while (/\s/.test(src[i] ?? "")) i++;
      const c = src[i];
      if (c === undefined || c === ")") {
        i++;
        return out;
      }
      if (c === ",") {
        i++;
      } else if (c === "(") {
        i++;
        out.push(list());
      } else if (c === "'") {
        let s = "";
        for (i++; i < src.length; i++) {
          if (src[i] === "'") {
            if (src[i + 1] === "'") {
              s += "'";
              i++;
            } else break;
          } else s += src[i];
        }
        i++;
        out.push(s);
      } else if (c === "#") {
        const m = /^#(\d+)/.exec(src.slice(i))!;
        i += m[0].length;
        out.push({ ref: Number(m[1]) });
      } else if (c === "$" || c === "*") {
        i++;
        out.push(null);
      } else {
        const m = /^[^,()]+/.exec(src.slice(i))!;
        i += m[0].length;
        const word = m[0].trim();
        if (src[i] === "(") {
          // A typed value such as IFCLENGTHMEASURE(0.3): keep what is inside.
          i++;
          const inner = list();
          out.push(inner.length === 1 ? inner[0]! : inner);
        } else out.push(/^[-+]?(\d|\.\d)/.test(word) ? Number(word) : word);
      }
    }
  };
  return list();
}

export function ifcToPlan(text: string): IfcResult {
  if (!/^\s*ISO-10303-21/.test(text)) return { errors: ["This is not an IFC file (it does not start with ISO-10303-21)."] };
  const ents = new Map<number, Entity>();
  const byType = new Map<string, Entity[]>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/g;
  // Statements end with ";" outside of strings: cut the text there first.
  let quote = false, start = 0;
  const stmts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quote = !quote;
    else if (c === ";" && !quote) {
      stmts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  for (const s of stmts) {
    re.lastIndex = 0;
    const m = re.exec(s);
    if (!m) continue;
    const e: Entity = { id: Number(m[1]), type: m[2]!, a: parseArgs(s.slice(re.lastIndex)) };
    ents.set(e.id, e);
    const l = byType.get(e.type);
    if (l) l.push(e);
    else byType.set(e.type, [e]);
  }
  const get = (v: Val | undefined): Entity | null => (isRef(v) ? ents.get(v.ref) ?? null : null);
  const all = (...types: string[]) => types.flatMap((t) => byType.get(t) ?? []);
  const warnings = ["IFC import is experimental: straight walls, doors, windows and storeys are read; rooms, slabs, roofs, curved and sloped walls are not. Check the door and window positions."];

  // Length unit → metres.
  let k = 1;
  const prefix = (v: Val | undefined) => (v === ".MILLI." ? 0.001 : v === ".CENTI." ? 0.01 : v === ".DECI." ? 0.1 : 1);
  const assigned = asList(all("IFCUNITASSIGNMENT")[0]?.a[0]).map(get);
  for (const u of assigned) {
    if (u?.type === "IFCSIUNIT" && u.a[1] === ".LENGTHUNIT.") k = prefix(u.a[2]);
    if (u?.type === "IFCCONVERSIONBASEDUNIT" && u.a[1] === ".LENGTHUNIT.") {
      const m = get(u.a[3]);
      k = (asNum(m?.a[0]) ?? 1) * prefix(get(m?.a[1])?.a[2]);
    }
  }

  // Placements: an origin and a turn around the vertical axis.
  type Frame = { x: number; y: number; z: number; c: number; s: number };
  const ID: Frame = { x: 0, y: 0, z: 0, c: 1, s: 0 };
  const point = (v: Val | undefined) => asList(get(v)?.a[0]).map((n) => asNum(n) ?? 0);
  const axis = (e: Entity | null): Frame => {
    if (!e) return ID;
    const p = point(e.a[0]);
    const d = asList(get(e.type === "IFCAXIS2PLACEMENT2D" ? e.a[1] : e.a[2])?.a[0]).map((n) => asNum(n) ?? 0);
    const len = Math.hypot(d[0] ?? 1, d[1] ?? 0) || 1;
    return { x: (p[0] ?? 0) * k, y: (p[1] ?? 0) * k, z: (p[2] ?? 0) * k, c: (d[0] ?? 1) / len, s: (d[1] ?? 0) / len };
  };
  const mul = (p: Frame, q: Frame): Frame => ({ x: p.x + p.c * q.x - p.s * q.y, y: p.y + p.s * q.x + p.c * q.y, z: p.z + q.z, c: p.c * q.c - p.s * q.s, s: p.s * q.c + p.c * q.s });
  const placed = new Map<number, Frame>();
  const placement = (v: Val | undefined, depth = 0): Frame => {
    const e = get(v);
    if (!e || e.type !== "IFCLOCALPLACEMENT" || depth > 50) return ID;
    const hit = placed.get(e.id);
    if (hit) return hit;
    const f = mul(placement(e.a[0], depth + 1), axis(get(e.a[1])));
    placed.set(e.id, f);
    return f;
  };
  const apply = (f: Frame, x: number, y: number) => ({ x: f.x + f.c * x - f.s * y, y: f.y + f.s * x + f.c * y });

  // Which storey each element is in.
  const storeys = all("IFCBUILDINGSTOREY").map((e) => ({ e, name: typeof e.a[2] === "string" && e.a[2] ? e.a[2] : `Storey ${e.id}`, elevation: asNum(e.a[9]) !== null ? asNum(e.a[9])! * k : placement(e.a[5]).z }));
  storeys.sort((a, b) => a.elevation - b.elevation);
  const storeyOf = new Map<number, number>();
  for (const r of all("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const si = storeys.findIndex((s) => isRef(r.a[5]) && s.e.id === r.a[5].ref);
    if (si >= 0) for (const el of asList(r.a[4])) if (isRef(el)) storeyOf.set(el.ref, si);
  }
  if (!storeys.length) storeys.push({ e: { id: 0, type: "", a: [] }, name: "Level 1", elevation: 0 });

  // Pset_WallCommon.IsExternal and material layer thickness.
  const external = new Map<number, boolean>();
  for (const r of all("IFCRELDEFINESBYPROPERTIES")) {
    for (const p of asList(get(r.a[5])?.a[4]).map(get)) {
      if (p?.type === "IFCPROPERTYSINGLEVALUE" && p.a[0] === "IsExternal") for (const el of asList(r.a[4])) if (isRef(el)) external.set(el.ref, p.a[2] === ".T.");
    }
  }
  const layered = new Map<number, number>();
  for (const r of all("IFCRELASSOCIATESMATERIAL")) {
    let m = get(r.a[5]);
    if (m?.type === "IFCMATERIALLAYERSETUSAGE") m = get(m.a[0]);
    if (m?.type !== "IFCMATERIALLAYERSET") continue;
    const t = asList(m.a[0]).reduce<number>((sum, l) => sum + (asNum(get(l)?.a[1]) ?? 0) * k, 0);
    if (t > 0) for (const el of asList(r.a[4])) if (isRef(el)) layered.set(el.ref, t);
  }

  // Walls.
  type W = { id: string; ent: number; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number | null; height: number | null; storey: number };
  const walls: W[] = [];
  let skipped = 0;
  for (const e of all("IFCWALLSTANDARDCASE", "IFCWALL", "IFCWALLELEMENTEDCASE")) {
    const P = placement(e.a[5]);
    let a: { x: number; y: number } | null = null, b: { x: number; y: number } | null = null;
    let thickness: number | null = layered.get(e.id) ?? null, height: number | null = null;
    for (const rep of asList(get(e.a[6])?.a[2]).map(get)) {
      for (const item of asList(rep?.a[3]).map(get)) {
        if (rep?.a[1] === "Axis" && item?.type === "IFCPOLYLINE") {
          const pts = asList(item.a[0]).map(point);
          if (pts.length >= 2) {
            a = apply(P, pts[0]![0]! * k, (pts[0]![1] ?? 0) * k);
            b = apply(P, pts[pts.length - 1]![0]! * k, (pts[pts.length - 1]![1] ?? 0) * k);
          }
        }
        if (item?.type === "IFCEXTRUDEDAREASOLID") {
          height = (asNum(item.a[3]) ?? 0) * k || null;
          const prof = get(item.a[0]);
          const F = mul(P, axis(get(item.a[1])));
          let x0 = 0, x1 = 0, ym = 0, t: number | null = null;
          if (prof?.type === "IFCRECTANGLEPROFILEDEF") {
            const c = axis(get(prof.a[2]));
            const xd = (asNum(prof.a[3]) ?? 0) * k, yd = (asNum(prof.a[4]) ?? 0) * k;
            // The long side of the rectangle is the wall's run.
            if (Math.abs(c.s) < 0.5) [x0, x1, ym, t] = [c.x - xd / 2, c.x + xd / 2, c.y, yd];
            else [x0, x1, ym, t] = [c.x - yd / 2, c.x + yd / 2, c.y, xd];
          } else if (prof?.type === "IFCARBITRARYCLOSEDPROFILEDEF" && get(prof.a[2])?.type === "IFCPOLYLINE") {
            const pts = asList(get(prof.a[2])!.a[0]).map(point);
            const xs = pts.map((p) => (p[0] ?? 0) * k), ys = pts.map((p) => (p[1] ?? 0) * k);
            [x0, x1, ym, t] = [Math.min(...xs), Math.max(...xs), (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...ys) - Math.min(...ys)];
          }
          if (t !== null && t > 0) {
            thickness ??= t;
            if (!a) {
              a = apply(F, x0, ym);
              b = apply(F, x1, ym);
            }
          }
        }
      }
    }
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 0.2) {
      skipped++;
      continue;
    }
    walls.push({ id: `wall-${e.id}`, ent: e.id, a, b, thickness, height, storey: storeyOf.get(e.id) ?? 0 });
  }
  if (!walls.length) return { errors: [`No wall with a readable axis or a straight extruded body was found (${all("IFCWALLSTANDARDCASE", "IFCWALL").length} IfcWall entities in the file).`] };
  if (skipped) warnings.push(`${skipped} wall${skipped > 1 ? "s were" : " was"} left out: no straight axis or body could be read.`);

  // Doors and windows: through their opening to the wall, else the nearest wall.
  const wallOfOpening = new Map<number, number>();
  for (const r of all("IFCRELVOIDSELEMENT")) if (isRef(r.a[4]) && isRef(r.a[5])) wallOfOpening.set(r.a[5].ref, r.a[4].ref);
  const hostOf = new Map<number, number>();
  for (const r of all("IFCRELFILLSELEMENT")) if (isRef(r.a[4]) && isRef(r.a[5]) && wallOfOpening.has(r.a[4].ref)) hostOf.set(r.a[5].ref, wallOfOpening.get(r.a[4].ref)!);
  const openings: { level: number; o: Record<string, unknown> }[] = [];
  let lost = 0;
  for (const e of all("IFCDOOR", "IFCDOORSTANDARDCASE", "IFCWINDOW", "IFCWINDOWSTANDARDCASE")) {
    const door = e.type.startsWith("IFCDOOR");
    const height = (asNum(e.a[8]) ?? 0) * k, width = (asNum(e.a[9]) ?? 0) * k;
    const P = placement(e.a[5]);
    const along = (w: W) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const d = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
      const t = (P.x - w.a.x) * d.x + (P.y - w.a.y) * d.y;
      return { len, t, off: Math.abs((P.x - w.a.x) * -d.y + (P.y - w.a.y) * d.x), same: P.c * d.x + P.s * d.y >= 0 };
    };
    let w = walls.find((x) => x.ent === hostOf.get(e.id));
    if (!w) w = walls.map((x) => ({ x, m: along(x) })).filter(({ m }) => m.off < 0.6 && m.t > -0.3 && m.t < m.len + 0.3).sort((p, q) => p.m.off - q.m.off)[0]?.x;
    if (!w || !(width > 0)) {
      lost++;
      continue;
    }
    const m = along(w);
    // The placement origin is the corner where the element's own x axis starts.
    const offset = Math.max(0, Math.min(m.len - width, m.same ? m.t : m.t - width));
    const sill = Math.max(0, P.z - (storeys[w.storey]?.elevation ?? 0));
    openings.push({ level: w.storey, o: { id: `${door ? "door" : "window"}-${e.id}`, type: door ? "door" : "window", name: typeof e.a[2] === "string" && e.a[2] ? e.a[2] : door ? "Door" : "Window", wall: w.id, offset: +offset.toFixed(3), width: +width.toFixed(3), height: +(height || (door ? 2.1 : 1.4)).toFixed(3), sill: door ? 0 : +sill.toFixed(3) } });
  }
  if (lost) warnings.push(`${lost} door${lost > 1 ? "s or windows were" : " or window was"} left out: no host wall or no width.`);

  const anyExternal = walls.some((w) => external.has(w.ent));
  const levels = storeys
    .map((s, i) => {
      const ws = walls.filter((w) => w.storey === i);
      const hs = ws.map((w) => w.height ?? 0).filter((h) => h > 0);
      return {
        id: `storey-${i + 1}`,
        name: s.name,
        height: Math.max(2.2, Math.min(6, hs.length ? Math.max(...hs) : 2.6)),
        walls: ws.map((w) => ({
          id: w.id,
          from: [+w.a.x.toFixed(3), +w.a.y.toFixed(3)],
          to: [+w.b.x.toFixed(3), +w.b.y.toFixed(3)],
          thickness: +Math.max(0.05, Math.min(1, w.thickness ?? (external.get(w.ent) ? 0.38 : 0.12))).toFixed(3),
          ...(anyExternal ? { exterior: external.get(w.ent) === true } : {}),
        })),
        openings: openings.filter((o) => o.level === i).map((o) => {
          // A window that would poke through the ceiling is trimmed rather than refused.
          const h = Math.max(2.2, Math.min(6, hs.length ? Math.max(...hs) : 2.6));
          const sill = Math.min(o.o.sill as number, h - 0.4);
          return { ...o.o, sill, height: Math.min(o.o.height as number, h - sill) };
        }),
      };
    })
    .filter((l) => l.walls.length);
  const project = all("IFCPROJECT")[0];
  const name = (typeof project?.a[2] === "string" && project.a[2]) || (typeof project?.a[7] === "string" && project.a[7]) || "IFC model";
  return { plan: { format: "veridom-plan", version: 1, name, units: "m", levels }, warnings };
}
