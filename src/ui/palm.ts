// "Palm up" detection for the wrist panel: the left hand turned palm up and
// towards the face shows the compact panel. A gate with hysteresis and a short
// dwell keeps it from flickering, and it never appears while that hand pinches.

export type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Unit vector out of the palm, from three joints: wrist, base of the index finger, base of the little finger. */
export function palmNormal(wrist: V3, indexBase: V3, pinkyBase: V3, hand: "left" | "right"): V3 {
  const n = cross(sub(pinkyBase, wrist), sub(indexBase, wrist));
  return unit(hand === "left" ? n : { x: -n.x, y: -n.y, z: -n.z });
}

/** How much the palm looks up (1 = straight up) and how much it looks at the head (1 = straight at it). */
export function palmFacing(normal: V3, palm: V3, head: V3): { up: number; toHead: number } {
  return { up: normal.y, toHead: dot(normal, unit(sub(head, palm))) };
}

export class PalmGate {
  shown = false;
  private wish = false;
  private since = 0;

  /** Feed one reading; returns whether the panel should be showing. `now` is in milliseconds. */
  update(up: number, toHead: number, pinching: boolean, now: number): boolean {
    // Easier to keep than to get: a small tilt does not drop the panel.
    let want = this.shown ? up > 0.4 && toHead > 0.15 : up > 0.7 && toHead > 0.45;
    // A pinching hand changes nothing: no panel popping up mid-pinch, none vanishing under a finger.
    if (pinching) want = this.shown;
    if (want !== this.wish) {
      this.wish = want;
      this.since = now;
    }
    if (want !== this.shown && now - this.since >= (want ? 250 : 400)) this.shown = want;
    return this.shown;
  }

  reset() {
    this.shown = this.wish = false;
  }
}
