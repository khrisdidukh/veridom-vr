import type { House } from "./model";

// A fictional single-storey family house, 12 × 9 m, on a 24 × 30 m plot.
// Plan +z is north: the living room and bedroom face south (z = 0).
// Two problems are planted on purpose so the checks have something to find:
// the bathroom door swings into the WC, and the bedroom light switch sits
// behind the bedroom door.
export const DEMO_HOUSE: House = {
  name: "Demo house, Waldviertel",
  plot: { min: { x: -6, z: -10 }, max: { x: 18, z: 20 } },
  northOffsetDeg: 0,
  storeyHeight: 2.6,
  slabThickness: 0.3,
  walls: [
    { id: "ext-s", a: { x: 0, z: 0 }, b: { x: 12, z: 0 }, thickness: 0.38, exterior: true },
    { id: "ext-e", a: { x: 12, z: 0 }, b: { x: 12, z: 9 }, thickness: 0.38, exterior: true },
    { id: "ext-n", a: { x: 12, z: 9 }, b: { x: 0, z: 9 }, thickness: 0.38, exterior: true },
    { id: "ext-w", a: { x: 0, z: 9 }, b: { x: 0, z: 0 }, thickness: 0.38, exterior: true },
    { id: "int-1", a: { x: 7, z: 0 }, b: { x: 7, z: 9 }, thickness: 0.15, exterior: false },
    { id: "int-2", a: { x: 0, z: 5.5 }, b: { x: 7, z: 5.5 }, thickness: 0.12, exterior: false },
    { id: "int-3", a: { x: 4, z: 5.5 }, b: { x: 4, z: 9 }, thickness: 0.12, exterior: false },
    { id: "int-4", a: { x: 7, z: 4.5 }, b: { x: 12, z: 4.5 }, thickness: 0.12, exterior: false },
    { id: "int-5", a: { x: 10, z: 4.5 }, b: { x: 10, z: 9 }, thickness: 0.12, exterior: false },
  ],
  openings: [
    { id: "d-entry", kind: "door", label: "Front door", wallId: "ext-n", offset: 6, width: 1.0, height: 2.1, sill: 0, hinge: "start", swing: "left" },
    { id: "d-living", kind: "door", label: "Living room door", wallId: "int-2", offset: 5.1, width: 0.9, height: 2.1, sill: 0, hinge: "start", swing: "right" },
    { id: "d-office", kind: "door", label: "Office door", wallId: "int-3", offset: 2.1, width: 0.8, height: 2.1, sill: 0, hinge: "end", swing: "left" },
    { id: "d-bath", kind: "door", label: "Bathroom door", wallId: "int-1", offset: 7.2, width: 0.8, height: 2.1, sill: 0, hinge: "start", swing: "right" },
    { id: "d-bed", kind: "door", label: "Bedroom door", wallId: "int-1", offset: 3.5, width: 0.9, height: 2.1, sill: 0, hinge: "start", swing: "right" },
    { id: "d-wc", kind: "door", label: "WC door", wallId: "int-4", offset: 3.5, width: 0.8, height: 2.1, sill: 0, hinge: "start", swing: "left" },
    { id: "w-terrace", kind: "window", label: "Terrace door", wallId: "ext-s", offset: 1, width: 2.0, height: 2.2, sill: 0 },
    { id: "w-living", kind: "window", label: "Living room window", wallId: "ext-s", offset: 4, width: 1.6, height: 1.4, sill: 0.9 },
    { id: "w-living-w", kind: "window", label: "West window", wallId: "ext-w", offset: 6, width: 1.4, height: 1.4, sill: 0.9 },
    { id: "w-bed", kind: "window", label: "Bedroom window", wallId: "ext-s", offset: 8.5, width: 2.0, height: 1.4, sill: 0.9 },
    { id: "w-bed-e", kind: "window", label: "Bedroom east window", wallId: "ext-e", offset: 1.5, width: 1.2, height: 1.4, sill: 0.9 },
    { id: "w-bath", kind: "window", label: "Bathroom window", wallId: "ext-n", offset: 3, width: 1.0, height: 0.8, sill: 1.4 },
    { id: "w-office", kind: "window", label: "Office window", wallId: "ext-w", offset: 1, width: 1.4, height: 1.4, sill: 0.9 },
  ],
  points: [
    { id: "s-liv-1", kind: "socket", label: "Living room socket (sofa)", wallId: "ext-w", offset: 7.6, height: 0.3, side: "left", roomId: "living" },
    { id: "s-liv-2", kind: "socket", label: "Living room socket (TV)", wallId: "int-2", offset: 2.2, height: 0.3, side: "right", roomId: "living" },
    { id: "s-kit-1", kind: "socket", label: "Kitchen socket 1", wallId: "int-1", offset: 0.9, height: 1.1, side: "left", roomId: "living" },
    { id: "s-kit-2", kind: "socket", label: "Kitchen socket 2", wallId: "int-1", offset: 2.1, height: 1.1, side: "left", roomId: "living" },
    { id: "sw-liv", kind: "switch", label: "Living room light switch", wallId: "int-2", offset: 6.2, height: 1.05, side: "right", roomId: "living" },
    { id: "s-bed-1", kind: "socket", label: "Bedroom socket (left of bed)", wallId: "ext-e", offset: 3.2, height: 0.3, side: "left", roomId: "bedroom" },
    { id: "s-bed-2", kind: "socket", label: "Bedroom socket (right of bed)", wallId: "ext-e", offset: 0.9, height: 0.3, side: "left", roomId: "bedroom" },
    { id: "sw-bed", kind: "switch", label: "Bedroom light switch", wallId: "int-1", offset: 3.3, height: 1.05, side: "right", roomId: "bedroom" },
    { id: "s-bath", kind: "socket", label: "Bathroom socket (mirror)", wallId: "ext-n", offset: 3.9, height: 1.1, side: "left", roomId: "bath" },
    { id: "s-off-1", kind: "socket", label: "Office socket (desk)", wallId: "ext-w", offset: 1.6, height: 0.3, side: "left", roomId: "office" },
    { id: "sw-off", kind: "switch", label: "Office light switch", wallId: "int-3", offset: 1.9, height: 1.05, side: "left", roomId: "office" },
  ],
  fixtures: [
    { id: "f-counter", kind: "counter", label: "Kitchen counter", min: { x: 6.4, z: 0.4 }, max: { x: 7.0, z: 3.2 }, height: 0.9, roomId: "living" },
    { id: "f-table", kind: "table", label: "Dining table", min: { x: 4.2, z: 2.0 }, max: { x: 5.8, z: 2.9 }, height: 0.75, roomId: "living" },
    { id: "f-sofa", kind: "sofa", label: "Sofa", min: { x: 0.4, z: 3.2 }, max: { x: 1.3, z: 5.2 }, height: 0.8, roomId: "living" },
    { id: "f-bed", kind: "bed", label: "Bed", min: { x: 9.9, z: 1.2 }, max: { x: 11.8, z: 3.2 }, height: 0.5, roomId: "bedroom" },
    { id: "f-wc", kind: "wc", label: "Toilet", min: { x: 7.4, z: 7.6 }, max: { x: 8.1, z: 8.3 }, height: 0.42, roomId: "bath" },
    { id: "f-sink", kind: "sink", label: "Washbasin", min: { x: 8.6, z: 8.45 }, max: { x: 9.4, z: 8.9 }, height: 0.85, roomId: "bath" },
    { id: "f-shower", kind: "shower", label: "Walk-in shower", min: { x: 8.7, z: 4.6 }, max: { x: 9.9, z: 5.8 }, height: 0.02, roomId: "bath" },
  ],
  rooms: [
    { id: "living", name: "Living & kitchen", min: { x: 0, z: 0 }, max: { x: 7, z: 5.5 }, floor: "wood", wet: false },
    { id: "office", name: "Office", min: { x: 0, z: 5.5 }, max: { x: 4, z: 9 }, floor: "wood", wet: false },
    { id: "hall", name: "Hall", min: { x: 4, z: 5.5 }, max: { x: 7, z: 9 }, floor: "tiles", wet: false },
    { id: "bedroom", name: "Bedroom", min: { x: 7, z: 0 }, max: { x: 12, z: 4.5 }, floor: "wood", wet: false },
    { id: "bath", name: "Bathroom", min: { x: 7, z: 4.5 }, max: { x: 10, z: 9 }, floor: "tiles", wet: true },
    { id: "wc", name: "Utility & WC", min: { x: 10, z: 4.5 }, max: { x: 12, z: 9 }, floor: "tiles", wet: true },
  ],
  pipes: [
    { id: "p-cold", kind: "cold", points: [ { x: 11.5, y: 0.05, z: 8.6 }, { x: 10.1, y: 0.05, z: 8.6 }, { x: 9.0, y: 0.05, z: 8.6 }, { x: 9.0, y: 0.6, z: 8.75 } ] },
    { id: "p-hot", kind: "hot", points: [ { x: 11.5, y: 0.1, z: 8.5 }, { x: 10.1, y: 0.1, z: 8.5 }, { x: 9.2, y: 0.1, z: 8.5 }, { x: 9.2, y: 0.6, z: 8.75 } ] },
    { id: "p-shower", kind: "hot", points: [ { x: 10.1, y: 0.1, z: 8.5 }, { x: 9.95, y: 0.1, z: 5.2 }, { x: 9.95, y: 1.1, z: 5.2 } ] },
    { id: "p-kitchen", kind: "cold", points: [ { x: 10.1, y: 0.05, z: 8.6 }, { x: 7.1, y: 0.05, z: 8.6 }, { x: 7.1, y: 0.05, z: 1.5 }, { x: 6.9, y: 0.55, z: 1.5 } ] },
    { id: "p-drain", kind: "drain", points: [ { x: 7.75, y: -0.15, z: 8.4 }, { x: 9.0, y: -0.15, z: 8.7 }, { x: 11.0, y: -0.2, z: 8.7 }, { x: 11.0, y: -0.5, z: 9.6 } ] },
  ],
  panel: { wallId: "int-3", offset: 0.5, height: 1.5, side: "right" },
};
