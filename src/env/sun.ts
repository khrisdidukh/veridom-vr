// Sun position for a place, day of year and local clock time (NOAA approximation,
// good to about half a degree — plenty to see how light falls into a room).

export type SunPos = { elevation: number; azimuth: number }; // degrees; azimuth clockwise from north

export const FRANZEN = { lat: 48.57, lon: 15.33 }; // Franzen, Waldviertel, Lower Austria

export const MONTHS = [
  { id: "mar", label: "March", day: 79, utcOffset: 1 },
  { id: "jun", label: "June", day: 172, utcOffset: 2 },
  { id: "sep", label: "September", day: 265, utcOffset: 2 },
  { id: "dec", label: "December", day: 355, utcOffset: 1 },
] as const;
export type MonthId = (typeof MONTHS)[number]["id"];

const rad = Math.PI / 180;

export function sunPosition(lat: number, lon: number, dayOfYear: number, localHour: number, utcOffset: number): SunPos {
  const B = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const decl = 23.45 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const tc = 4 * (lon - 15 * utcOffset) + eot;
  const solarHour = localHour + tc / 60;
  const ha = 15 * (solarHour - 12);
  const sinEl = Math.sin(decl * rad) * Math.sin(lat * rad) + Math.cos(decl * rad) * Math.cos(lat * rad) * Math.cos(ha * rad);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosAz = (Math.sin(decl * rad) * Math.cos(lat * rad) - Math.cos(decl * rad) * Math.sin(lat * rad) * Math.cos(ha * rad)) / Math.max(1e-6, Math.cos(el));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
  if (ha > 0) az = 360 - az;
  return { elevation: el / rad, azimuth: az };
}

export function compass(az: number): string {
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(az / 45) % 8]!;
}
