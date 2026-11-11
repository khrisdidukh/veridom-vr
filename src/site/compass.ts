// A compass heading from the device, where the browser offers one.
// Phones report an absolute orientation; headsets usually don't, and then the
// owner sets north by hand ("North is where I look").

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Compass heading (degrees clockwise from north) of a device-orientation reading, or null when it has none. */
export function headingFromOrientation(e: { absolute?: boolean; alpha?: number | null; webkitCompassHeading?: number }): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) return ((e.webkitCompassHeading % 360) + 360) % 360;
  if (e.absolute && typeof e.alpha === "number" && Number.isFinite(e.alpha)) return ((360 - e.alpha) % 360 + 360) % 360;
  return null;
}

export class Compass {
  private value: number | null = null;
  private at = 0;

  constructor(target: Pick<Window, "addEventListener"> | null = typeof window === "undefined" ? null : window) {
    const on = (e: Event) => {
      const h = headingFromOrientation(e as CompassEvent);
      if (h === null) return;
      this.value = h;
      this.at = Date.now();
    };
    try {
      target?.addEventListener("deviceorientationabsolute", on);
      target?.addEventListener("deviceorientation", on);
    } catch {
      /* no sensor events here */
    }
  }

  /** The latest heading, if one arrived in the last two seconds. */
  heading(now = Date.now()): number | null {
    return this.value !== null && now - this.at < 2000 ? this.value : null;
  }
}
