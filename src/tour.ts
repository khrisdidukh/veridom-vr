import type { Finding } from "./edit/checks";
import { footprint as itemFootprint } from "./furnish/catalog";
import { alongWall, wallFrame, type House, type Room, type Vec2 } from "./house/model";
import { roomAt } from "./site/align";

// A guided tour of about a minute, written for whatever house is loaded: the
// build grows on the table, the camera goes from room to room through the
// doors (with the room's name, size and one useful fact), a wall opens, the
// sun crosses the sky, and the view rises to the whole home from above.

export type TourAction =
  | { do: "mode"; mode: "model" | "walk"; room?: string; at?: [number, number, number] }
  | { do: "timeline"; from: number; to: number; seconds: number }
  | { do: "pan"; from: number; to: number; seconds: number }
  | { do: "cutaway"; assembly: "ext-wall" | "floor" }
  | { do: "close" }
  | { do: "xray"; on: boolean }
  | { do: "light"; from: number; to: number; seconds: number }
  | { do: "dollhouse" }
  | { do: "end" };

export type Caption = { title: string; line?: string };
export type TourStep = { at: number; caption: Caption; actions: TourAction[] };

const area = (r: Room) => (r.max.x - r.min.x) * (r.max.z - r.min.z);
const centre = (r: Room): Vec2 => ({ x: (r.min.x + r.max.x) / 2, z: (r.min.z + r.max.z) / 2 });

/** For every door: where it is and the room on each side (null is outdoors). */
export function doorLinks(h: House): { at: Vec2; a: Room | null; b: Room | null }[] {
  return h.openings
    .filter((o) => o.kind === "door")
    .map((o) => {
      const w = h.walls.find((x) => x.id === o.wallId)!;
      const { left } = wallFrame(w);
      const at = alongWall(w, o.offset + o.width / 2);
      const d = w.thickness / 2 + 0.2;
      return { at, a: roomAt(h, { x: at.x + left.x * d, z: at.z + left.z * d }), b: roomAt(h, { x: at.x - left.x * d, z: at.z - left.z * d }) };
    });
}

/** The order to visit the rooms in: in through the front door, then door by door; rooms no door leads to come last. */
export function route(h: House, max = 6): { room: Room; via: Vec2 | null }[] {
  const links = doorLinks(h);
  const out: { room: Room; via: Vec2 | null }[] = [];
  const seen = new Set<string>();
  const queue: { room: Room; via: Vec2 | null }[] = [];
  const entry = links.find((l) => (l.a === null) !== (l.b === null));
  if (entry) queue.push({ room: (entry.a ?? entry.b)!, via: entry.at });
  for (;;) {
    const next = queue.shift() ?? (() => {
      const r = h.rooms.find((x) => !seen.has(x.id));
      return r ? { room: r, via: null } : null;
    })();
    if (!next) break;
    if (seen.has(next.room.id)) continue;
    seen.add(next.room.id);
    out.push(next);
    for (const l of links) {
      const other = l.a?.id === next.room.id ? l.b : l.b?.id === next.room.id ? l.a : null;
      if (other && !seen.has(other.id)) queue.push({ room: other, via: l.at });
    }
  }
  return out.slice(0, max);
}

/** Where the camera stands in a room: just inside the door it came through, clear of furniture, looking into the room. */
export function standIn(h: House, room: Room, via: Vec2 | null, lookAt?: Vec2): { x: number; z: number; heading: number } {
  const boxes = [...h.furniture.map(itemFootprint), ...h.fixtures.map((f) => ({ min: f.min, max: f.max }))];
  const c = centre(room);
  const m = Math.min(0.6, (room.max.x - room.min.x) / 4, (room.max.z - room.min.z) / 4);
  let best: Vec2 = c, score = Infinity;
  // Keep a good step away from furniture; in a crowded room settle for less.
  for (const clear of [0.6, 0.35]) {
    if (score < Infinity) break;
    for (let i = 0; i <= 36; i++) {
      const p = { x: room.min.x + m + ((room.max.x - room.min.x - 2 * m) * (i % 6)) / 5, z: room.min.z + m + ((room.max.z - room.min.z - 2 * m) * Math.floor(i / 6)) / 5 };
      if (i >= 36 || boxes.some((b) => p.x > b.min.x - clear && p.x < b.max.x + clear && p.z > b.min.z - clear && p.z < b.max.z + clear)) continue;
      const toDoor = via ? Math.hypot(p.x - via.x, p.z - via.z) : 0;
      // Near the door but a good step inside; without a door, near the middle.
      const s = via ? Math.abs(toDoor - 1.2) : Math.hypot(p.x - c.x, p.z - c.z);
      if (s < score) {
        score = s;
        best = p;
      }
    }
  }
  // Look at what the caption talks about, when it names a thing; else into the room.
  const aim = lookAt && Math.hypot(lookAt.x - best.x, lookAt.z - best.z) > 0.5 ? lookAt : c;
  let dx = aim.x - best.x, dz = aim.z - best.z;
  if (Math.hypot(dx, dz) < 0.3) [dx, dz] = room.max.x - room.min.x >= room.max.z - room.min.z ? [1, 0] : [0, 1];
  return { x: best.x, z: best.z, heading: (Math.atan2(dx, dz) * 180) / Math.PI };
}

/** One plain, useful thing about a room: a plan problem in it, else its daylight. */
export function roomPoint(h: House, room: Room, findings: Finding[], hours: number[] | undefined, used: Set<string>): { text: string; spot?: Vec2 } {
  const inRoom = (id: string): boolean => {
    const o = h.openings.find((x) => x.id === id);
    if (o) return doorLinks(h).some((l) => (l.a?.id === room.id || l.b?.id === room.id) && Math.hypot(l.at.x - alongWall(h.walls.find((w) => w.id === o.wallId)!, o.offset + o.width / 2).x, l.at.z - alongWall(h.walls.find((w) => w.id === o.wallId)!, o.offset + o.width / 2).z) < 0.01);
    const f = h.fixtures.find((x) => x.id === id);
    if (f) return f.roomId === room.id;
    const p = h.points.find((x) => x.id === id);
    if (p) return p.roomId === room.id;
    const it = h.furniture.find((x) => x.id === id);
    return !!it && roomAt(h, it)?.id === room.id;
  };
  // A problem belongs to the room of the thing that is hit or hidden (toilet, switch, wardrobe); one between doors only, to a room they open into.
  const things = (f: Finding) => f.elementIds.filter((id) => !h.openings.some((o) => o.id === id));
  const mine = findings.find((f) => !used.has(f.id) && (things(f).length ? things(f).some(inRoom) : f.elementIds.some(inRoom)));
  if (mine) {
    used.add(mine.id);
    // Where the problem is: the fixture, switch or piece of furniture it names.
    const id = things(mine)[0];
    const fx = h.fixtures.find((x) => x.id === id);
    const pt = h.points.find((x) => x.id === id);
    const fu = h.furniture.find((x) => x.id === id);
    const spot = fx ? { x: (fx.min.x + fx.max.x) / 2, z: (fx.min.z + fx.max.z) / 2 } : pt ? alongWall(h.walls.find((w) => w.id === pt.wallId)!, pt.offset) : fu ? { x: fu.x, z: fu.z } : undefined;
    return { text: `⚠ ${mine.title}`, spot };
  }
  const jun = hours?.[5] ?? 0, dec = hours?.[11] ?? 0;
  const fmt = (v: number) => (v % 1 ? v.toFixed(1) : String(v));
  if (jun === 0 && dec === 0) return { text: "No window to the outside: light comes through the doors" };
  return { text: `Direct sun: ${fmt(jun)} h a day in June, ${dec === 0 ? "none" : `${fmt(dec)} h`} in December` };
}

/** The whole tour for this house. `at` is seconds from the start; views are plan x, plan z and compass heading. */
export function buildTour(h: House, findings: Finding[], hours: Record<string, number[]>): TourStep[] {
  const steps: TourStep[] = [];
  let t = 0;
  const add = (seconds: number, caption: Caption, actions: TourAction[]) => {
    steps.push({ at: t, caption, actions });
    t += seconds;
  };
  const total = h.rooms.reduce((s, r) => s + area(r), 0);
  add(8, { title: h.name, line: "Your home, before a single brick is laid." }, [{ do: "close" }, { do: "xray", on: false }, { do: "mode", mode: "model" }, { do: "timeline", from: 0, to: 5, seconds: 7 }]);
  const stops = route(h);
  const used = new Set<string>();
  // The wall and the sun are shown in the sunniest room.
  const sunny = [...stops].sort((a, b) => (hours[b.room.id]?.[5] ?? 0) - (hours[a.room.id]?.[5] ?? 0))[0];
  const first = sunny ? standIn(h, sunny.room, sunny.via) : null;
  for (const s of stops) {
    const point = roomPoint(h, s.room, findings, hours[s.room.id], used);
    const v = standIn(h, s.room, s.via, point.spot);
    add(6, { title: `${s.room.name} · ${area(s.room).toFixed(1)} m²`, line: point.text }, [
      { do: "mode", mode: "walk", room: s.room.id, at: [v.x, v.z, v.heading] },
      { do: "pan", from: -18, to: 18, seconds: 6 },
    ]);
  }
  if (sunny && first) {
    add(5, { title: "See inside the walls", line: "Pinch any wall for its layers, and what each one does and costs." }, [{ do: "mode", mode: "walk", room: sunny.room.id, at: [first.x, first.z, first.heading] }, { do: "cutaway", assembly: "ext-wall" }]);
    add(7, { title: "The real sun over the plot", line: "From morning to evening, for any month of the year." }, [{ do: "close" }, { do: "light", from: 7, to: 19, seconds: 6 }]);
  }
  add(7, { title: "The whole home", line: `${h.rooms.length} rooms · ${total.toFixed(0)} m² · now walk through it yourself.` }, [{ do: "close" }, { do: "dollhouse" }]);
  add(0, { title: "" }, [{ do: "end" }]);
  return steps;
}

/** The step that is showing at time t (seconds), or -1 before the start. */
export function stepAt(steps: TourStep[], t: number): number {
  let i = -1;
  for (let k = 0; k < steps.length; k++) if (t >= steps[k]!.at) i = k;
  return i;
}

/** Value of a ramp that started `elapsed` seconds ago. */
export function ramp(from: number, to: number, seconds: number, elapsed: number): number {
  const f = seconds <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / seconds));
  return from + (to - from) * f;
}
