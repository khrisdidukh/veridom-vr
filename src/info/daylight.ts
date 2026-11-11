import { sunPosition, type Place } from "../env/sun";
import { headingDeg, roomAt } from "../site/align";
import { alongWall, wallById, type House, type Opening, type Room, type Vec2 } from "../house/model";
import { outward } from "./locate";

// Hours of direct sun per room, month by month: for every quarter of an hour
// of a mid-month day, does the sun stand in front of at least one of the
// room's windows? Only the sun's path and the windows' directions count —
// no trees, neighbours, roof overhangs or curtains.

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** Day of the year in the middle of each month. */
const MID_MONTH = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const STEP = 0.25; // hours

export type RoomWindow = { opening: Opening; out: Vec2 };

/** Glazed openings in exterior walls that belong to this room, with the direction they look out. */
export function roomWindows(h: House, room: Room): RoomWindow[] {
  const list: RoomWindow[] = [];
  for (const o of h.openings) {
    if (o.kind !== "window") continue;
    const w = wallById(h, o.wallId);
    if (!w.exterior) continue;
    const out = outward(h, w);
    const mid = alongWall(w, o.offset + o.width / 2);
    const d = w.thickness / 2 + 0.15;
    if (roomAt(h, { x: mid.x - out.x * d, z: mid.z - out.z * d })?.id === room.id) list.push({ opening: o, out });
  }
  return list;
}

/** Does the sun (true azimuth and elevation, degrees) shine in through a window that looks along `out`? */
export function sunEnters(out: Vec2, azimuth: number, elevation: number, northOffsetDeg: number): boolean {
  if (elevation < 2) return false;
  // True bearing → plan bearing: true north lies northOffset clockwise of plan north.
  const b = ((azimuth + northOffsetDeg) * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return Math.cos(el) * (Math.sin(b) * out.x + Math.cos(b) * out.z) > 0.1;
}

/** Hours of direct sun for each room and each month. `northOffsetDeg` is true north clockwise of plan north. */
export function sunHours(h: House, place: Pick<Place, "lat" | "lon">, northOffsetDeg = h.northOffsetDeg): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const windows = h.rooms.map((r) => roomWindows(h, r));
  h.rooms.forEach((r) => (out[r.id] = new Array<number>(12).fill(0)));
  for (let m = 0; m < 12; m++) {
    for (let t = 0; t < 24; t += STEP) {
      const sun = sunPosition(place.lat, place.lon, MID_MONTH[m]!, t, place.lon / 15);
      if (sun.elevation < 2) continue;
      h.rooms.forEach((r, i) => {
        if (windows[i]!.some((w) => sunEnters(w.out, sun.azimuth, sun.elevation, northOffsetDeg))) out[r.id]![m]! += STEP;
      });
    }
  }
  return out;
}

const SIDES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** "south, east": the compass sides this room's windows face. */
export function windowSides(h: House, room: Room, northOffsetDeg = h.northOffsetDeg): string[] {
  const seen = new Set<string>();
  for (const w of roomWindows(h, room)) seen.add(SIDES[Math.round(headingDeg(northOffsetDeg, w.out) / 45) % 8]!);
  return SIDES.filter((s) => seen.has(s));
}

export const hoursText = (h: number) => (h === 0 ? "none" : `${h % 1 ? h.toFixed(1) : h} h`);

/** The few lines of a room's daylight footnote. `month` is 0…11. */
export function roomDaylightNote(h: House, room: Room, hours: number[], month: number, northOffsetDeg = h.northOffsetDeg): { title: string; lines: string[]; foot: string } {
  const sides = windowSides(h, room, northOffsetDeg);
  const area = ((room.max.x - room.min.x) * (room.max.z - room.min.z)).toFixed(1);
  if (!sides.length) return { title: room.name, lines: [`${area} m² · no window to the outside`, "Direct sun: none, all year"], foot: "Daylight only through doors" };
  return {
    title: room.name,
    lines: [`${area} m² · windows face ${sides.join(", ")}`, `Direct sun in ${MONTH_NAMES[month]}: ${(hours[month] ?? 0) === 0 ? "none" : `${hoursText(hours[month]!)} a day`}`, `Jun ${hoursText(hours[5] ?? 0)} · Dec ${hoursText(hours[11] ?? 0)}`],
    foot: "Sun path only — trees and neighbours not counted",
  };
}
