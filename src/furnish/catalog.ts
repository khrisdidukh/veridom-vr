import type { FurnitureItem, Vec2 } from "../house/model";

// Furniture the owner can place. Sizes are real-world metres: w across the
// front, d front to back, h height. GLB models are CC0 from Poly Haven.

export type CatalogEntry = {
  id: string;
  label: string;
  w: number;
  d: number;
  h: number;
  /** A file in public/assets/models, or undefined for a piece built in code. */
  glb?: string;
  /** Uniform scale for a model whose real size we want to change. */
  scale?: number;
  /** Rotation (degrees) that turns the model's own front to local +z. */
  modelRot?: number;
};

export const CATALOG: CatalogEntry[] = [
  { id: "sofa", label: "Sofa", w: 2.1, d: 0.95, h: 0.82 },
  { id: "armchair", label: "Armchair", w: 0.82, d: 0.99, h: 1.02, glb: "modern_arm_chair_01" },
  { id: "lounge-chair", label: "Lounge chair", w: 1.0, d: 1.2, h: 1.17, glb: "mid_century_lounge_chair" },
  { id: "coffee-table", label: "Coffee table", w: 0.6, d: 1.2, h: 0.39, glb: "modern_coffee_table_01" },
  { id: "dining-set", label: "Dining table", w: 1.6, d: 2.0, h: 0.76 },
  { id: "sideboard", label: "Sideboard", w: 2.44, d: 0.52, h: 0.68, glb: "modern_wooden_cabinet" },
  { id: "bed", label: "Double bed", w: 1.8, d: 2.1, h: 0.85 },
  { id: "nightstand", label: "Nightstand", w: 0.55, d: 0.45, h: 0.55, glb: "side_table_01" },
  { id: "wardrobe", label: "Wardrobe", w: 1.6, d: 0.62, h: 2.2 },
  { id: "desk", label: "Desk", w: 1.4, d: 0.7, h: 0.75 },
  { id: "plant-large", label: "Large plant", w: 0.7, d: 0.66, h: 0.84, glb: "potted_plant_02" },
  { id: "plant-small", label: "Small plant", w: 0.42, d: 0.46, h: 0.67, glb: "potted_plant_04", scale: 2.5 },
];

export const catalogById = (id: string) => CATALOG.find((c) => c.id === id);

/** Axis-aligned plan footprint of a placed item. */
export function footprint(item: FurnitureItem): { min: Vec2; max: Vec2 } {
  const c = catalogById(item.catalogId);
  const w = c?.w ?? 1;
  const d = c?.d ?? 1;
  const a = (item.rot * Math.PI) / 180;
  const ex = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * d) / 2;
  const ez = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * d) / 2;
  return { min: { x: item.x - ex, z: item.z - ez }, max: { x: item.x + ex, z: item.z + ez } };
}
