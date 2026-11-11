// Measuring tape: two pinched points, the distance between them.

export type P3 = { x: number; y: number; z: number };

export function formatLength(m: number): string {
  if (m < 0.995) return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(2)} m`;
}

/** Straight distance, plus its level and vertical parts when the tape is clearly slanted. */
export function measure(a: P3, b: P3): { title: string; lines: string[]; length: number } {
  const level = Math.hypot(b.x - a.x, b.z - a.z);
  const rise = Math.abs(b.y - a.y);
  const length = Math.hypot(level, rise);
  const slanted = level > 0.05 && rise > 0.05;
  return { title: formatLength(length), lines: slanted ? [`${formatLength(level)} along · ${formatLength(rise)} up`] : [], length };
}
