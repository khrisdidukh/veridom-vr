import { applyEdit, type Change } from "./edit/changes";
import { runChecks, type Finding } from "./edit/checks";
import type { ChangeKind, Target } from "./edit/impact";
import { DEMO_HOUSE } from "./house/demo";
import { cloneHouse, type FurnitureItem, type House } from "./house/model";
import { catalogById } from "./furnish/catalog";
import type { LightSettings } from "./env/environment";

export type Selection = Target | { type: "furniture"; id: string };

export type Mode = "model" | "walk";

export type AppState = {
  house: House;
  history: House[];
  timeline: number;
  mode: Mode;
  xray: boolean;
  selected: Selection | null;
  changes: Change[];
  findings: Finding[];
  roomId: string;
  view: "main" | "changes" | "light" | "furnish";
  light: LightSettings;
  message: string;
  modelYaw: number;
};

type Listener = (s: AppState, houseChanged: boolean) => void;

const STORAGE_KEY = "veridom-vr-changes-v1";

export class Store {
  s: AppState;
  private listeners: Listener[] = [];

  constructor() {
    const house = cloneHouse(DEMO_HOUSE);
    this.s = {
      house,
      history: [],
      timeline: 2,
      mode: "model",
      xray: false,
      selected: null,
      changes: [],
      findings: runChecks(house),
      roomId: "living",
      view: "main",
      light: { hour: 15, month: "sep", weather: "clear" },
      message: "Pinch the timeline to build the house. Pinch a door, window or socket to change it.",
      modelYaw: 0,
    };
  }

  on(l: Listener) {
    this.listeners.push(l);
  }

  private emit(houseChanged = false) {
    for (const l of this.listeners) l(this.s, houseChanged);
  }

  set(patch: Partial<AppState>) {
    Object.assign(this.s, patch);
    this.emit(false);
  }

  setTimeline(t: number) {
    this.s.timeline = Math.max(0, Math.min(5, t));
    this.emit(false);
  }

  select(t: Selection | null) {
    this.s.selected = t;
    if (!(t?.type === "furniture" && this.s.view === "furnish")) this.s.view = t?.type === "furniture" ? "furnish" : "main";
    this.s.message = t ? "" : this.s.message;
    this.emit(false);
  }

  setLight(patch: Partial<LightSettings>) {
    this.s.light = { ...this.s.light, ...patch };
    this.emit(false);
  }

  // Furniture changes are not construction changes: they don't go to the
  // architect's list, but they re-run the checks (a wardrobe can block a door).
  addFurniture(catalogId: string, x: number, z: number, rot: number) {
    const item: FurnitureItem = { id: `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, catalogId, x, z, rot };
    this.s.house = { ...this.s.house, furniture: [...this.s.house.furniture, item] };
    this.s.selected = { type: "furniture", id: item.id };
    this.s.message = `${catalogById(catalogId)?.label ?? "Piece"} added. Pinch and drag it to move it.`;
    this.furnitureChanged();
  }

  moveFurniture(id: string, x: number, z: number) {
    this.s.house = { ...this.s.house, furniture: this.s.house.furniture.map((f) => (f.id === id ? { ...f, x, z } : f)) };
    this.furnitureChanged();
  }

  rotateFurniture(id: string, deg: number) {
    this.s.house = { ...this.s.house, furniture: this.s.house.furniture.map((f) => (f.id === id ? { ...f, rot: (f.rot + deg) % 360 } : f)) };
    this.furnitureChanged();
  }

  removeFurniture(id: string) {
    this.s.house = { ...this.s.house, furniture: this.s.house.furniture.filter((f) => f.id !== id) };
    if (this.s.selected?.id === id) this.s.selected = null;
    this.furnitureChanged();
  }

  private furnitureChanged() {
    this.s.findings = runChecks(this.s.house);
    this.emit(false);
  }

  edit(kind: ChangeKind, amount = 0) {
    const t = this.s.selected;
    if (!t || t.type === "furniture") return;
    const r = applyEdit(this.s.house, t, kind, amount, this.s.timeline);
    if ("error" in r) {
      this.s.message = r.error;
      this.emit(false);
      return;
    }
    this.s.history.push(this.s.house);
    this.s.house = r.house;
    this.s.changes.push(r.change);
    this.s.findings = runChecks(r.house);
    this.s.message = "";
    this.persist();
    this.emit(true);
  }

  undo() {
    const prev = this.s.history.pop();
    if (!prev) return;
    // Undo covers construction changes only; furniture stays where it is.
    this.s.house = { ...prev, furniture: this.s.house.furniture };
    this.s.changes.pop();
    this.s.findings = runChecks(this.s.house);
    this.s.message = "Last change undone.";
    this.persist();
    this.emit(true);
  }

  get lastChange(): Change | null {
    const t = this.s.selected;
    if (!t || t.type === "furniture") return null;
    for (let i = this.s.changes.length - 1; i >= 0; i--) {
      const c = this.s.changes[i]!;
      if (c.target.id === t.id) return c;
    }
    return null;
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.s.changes));
    } catch {
      /* storage can be unavailable; the session still works */
    }
  }
}

export function labelFor(h: House, t: Selection): string {
  if (t.type === "furniture") {
    const it = h.furniture.find((f) => f.id === t.id);
    return (it && catalogById(it.catalogId)?.label) ?? "Furniture";
  }
  if (t.type === "door" || t.type === "window") return h.openings.find((o) => o.id === t.id)?.label ?? t.id;
  if (t.type === "socket" || t.type === "switch") return h.points.find((p) => p.id === t.id)?.label ?? t.id;
  return h.fixtures.find((f) => f.id === t.id)?.label ?? t.id;
}
