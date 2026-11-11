import { STAGES, type StageId } from "../edit/stages";

// What the house is made of, layer by layer, and the short explanations the
// floating labels show. Build-ups are typical for a new single-family house in
// Austria (single-leaf clay block with external insulation, heated screed on a
// ground slab, warm flat roof). Thermal values are common catalogue figures.
// Guide prices are rough ranges per m² of the element, supplied and fitted;
// they are there to compare layers, not to budget with.

export type AssemblyId = "ext-wall" | "int-wall" | "floor" | "roof";

export type LayerLook = "plaster" | "brick" | "eps" | "render" | "parquet" | "screed" | "membrane" | "concrete" | "xps" | "gravel";

export type Layer = {
  id: string;
  name: string;
  /** Thickness in millimetres. */
  mm: number;
  /** Thermal conductivity λ in W/(m·K). */
  lambda: number;
  look: LayerLook;
  /** What it does, in one line. */
  what: string;
  /** Why it matters to the owner. */
  why: string;
  /** Guide price per m², fitted. */
  guide: string;
  stage: StageId;
};

export type Assembly = {
  id: AssemblyId;
  name: string;
  /** Order of the layers as you meet them: from the room outwards. */
  order: string;
  /** Surface resistances inside and outside, m²K/W (EN ISO 6946). */
  rsi: number;
  rse: number;
  layers: Layer[];
};

export const ASSEMBLIES: Record<AssemblyId, Assembly> = {
  "ext-wall": {
    id: "ext-wall",
    name: "Exterior wall",
    order: "room → outside",
    rsi: 0.13,
    rse: 0.04,
    layers: [
      { id: "plaster", name: "Interior plaster", mm: 15, lambda: 0.7, look: "plaster", what: "Lime-gypsum plaster, the surface you paint.", why: "Hides cables and makes the wall airtight. Chasing it open later means patching and repainting.", guide: "€25–40 / m²", stage: "plaster" },
      { id: "brick", name: "Clay block", mm: 250, lambda: 0.25, look: "brick", what: "Hollow clay block, the load-bearing wall.", why: "Carries the roof. Openings cut into it later need a lintel and a structural check.", guide: "€90–130 / m²", stage: "shell" },
      { id: "eps", name: "Façade insulation (EPS)", mm: 160, lambda: 0.031, look: "eps", what: "Grey EPS boards glued and dowelled to the brick.", why: "Does almost all of the wall's insulating. 4 cm more is cheap now and very hard to add later.", guide: "€70–100 / m²", stage: "plaster" },
      { id: "render", name: "Reinforced render", mm: 10, lambda: 0.7, look: "render", what: "Mesh-reinforced base coat and a thin finish render.", why: "Keeps rain out of the insulation. Every later fixing through it has to be sealed.", guide: "€40–60 / m²", stage: "finish" },
    ],
  },
  "int-wall": {
    id: "int-wall",
    name: "Partition wall",
    order: "room → room",
    rsi: 0.13,
    rse: 0.13,
    layers: [
      { id: "plaster-a", name: "Plaster", mm: 10, lambda: 0.7, look: "plaster", what: "Plaster on the first face.", why: "Sockets and switches sit in boxes under it.", guide: "€25–40 / m²", stage: "plaster" },
      { id: "brick", name: "Partition block", mm: 100, lambda: 0.4, look: "brick", what: "Thin clay block, not load-bearing.", why: "Easy to move on paper, messy to move once pipes and cables run in it.", guide: "€45–70 / m²", stage: "shell" },
      { id: "plaster-b", name: "Plaster", mm: 10, lambda: 0.7, look: "plaster", what: "Plaster on the second face.", why: "Tiles in wet rooms go on top of it.", guide: "€25–40 / m²", stage: "plaster" },
    ],
  },
  floor: {
    id: "floor",
    name: "Ground floor",
    order: "room → ground",
    rsi: 0.17,
    rse: 0,
    layers: [
      { id: "parquet", name: "Oak parquet", mm: 14, lambda: 0.16, look: "parquet", what: "Engineered oak, glued to the screed.", why: "Glued boards pass the floor heating well. The screed must be dry before they go down.", guide: "€60–110 / m²", stage: "finish" },
      { id: "screed", name: "Heated screed", mm: 70, lambda: 1.4, look: "screed", what: "Cement screed with the underfloor heating pipes cast in.", why: "After it is poured, nothing under the floor can move: no pipe, no drain, no floor socket.", guide: "€45–70 / m²", stage: "roughin" },
      { id: "floor-eps", name: "Floor insulation", mm: 100, lambda: 0.035, look: "eps", what: "EPS boards and a foil, under the screed.", why: "Sends the heat up into the room instead of into the slab. Water and power pipes run in this layer.", guide: "€15–25 / m²", stage: "roughin" },
      { id: "dpm", name: "Damp-proof membrane", mm: 4, lambda: 0.2, look: "membrane", what: "Bitumen sheet welded to the slab.", why: "Stops ground moisture. One unsealed hole is enough for damp to rise.", guide: "€10–20 / m²", stage: "slab" },
      { id: "slab", name: "Concrete slab", mm: 300, lambda: 2.3, look: "concrete", what: "Reinforced concrete, the foundation.", why: "Drains and ducts must be in place before the pour. Coring it afterwards is the costliest change in a house.", guide: "€130–180 / m²", stage: "slab" },
      { id: "xps", name: "Insulation under the slab", mm: 100, lambda: 0.036, look: "xps", what: "Pressure-resistant XPS boards on the gravel bed.", why: "Can never be reached again. What is left out here is left out for good.", guide: "€25–40 / m²", stage: "slab" },
    ],
  },
  roof: {
    id: "roof",
    name: "Ceiling & flat roof",
    order: "room → sky",
    rsi: 0.1,
    rse: 0.04,
    layers: [
      { id: "plaster", name: "Ceiling plaster", mm: 10, lambda: 0.7, look: "plaster", what: "Thin plaster on the concrete ceiling.", why: "Lamp positions are fixed by the cable outlets cast into the slab above it.", guide: "€25–40 / m²", stage: "plaster" },
      { id: "slab", name: "Concrete ceiling", mm: 200, lambda: 2.3, look: "concrete", what: "Reinforced concrete slab over the rooms.", why: "Cable conduits and lamp outlets are cast in. Decide the lights before the pour.", guide: "€120–170 / m²", stage: "shell" },
      { id: "vapour", name: "Vapour barrier", mm: 4, lambda: 0.2, look: "membrane", what: "Bitumen sheet on the slab.", why: "Keeps room moisture out of the insulation, where it would condense.", guide: "€10–18 / m²", stage: "shell" },
      { id: "eps", name: "Roof insulation (EPS)", mm: 260, lambda: 0.036, look: "eps", what: "Tapered EPS boards that also form the fall to the drains.", why: "The roof loses the most heat per m². This layer decides the heating bill.", guide: "€45–70 / m²", stage: "shell" },
      { id: "membrane", name: "Waterproofing", mm: 8, lambda: 0.2, look: "membrane", what: "Two welded layers of bitumen sheet.", why: "Every roof penetration — vent, cable, skylight — is a weak point. Plan them all before it is laid.", guide: "€45–70 / m²", stage: "shell" },
      { id: "gravel", name: "Gravel", mm: 50, lambda: 2, look: "gravel", what: "Washed gravel as ballast.", why: "Holds the roof down in wind and shields the membrane from the sun.", guide: "€10–15 / m²", stage: "finish" },
    ],
  },
};

export const ASSEMBLY_IDS = Object.keys(ASSEMBLIES) as AssemblyId[];

export const totalMm = (a: Assembly) => a.layers.reduce((s, l) => s + l.mm, 0);

/** Thermal resistance of one layer, m²K/W. */
export const layerR = (l: Layer) => l.mm / 1000 / l.lambda;

/** U-value of the build-up in W/(m²K): one over the sum of all resistances. */
export function uValue(a: Assembly): number {
  return 1 / (a.rsi + a.rse + a.layers.reduce((s, l) => s + layerR(l), 0));
}

/** Share of the build-up's insulation this layer provides, 0…1. */
export function insulationShare(a: Assembly, l: Layer): number {
  return layerR(l) / a.layers.reduce((s, x) => s + layerR(x), 0);
}

export const thickness = (mm: number) => (mm >= 100 ? `${(mm / 10).toFixed(mm % 10 ? 1 : 0)} cm` : `${mm} mm`);

export const stageName = (id: StageId) => STAGES.find((s) => s.id === id)!.name;

// ——— Services and fittings ———

export type ServiceId = "cold" | "hot" | "drain" | "cable" | "board";

export type Note = { title: string; spec: string; why: string; guide: string; stage: StageId };

export const SERVICES: Record<ServiceId, Note> = {
  cold: { title: "Cold water pipe", spec: "Multilayer pipe, 16–20 mm, in the floor insulation and up inside the wall.", why: "Drill here and you hit it. Its route fixes where taps can be.", guide: "€25–40 per metre", stage: "roughin" },
  hot: { title: "Hot water pipe", spec: "Insulated multilayer pipe, 16–20 mm, next to the cold line.", why: "The longer the run, the longer you wait for warm water. Keep bathroom and boiler close.", guide: "€30–45 per metre", stage: "roughin" },
  drain: { title: "Drain pipe", spec: "PP pipe, 50–110 mm, laid to a 2 % fall under the slab.", why: "Cast into the foundation. A toilet can only move as far as this pipe allows.", guide: "€40–70 per metre", stage: "slab" },
  cable: { title: "Power cable", spec: "3 × 1.5 or 2.5 mm² in conduit, up from the board and along the ceiling.", why: "Cables run straight above and below sockets and switches. Don't drill in those lines.", guide: "€8–15 per metre", stage: "roughin" },
  board: { title: "Distribution board", spec: "Circuit breakers and RCDs; every cable in the house starts here.", why: "Needs free wall and 1 m of clear space in front. Moving it later means re-pulling every circuit.", guide: "€1,500–3,000", stage: "roughin" },
};

export const FITTINGS: Record<"door" | "window" | "socket" | "switch" | "counter", { why: string; guide: string; stage: StageId }> = {
  door: { why: "The leaf needs its quarter circle of free floor. Width and swing are fixed with the wall opening.", guide: "€350–700 fitted", stage: "finish" },
  window: { why: "Sets daylight, view and summer heat. The opening is fixed when the wall is built.", guide: "€450–700 / m², triple glazed", stage: "shell" },
  socket: { why: "Plan them from the furniture: bedside, desk, worktop. Each one is cheap now and a chase in the wall later.", guide: "€60–100 each", stage: "roughin" },
  switch: { why: "Belongs on the handle side of the door, 105 cm up, where the hand looks for it.", guide: "€60–100 each", stage: "roughin" },
  counter: { why: "Right height is about 15 cm under your bent elbow. It fixes sockets, splashback and window sill.", guide: "€400–900 per metre of units", stage: "finish" },
};
