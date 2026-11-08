import { catalogById, footprint } from "../furnish/catalog";
import { alongWall, wallById, wallFrame, type House, type Opening, type Vec2 } from "../house/model";

// Plan checks you can see with your own eyes in the headset. Each finding
// names the elements involved so the scene can highlight them.

export type Finding = {
  id: string;
  title: string;
  detail: string;
  elementIds: string[];
};

type Swing = { hinge: Vec2; closedDir: Vec2; openDir: Vec2; radius: number };

/** The quarter circle a door leaf sweeps when it opens. */
export function doorSwing(h: House, d: Opening): Swing {
  const w = wallById(h, d.wallId);
  const { dir, left } = wallFrame(w);
  const hingeAtStart = (d.hinge ?? "start") === "start";
  const hinge = alongWall(w, hingeAtStart ? d.offset : d.offset + d.width);
  const closedDir = hingeAtStart ? dir : { x: -dir.x, z: -dir.z };
  const side = (d.swing ?? "right") === "left" ? left : { x: -left.x, z: -left.z };
  return { hinge, closedDir, openDir: side, radius: d.width };
}

function inSwing(s: Swing, p: Vec2): boolean {
  const vx = p.x - s.hinge.x;
  const vz = p.z - s.hinge.z;
  if (Math.hypot(vx, vz) > s.radius) return false;
  // Inside the quarter between the closed and the open leaf direction.
  return vx * s.closedDir.x + vz * s.closedDir.z >= -1e-6 && vx * s.openDir.x + vz * s.openDir.z >= -1e-6;
}

function rectHitsSwing(s: Swing, min: Vec2, max: Vec2): boolean {
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = { x: min.x + ((max.x - min.x) * i) / steps, z: min.z + ((max.z - min.z) * j) / steps };
      if (inSwing(s, p)) return true;
    }
  }
  return false;
}

export function runChecks(h: House): Finding[] {
  const out: Finding[] = [];
  const doors = h.openings.filter((o) => o.kind === "door");

  for (const d of doors) {
    const swing = doorSwing(h, d);
    for (const f of h.fixtures) {
      if (f.kind === "shower") continue;
      if (rectHitsSwing(swing, f.min, f.max)) {
        out.push({
          id: `swing-${d.id}-${f.id}`,
          title: `${d.label} hits the ${f.label.toLowerCase()}`,
          detail: "The door leaf sweeps over it. Flip the swing, move the hinge, or move the fixture.",
          elementIds: [d.id, f.id],
        });
      }
    }
    for (const it of h.furniture ?? []) {
      const fp = footprint(it);
      if (rectHitsSwing(swing, fp.min, fp.max)) {
        const label = catalogById(it.catalogId)?.label.toLowerCase() ?? "furniture";
        out.push({
          id: `swing-${d.id}-${it.id}`,
          title: `${d.label} hits the ${label}`,
          detail: "The door can't open fully. Move the furniture or change the door.",
          elementIds: [d.id, it.id],
        });
      }
    }
  }

  for (const p of h.points.filter((x) => x.kind === "switch")) {
    for (const d of doors.filter((x) => x.wallId === p.wallId)) {
      const hingeOffset = (d.hinge ?? "start") === "start" ? d.offset : d.offset + d.width;
      const onHingeSide = (d.hinge ?? "start") === "start" ? p.offset < d.offset : p.offset > d.offset + d.width;
      const sameSide = (d.swing ?? "right") === p.side;
      if (onHingeSide && sameSide && Math.abs(p.offset - hingeOffset) < 0.4) {
        out.push({
          id: `switch-${p.id}-${d.id}`,
          title: `${p.label} is behind the ${d.label.toLowerCase()}`,
          detail: "It sits on the hinge side, so the open door covers it. Move it to the handle side.",
          elementIds: [p.id, d.id],
        });
      }
    }
  }

  return out;
}
