import { applyEdit, type Change } from "./edit/changes";
import { runChecks, type Finding } from "./edit/checks";
import type { ChangeKind, Target } from "./edit/impact";
import { DEMO_HOUSE } from "./house/demo";
import { cloneHouse, type House } from "./house/model";

export type Mode = "model" | "walk";

export type AppState = {
  house: House;
  history: House[];
  timeline: number;
  mode: Mode;
  xray: boolean;
  selected: Target | null;
  changes: Change[];
  findings: Finding[];
  roomId: string;
  view: "main" | "changes";
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

  select(t: Target | null) {
    this.s.selected = t;
    this.s.view = "main";
    this.s.message = t ? "" : this.s.message;
    this.emit(false);
  }

  edit(kind: ChangeKind, amount = 0) {
    const t = this.s.selected;
    if (!t) return;
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
    this.s.house = prev;
    this.s.changes.pop();
    this.s.findings = runChecks(prev);
    this.s.message = "Last change undone.";
    this.persist();
    this.emit(true);
  }

  get lastChange(): Change | null {
    const t = this.s.selected;
    if (!t) return null;
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

export function labelFor(h: House, t: Target): string {
  if (t.type === "door" || t.type === "window") return h.openings.find((o) => o.id === t.id)?.label ?? t.id;
  if (t.type === "socket" || t.type === "switch") return h.points.find((p) => p.id === t.id)?.label ?? t.id;
  return h.fixtures.find((f) => f.id === t.id)?.label ?? t.id;
}
