import { applyEdit, type Change } from "./edit/changes";
import { runChecks, type Finding } from "./edit/checks";
import { STYLES, styleById, type StyleId } from "./style/styles";
import { diffHouses, diffSummary, type Diff } from "./edit/diff";
import type { ChangeKind, Target } from "./edit/impact";
import { DEMO_HOUSE } from "./house/demo";
import { cloneHouse, type FurnitureItem, type House } from "./house/model";
import { catalogById } from "./furnish/catalog";
import type { LightSettings } from "./env/environment";
import type { AssemblyId } from "./info/catalog";
import type { InfoTarget } from "./info/notes";

/** Where a wall, floor or roof sample is opened into its layers. Plan metres. */
export type CutawaySpec = {
  assembly: AssemblyId;
  x: number;
  z: number;
  /** Height of the sample's centre above the floor (walls only). */
  y: number;
  /** Plan direction from the surface towards the viewer (walls only). */
  nx: number;
  nz: number;
  /** True when the viewer stands on the room side of the build-up. */
  roomSide: boolean;
  wallId?: string;
};

export type Selection = Target | { type: "furniture"; id: string };

export type Mode = "model" | "walk" | "site";

/** On-site placement flow: peg a corner, sight along a wall, fine-tune, done. */
export type SitePhase = "off" | "corner" | "direction" | "adjust" | "third" | "placed";
/** How real north was set on site: not yet, by looking north, by looking along one's shadow, or from the device compass. */
export type NorthSource = "unset" | "gaze" | "shadow" | "compass";
export type SiteState = {
  phase: SitePhase;
  /** A faint floor helps judge the layout on real ground. */
  showFloor: boolean;
  /** Where the wearer stands: a room name or "Outside, …". */
  here: string;
  /** Compass heading the wearer faces, degrees from north. */
  heading: number;
  /** Small nudge steps (2 cm, 1°) instead of 10 cm, 5°. */
  fine: boolean;
  /** How the house is held in place: "anchor", "saved" or "session". */
  hold: string;
  north: NorthSource;
};

/** Wall opacity per kind of mode: solid at home, see-through on site so a real obstacle is never hidden. */
export type WallOpacity = { home: number; site: number };
export const DEFAULT_WALL_OPACITY: WallOpacity = { home: 1, site: 0.35 };
export const XRAY_OPACITY = 0.25;
export const PREFS_KEY = "veridom-vr-prefs-v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const clamp01 = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

export function loadPrefs(storage: StorageLike | null | undefined): { wallOpacity: WallOpacity; showFloor: boolean; style: StyleId } {
  const out = { wallOpacity: { ...DEFAULT_WALL_OPACITY }, showFloor: true, style: "modern" as StyleId };
  try {
    const v = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null") as { wallOpacity?: Partial<WallOpacity>; showFloor?: unknown; style?: unknown } | null;
    if (v) {
      if (STYLES.some((s) => s.id === v.style)) out.style = v.style as StyleId;
      out.wallOpacity.home = clamp01(v.wallOpacity?.home, out.wallOpacity.home);
      out.wallOpacity.site = clamp01(v.wallOpacity?.site, out.wallOpacity.site);
      if (typeof v.showFloor === "boolean") out.showFloor = v.showFloor;
    }
  } catch {
    /* unreadable prefs: defaults */
  }
  return out;
}

const browserStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

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
  view: "main" | "changes" | "light" | "furnish" | "layers" | "daylight" | "plancheck";
  /** What the floating footnote explains right now. */
  info: InfoTarget | null;
  cutaway: CutawaySpec | null;
  /** Measuring tape: pinch two points. */
  measuring: boolean;
  /** Interior look: colours, fabrics and dressing pieces. */
  style: StyleId;
  /** A plan of the owner's own is loaded, not the demo house. */
  custom: boolean;
  /** Before/after: the scene shows the plan as it came, not the owner's version. */
  comparing: boolean;
  /** The guided tour is driving the app. */
  touring: boolean;
  /** Tour music is switched off. */
  muted: boolean;
  light: LightSettings;
  message: string;
  modelYaw: number;
  site: SiteState;
  wallOpacity: WallOpacity;
  /** Wall opacity to go back to when X-ray is switched off. */
  xrayRestore: number | null;
};

type Listener = (s: AppState, houseChanged: boolean) => void;

const STORAGE_KEY = "veridom-vr-changes-v1";

export class Store {
  s: AppState;
  /** The plan as it came, before any change. */
  original: House;
  /** The owner's version, set aside while the original is on show. */
  private mine: House | null = null;
  private listeners: Listener[] = [];

  constructor(private storage: StorageLike | null = browserStorage()) {
    const house = cloneHouse(DEMO_HOUSE);
    this.original = cloneHouse(house);
    const prefs = loadPrefs(storage);
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
      info: null,
      cutaway: null,
      measuring: false,
      touring: false,
      muted: false,
      comparing: false,
      custom: false,
      style: prefs.style,
      site: { phase: "off", showFloor: prefs.showFloor, here: "", heading: 0, fine: false, hold: "session", north: "unset" },
      wallOpacity: prefs.wallOpacity,
      xrayRestore: null,
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

  setSite(patch: Partial<SiteState>) {
    this.s.site = { ...this.s.site, ...patch };
    if (patch.showFloor !== undefined) this.persistPrefs();
    this.emit(false);
  }

  private get opacityKey(): keyof WallOpacity {
    return this.s.mode === "site" ? "site" : "home";
  }

  /** Wall opacity in the current mode, 0 (hidden) … 1 (solid). */
  get wallOpacity(): number {
    return this.s.wallOpacity[this.opacityKey];
  }

  setWallOpacity(v: number, persist = true) {
    this.s.wallOpacity = { ...this.s.wallOpacity, [this.opacityKey]: Math.max(0, Math.min(1, v)) };
    // Moving the slider by hand is a new choice: X-ray no longer has a value to restore.
    if (this.s.xray) this.s.xrayRestore = null;
    if (persist) this.persistPrefs();
    this.emit(false);
  }

  /** X-ray shows pipes and cables and drops the walls to 25 %; switching it off puts the walls back. */
  setXray(on: boolean) {
    if (on === this.s.xray) return;
    const k = this.opacityKey;
    if (on) {
      this.s.xrayRestore = this.s.wallOpacity[k];
      this.s.wallOpacity = { ...this.s.wallOpacity, [k]: Math.min(this.s.wallOpacity[k], XRAY_OPACITY) };
    } else if (this.s.xrayRestore !== null) {
      this.s.wallOpacity = { ...this.s.wallOpacity, [k]: this.s.xrayRestore };
      this.s.xrayRestore = null;
    }
    this.s.xray = on;
    this.emit(false);
  }

  /** Changing mode ends X-ray, so each mode keeps its own wall opacity. */
  setMode(mode: Mode, patch: Partial<AppState> = {}) {
    if (mode !== this.s.mode) this.setXrayQuiet(false);
    Object.assign(this.s, patch, { mode });
    this.emit(false);
  }

  private setXrayQuiet(on: boolean) {
    const listeners = this.listeners;
    this.listeners = [];
    this.setXray(on);
    this.listeners = listeners;
  }

  private persistPrefs() {
    try {
      const w = { ...this.s.wallOpacity };
      // While X-ray is on, remember the opacity it will go back to.
      if (this.s.xray && this.s.xrayRestore !== null) w[this.opacityKey] = this.s.xrayRestore;
      this.storage?.setItem(PREFS_KEY, JSON.stringify({ wallOpacity: w, showFloor: this.s.site.showFloor, style: this.s.style }));
    } catch {
      /* storage can be unavailable; the session still works */
    }
  }

  /** Clears the selection without telling listeners (the caller emits next). */
  setSelectQuiet() {
    this.s.selected = null;
    this.s.view = "main";
  }

  /** Switches the interior look; the scene is rebuilt with the new colours and dressing. */
  setStyle(id: StyleId) {
    this.s.style = styleById(id).id;
    this.s.message = `Style: ${styleById(id).label}.`;
    this.persistPrefs();
    this.emit(true);
  }

  /** Replaces the house with another plan (or the demo house again) and starts afresh. */
  loadHouse(house: House, custom: boolean, message = "") {
    this.original = cloneHouse(house);
    this.mine = null;
    Object.assign(this.s, {
      house: cloneHouse(house), history: [], changes: [], findings: runChecks(house), selected: null, info: null, cutaway: null,
      comparing: false, measuring: false, view: "main", roomId: house.rooms[0]?.id ?? "", custom, message,
    });
    this.emit(true);
  }

  /** What the owner changed, compared with the plan as it came. */
  get diff(): Diff[] {
    return diffHouses(this.original, this.mine ?? this.s.house);
  }

  /** Flips between the original plan and the owner's version. Nothing can be edited while the original is on show. */
  setCompare(on: boolean) {
    if (on === this.s.comparing) return;
    if (on) {
      const d = this.diff;
      if (!d.length) {
        this.s.message = "Nothing has changed yet: the plan is still as it came.";
        this.emit(false);
        return;
      }
      this.mine = this.s.house;
      this.s.house = cloneHouse(this.original);
      this.s.message = `This is the plan as it came. What you changed is shown in violet (${diffSummary(d)}). Pinch “Original” again for your version.`;
    } else if (this.mine) {
      this.s.house = this.mine;
      this.mine = null;
      this.s.message = "Back to your version.";
    }
    this.s.comparing = on;
    this.s.selected = null;
    this.s.info = null;
    this.s.findings = runChecks(this.s.house);
    this.emit(true);
  }

  /** True (with a message) when a change is refused because the original plan is on show. */
  private locked(): boolean {
    if (!this.s.comparing) return false;
    this.s.message = "This is the original plan. Pinch “Original” again to go back to your version and change things.";
    this.emit(false);
    return true;
  }

  /** Shows a footnote; the same target again puts it away. */
  setInfo(t: InfoTarget | null) {
    const same = t && JSON.stringify(t) === JSON.stringify(this.s.info);
    // Tapping a layer twice goes back to the summary of its build-up.
    this.s.info = same ? (t.kind === "layer" ? { kind: "assembly", assembly: t.assembly } : null) : t;
    if (t && t.kind !== "element") {
      this.s.selected = null;
      if (t.kind === "layer" || t.kind === "assembly") this.s.view = "layers";
    }
    this.s.message = "";
    this.emit(false);
  }

  openCutaway(spec: CutawaySpec) {
    this.s.cutaway = spec;
    this.s.selected = null;
    this.s.info = { kind: "assembly", assembly: spec.assembly };
    this.s.view = "layers";
    this.s.message = "";
    this.emit(false);
  }

  closeCutaway() {
    if (!this.s.cutaway) return;
    this.s.cutaway = null;
    if (this.s.info?.kind === "layer" || this.s.info?.kind === "assembly") this.s.info = null;
    if (this.s.view === "layers") this.s.view = "main";
    this.emit(false);
  }

  select(t: Selection | null) {
    this.s.selected = t;
    this.s.info = t && t.type !== "furniture" ? { kind: "element", target: t } : this.s.cutaway ? { kind: "assembly", assembly: this.s.cutaway.assembly } : null;
    if (!(t?.type === "furniture" && this.s.view === "furnish")) this.s.view = t?.type === "furniture" ? "furnish" : "main";
    if (!t && this.s.cutaway) this.s.view = "layers";
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
    if (this.locked()) return;
    const item: FurnitureItem = { id: `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, catalogId, x, z, rot };
    this.s.house = { ...this.s.house, furniture: [...this.s.house.furniture, item] };
    this.s.selected = { type: "furniture", id: item.id };
    this.s.message = `${catalogById(catalogId)?.label ?? "Piece"} added. Pinch and drag it to move it.`;
    this.furnitureChanged();
  }

  moveFurniture(id: string, x: number, z: number) {
    if (this.locked()) return;
    this.s.house = { ...this.s.house, furniture: this.s.house.furniture.map((f) => (f.id === id ? { ...f, x, z } : f)) };
    this.furnitureChanged();
  }

  rotateFurniture(id: string, deg: number) {
    if (this.locked()) return;
    this.s.house = { ...this.s.house, furniture: this.s.house.furniture.map((f) => (f.id === id ? { ...f, rot: (f.rot + deg) % 360 } : f)) };
    this.furnitureChanged();
  }

  removeFurniture(id: string) {
    if (this.locked()) return;
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
    if (!t || t.type === "furniture" || this.locked()) return;
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
    if (this.locked()) return;
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
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.s.changes));
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
