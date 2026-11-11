import { changeRequestText } from "../edit/changes";
import { STAGES } from "../edit/stages";
import { labelFor, type Store } from "../state";
import { CATALOG } from "../furnish/catalog";
import { MONTHS, compass } from "../env/sun";
import type { Weather } from "../env/environment";
import { ASSEMBLIES, ASSEMBLY_IDS, insulationShare, thickness, type AssemblyId } from "../info/catalog";
import { assemblySummary, noteFor } from "../info/notes";

// One control panel drawn on a canvas. In the headset it is a texture on a
// floating plane; on a desktop the same canvas sits in the page. Hits arrive
// as (u, v) in 0..1, so both use the same buttons.

const W = 1200;
const H = 930;

type Button = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onPress: () => void;
  active?: boolean;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  /** Font size in px; 30 by default. */
  size?: number;
};

export type SiteHooks = {
  enter: () => void;
  realign: () => void;
  adjust: () => void;
  confirm: () => void;
  /** Slide the house: metres to the wearer's right, away from them, and up. */
  nudge: (right: number, away: number, up: number) => void;
  rotate: (deg: number) => void;
  cornerAtFeet: () => void;
  wallAlongGaze: () => void;
};

type Slider = { x: number; y: number; w: number; h: number; set: (f: number) => void; done?: () => void };

const C = {
  bg: "#13161b",
  card: "#1d2229",
  line: "#2c333d",
  text: "#eef1f4",
  dim: "#9aa4b1",
  accent: "#29c4d6",
  warn: "#ff8a1f",
  plan: "#49c27a",
  low: "#d6c22b",
  medium: "#ff8a1f",
  high: "#ff5a4f",
};

const LEVEL_TEXT = { plan: "Plan only", low: "Small rework", medium: "Rework", high: "Major rework" } as const;

export class Panel {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buttons: Button[] = [];
  private slider = { x: 40, y: 150, w: W - 80, h: 70 };
  private sliders: Slider[] = [];
  private active: Slider | null = null;
  /** Filled in by the scene: sun height and direction for the light card. */
  sunInfo = { elevation: 0, azimuth: 0 };
  dragging = false;
  onRedraw: () => void = () => {};
  onExport: (text: string) => void = () => {};

  constructor(private store: Store, private hooks: { enterRoom: (id: string) => void; turn: (deg: number) => void; rotateModel: (deg: number) => void; addFurniture: (catalogId: string) => void; site: SiteHooks; tour: () => void; layers: { open: (a: AssemblyId) => void } }) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    store.on(() => this.draw());
    this.draw();
  }

  get aspect() {
    return W / H;
  }

  /** Returns true when the press hit something. */
  press(u: number, v: number): boolean {
    const x = u * W;
    const y = v * H;
    const sl = this.sliders.find((s) => x >= s.x - 10 && x <= s.x + s.w + 10 && y >= s.y && y <= s.y + s.h);
    if (sl) {
      this.active = sl;
      this.dragging = true;
      this.dragTo(u);
      return true;
    }
    const b = this.buttons.find((b) => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (b) {
      b.onPress();
      return true;
    }
    return false;
  }

  dragTo(u: number) {
    if (!this.dragging || !this.active) return;
    const a = this.active;
    a.set(Math.max(0, Math.min(1, (u * W - a.x) / a.w)));
  }

  release() {
    if (!this.dragging) return;
    this.dragging = false;
    this.active?.done?.();
    this.active = null;
  }

  private btn(b: Button) {
    this.buttons.push(b);
    const { ctx } = this;
    const fill = b.disabled ? "#191d22" : b.active ? C.accent : b.tone === "primary" ? "#20434a" : b.tone === "danger" ? "#4a2420" : C.card;
    ctx.fillStyle = fill;
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.strokeStyle = b.active ? C.accent : C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = b.disabled ? "#59616b" : b.active ? "#08262a" : C.text;
    ctx.font = `600 ${b.size ?? 30}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.w - 14);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  draw() {
    const { ctx, store } = this;
    const s = store.s;
    this.buttons = [];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    roundRect(ctx, 0, 0, W, H, 28);
    ctx.fill();

    // Header and mode.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.text;
    ctx.font = "700 38px system-ui, sans-serif";
    ctx.fillText("Veridom · Before you build", 40, 64, 450);
    ctx.fillStyle = C.dim;
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(s.house.name, 40, 100, 450);
    this.sliders = [];
    const hb = [
      { label: "Model", active: s.mode === "model", onPress: () => store.setMode("model") },
      { label: "Walk in", active: s.mode === "walk", onPress: () => store.setMode("walk") },
      { label: "On site", active: s.mode === "site", onPress: () => this.hooks.site.enter() },
      { label: "X-ray", active: s.xray, onPress: () => store.setXray(!s.xray) },
      { label: "Light", active: s.view === "light", onPress: () => store.set({ view: s.view === "light" ? "main" : "light" }) },
      { label: "Furnish", active: s.view === "furnish", onPress: () => this.openFurnish() },
    ];
    hb.forEach((b, i) => this.btn({ x: 516 + i * 108, y: 34, w: 102, h: 64, size: 26, ...b }));
    this.sliders.push({
      ...this.slider,
      set: (f) => store.setTimeline(f * 5),
      // Snap to quarter stages so the panel shows a clean stage name.
      done: () => store.setTimeline(Math.round(store.s.timeline * 4) / 4),
    });

    // Timeline.
    const sl = this.slider;
    ctx.fillStyle = C.line;
    roundRect(ctx, sl.x, sl.y + 26, sl.w, 18, 9);
    ctx.fill();
    ctx.fillStyle = C.accent;
    roundRect(ctx, sl.x, sl.y + 26, (sl.w * s.timeline) / 5, 18, 9);
    ctx.fill();
    STAGES.forEach((st, i) => {
      const x = sl.x + (sl.w * i) / 5;
      ctx.fillStyle = s.timeline >= i - 0.001 ? C.accent : C.line;
      ctx.beginPath();
      ctx.arc(x, sl.y + 35, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = Math.round(s.timeline) === i ? C.text : C.dim;
      ctx.font = `${Math.round(s.timeline) === i ? "700" : "500"} 24px system-ui, sans-serif`;
      ctx.textAlign = i === 0 ? "left" : i === 5 ? "right" : "center";
      ctx.fillText(st.short, x, sl.y + 92);
    });
    const knobX = sl.x + (sl.w * s.timeline) / 5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(knobX, sl.y + 35, 22, 0, Math.PI * 2);
    ctx.fill();

    // Navigation row.
    let y = 270;
    const aligning = s.mode === "site" && (s.site.phase === "corner" || s.site.phase === "direction");
    if (s.mode === "site") {
      this.btn({ x: 40, y, w: 190, h: 60, label: "Re-align", active: aligning, onPress: () => this.hooks.site.realign() });
      this.btn({ x: 242, y, w: 170, h: 60, label: "Adjust", active: s.site.phase === "adjust", disabled: aligning, onPress: () => (s.site.phase === "adjust" ? this.hooks.site.confirm() : this.hooks.site.adjust()) });
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      ctx.font = "600 26px system-ui, sans-serif";
      ctx.fillText(aligning ? `Placing the house — step ${s.site.phase === "corner" ? 1 : 2} of 2` : s.site.here ? `You are in: ${s.site.here}` : "On your plot, at full size", 436, y + 26, W - 476);
      ctx.fillStyle = C.dim;
      ctx.font = "22px system-ui, sans-serif";
      const el = this.sunInfo.elevation;
      const sun = el > 0 ? `sun ${Math.round(el)}° high from the ${compass(this.sunInfo.azimuth)}` : "sun is down";
      ctx.fillText(aligning ? "Walk slowly. Keep your boundary on." : `Facing ${compass(s.site.heading)} · ${sun}`, 436, y + 54, W - 476);
    } else if (s.mode === "walk") {
      const rooms = s.house.rooms;
      const bw = (W - 80 - 10 * (rooms.length + 1)) / (rooms.length + 2);
      rooms.forEach((r, i) => {
        this.btn({ x: 40 + i * (bw + 10), y, w: bw, h: 60, label: r.name.split(" ")[0]!, active: s.roomId === r.id, onPress: () => this.hooks.enterRoom(r.id) });
      });
      this.btn({ x: 40 + rooms.length * (bw + 10), y, w: bw, h: 60, label: "⟲ Turn", onPress: () => this.hooks.turn(45) });
      this.btn({ x: 40 + (rooms.length + 1) * (bw + 10), y, w: bw, h: 60, label: "Turn ⟳", onPress: () => this.hooks.turn(-45) });
    } else {
      this.btn({ x: 40, y, w: 260, h: 60, label: "⟲ Rotate", onPress: () => this.hooks.rotateModel(45) });
      this.btn({ x: 312, y, w: 260, h: 60, label: "Rotate ⟳", onPress: () => this.hooks.rotateModel(-45) });
      ctx.fillStyle = C.dim;
      ctx.font = "24px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Pinch a room's door to look inside, or press Walk in.", 596, y + 38, W - 640);
    }

    // Tools row: wall opacity, and what else is handy in this mode.
    y = 344;
    const op = store.wallOpacity;
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.fillText(`Walls ${Math.round(op * 100)} %`, 40, y + 40, 160);
    const ws = { x: 220, y, w: 400, h: 60 };
    ctx.fillStyle = C.line;
    roundRect(ctx, ws.x, ws.y + 22, ws.w, 16, 8);
    ctx.fill();
    ctx.fillStyle = C.accent;
    roundRect(ctx, ws.x, ws.y + 22, Math.max(16, ws.w * op), 16, 8);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ws.x + ws.w * op, ws.y + 30, 20, 0, Math.PI * 2);
    ctx.fill();
    // Not saved on every step of a drag, only when the fingers let go.
    this.sliders.push({ ...ws, set: (f) => store.setWallOpacity(f, false), done: () => store.setWallOpacity(Math.round(store.wallOpacity * 20) / 20) });
    this.toolButtons(y);

    // Body: selected element or change list.
    y = 425;
    ctx.fillStyle = C.card;
    roundRect(ctx, 40, y, W - 80, 340, 20);
    ctx.fill();
    if (s.mode === "site" && (aligning || s.site.phase === "adjust")) this.drawSite(y);
    else if (s.view === "changes") this.drawChanges(y);
    else if (s.view === "light") this.drawLight(y);
    else if (s.view === "layers" && !s.selected) this.drawLayers(y);
    else if (s.view === "furnish" && s.selected?.type !== "furniture") this.drawCatalog(y);
    else if (s.selected?.type === "furniture") this.drawFurniture(y);
    else this.drawSelection(y);

    // Footer: findings and changes.
    y = 789;
    const f = s.findings;
    ctx.textAlign = "left";
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.fillStyle = f.length ? C.warn : C.plan;
    ctx.fillText(f.length ? `⚠ ${f.length} plan problem${f.length > 1 ? "s" : ""} — shown in orange` : "✓ No plan problems found", 40, y + 30, 700);
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    if (s.message) {
      ctx.fillStyle = C.text;
      wrap(ctx, s.message, 40, y + 66, 700, 30);
    } else if (f[0]) ctx.fillText(f.map((x) => x.title).join(" · "), 40, y + 66, 700);
    this.btn({ x: 770, y: y + 6, w: 200, h: 62, label: `Changes (${s.changes.length})`, active: s.view === "changes", onPress: () => store.set({ view: s.view === "changes" ? "main" : "changes" }) });
    this.btn({ x: 982, y: y + 6, w: 178, h: 62, label: "Undo", disabled: s.changes.length === 0, onPress: () => store.undo() });

    this.onRedraw();
  }

  private drawSelection(y: number) {
    const { ctx, store } = this;
    const s = store.s;
    ctx.textAlign = "left";
    if (!s.selected) {
      ctx.fillStyle = C.text;
      ctx.font = "600 30px system-ui, sans-serif";
      ctx.fillText("Nothing selected", 70, y + 60);
      ctx.fillStyle = C.dim;
      ctx.font = "26px system-ui, sans-serif";
      wrap(ctx, "Pinch a door, window, socket, switch or the kitchen counter. Then move it and see what the change would cost at this point of the build.", 70, y + 108, W - 160, 36);
      wrap(ctx, `Now: ${STAGES[Math.round(s.timeline)]!.name}. Drag the timeline to build forward or go back.`, 70, y + 230, W - 160, 36);
      return;
    }
    const t = s.selected;
    ctx.fillStyle = C.text;
    ctx.font = "700 32px system-ui, sans-serif";
    ctx.fillText(labelFor(s.house, t), 70, y + 54, 640);
    const b = (x: number, w: number, label: string, kind: Parameters<Store["edit"]>[0], amount = 0) =>
      this.btn({ x, y: y + 80, w, h: 64, label, tone: "primary", onPress: () => store.edit(kind, amount) });
    if (t.type === "door") {
      b(70, 170, "◀ 20 cm", "move", -0.2);
      b(250, 170, "20 cm ▶", "move", 0.2);
      b(430, 220, "Flip swing", "flip-swing");
      b(660, 220, "Flip hinge", "flip-hinge");
      b(890, 220, "Wider", "width", 0.1);
    } else if (t.type === "window") {
      b(70, 170, "◀ 20 cm", "move", -0.2);
      b(250, 170, "20 cm ▶", "move", 0.2);
      b(430, 200, "Wider", "width", 0.2);
      b(640, 200, "Narrower", "width", -0.2);
    } else if (t.type === "socket" || t.type === "switch") {
      b(70, 170, "◀ 20 cm", "move", -0.2);
      b(250, 170, "20 cm ▶", "move", 0.2);
      b(430, 170, "▲ 10 cm", "height", 0.1);
      b(610, 170, "▼ 10 cm", "height", -0.1);
    } else if (t.type === "counter") {
      b(70, 200, "▲ 5 cm", "height", 0.05);
      b(280, 200, "▼ 5 cm", "height", -0.05);
    }
    this.btn({ x: 1010, y: y + 22, w: 120, h: 50, label: "Close", onPress: () => store.select(null) });

    const c = store.lastChange;
    if (!c) {
      ctx.fillStyle = C.dim;
      ctx.font = "26px system-ui, sans-serif";
      wrap(ctx, `Make a change to see what it costs at the "${STAGES[Math.round(s.timeline)]!.name}" stage. Slide the timeline back to see when it would have been free.`, 70, y + 200, W - 160, 36);
      return;
    }
    const color = C[c.impact.level];
    ctx.fillStyle = color;
    roundRect(ctx, 70, y + 168, 230, 48, 24);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(LEVEL_TEXT[c.impact.level], 185, y + 200);
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(`${c.description} · at "${c.stageName}"`, 320, y + 200, W - 400);
    ctx.fillStyle = C.dim;
    wrap(ctx, c.impact.summary, 70, y + 252, W - 160, 34);
    if (c.impact.rework.length) wrap(ctx, "Rework: " + c.impact.rework.join(" · "), 70, y + 292, W - 160, 34);
  }

  /** Buttons to the right of the wall slider. */
  private toolButtons(y: number) {
    const { store } = this;
    const s = store.s;
    let x = 660;
    const add = (label: string, w: number, active: boolean, onPress: () => void) => {
      this.btn({ x, y, w, h: 60, label, active, size: 26, onPress });
      x += w + 10;
    };
    add("Layers", 120, s.view === "layers", () => store.set({ view: s.view === "layers" ? "main" : "layers", selected: null }));
    add("Measure", 130, s.measuring, () => store.set({ measuring: !s.measuring, message: s.measuring ? "" : "Measuring tape: pinch a first point, then a second." }));
    if (s.mode !== "site") add(s.touring ? "Stop tour" : "▶ Tour", 150, s.touring, () => this.hooks.tour());
    if (s.mode === "site") add("Floor", 110, s.site.showFloor, () => store.setSite({ showFloor: !s.site.showFloor }));
  }

  /** What the house is made of: pick a build-up, then a layer. */
  private drawLayers(y: number) {
    const { ctx, store } = this;
    const s = store.s;
    const open = s.cutaway?.assembly ?? null;
    const bw = (W - 140 - 3 * 10) / 4;
    ASSEMBLY_IDS.forEach((id, i) => this.btn({ x: 70 + i * (bw + 10), y: y + 20, w: bw, h: 62, label: ASSEMBLIES[id].name, size: 26, active: open === id, onPress: () => this.hooks.layers.open(id) }));
    ctx.textAlign = "left";
    if (!open) {
      ctx.fillStyle = C.text;
      ctx.font = "600 30px system-ui, sans-serif";
      ctx.fillText("See inside the walls, floor and roof", 70, y + 136);
      ctx.fillStyle = C.dim;
      ctx.font = "26px system-ui, sans-serif";
      wrap(ctx, "Pinch a wall — or one of the buttons above — and it slides apart into its real layers, at true thickness. Pinch a layer to read what it does, why it matters and when it is built. Pinch the wall again to close it.", 70, y + 182, W - 160, 36);
      return;
    }
    const a = ASSEMBLIES[open];
    const info = s.info?.kind === "layer" && s.info.assembly === open ? s.info : null;
    const layer = info ? a.layers.find((l) => l.id === info.layer) : null;
    ctx.fillStyle = C.text;
    ctx.font = "700 30px system-ui, sans-serif";
    ctx.fillText(layer ? `${layer.name} · ${thickness(layer.mm)}` : a.name, 70, y + 126, 620);
    ctx.fillStyle = C.accent;
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(assemblySummary(open), W - 70, y + 126, 440);
    ctx.textAlign = "left";
    if (layer) {
      const n = noteFor(s.house, s.findings, { kind: "layer", assembly: open, layer: layer.id }, s.timeline)!;
      ctx.fillStyle = C.dim;
      ctx.font = "25px system-ui, sans-serif";
      let yy = y + 166;
      for (const line of n.lines) {
        const rows = Math.ceil(ctx.measureText(line).width / (W - 160));
        wrap(ctx, line, 70, yy, W - 160, 31);
        yy += 31 * Math.max(1, rows) + 4;
      }
      ctx.fillStyle = C.accent;
      ctx.font = "600 23px system-ui, sans-serif";
      ctx.fillText(n.foot, 70, Math.min(yy + 4, y + 326), W - 160);
      return;
    }
    // The stack as a bar, to scale, with each layer's share of the insulation.
    ctx.font = "23px system-ui, sans-serif";
    a.layers.forEach((l, i) => {
      const yy = y + 150 + i * 30;
      ctx.fillStyle = C.text;
      ctx.fillText(`${i + 1}. ${l.name}`, 70, yy + 22, 380);
      ctx.fillStyle = C.dim;
      ctx.fillText(thickness(l.mm), 470, yy + 22);
      const share = insulationShare(a, l);
      ctx.fillStyle = C.line;
      roundRect(ctx, 590, yy + 6, 380, 16, 8);
      ctx.fill();
      ctx.fillStyle = C.accent;
      roundRect(ctx, 590, yy + 6, Math.max(8, 380 * share), 16, 8);
      ctx.fill();
      ctx.fillStyle = C.dim;
      ctx.fillText(`${Math.round(share * 100)} % of insulation`, 986, yy + 22, 150);
    });
  }

  /** On-site placement: two pinches on the ground, then fine-tuning. */
  private drawSite(y: number) {
    const { ctx, store } = this;
    const st = store.s.site;
    const h = this.hooks.site;
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = "700 32px system-ui, sans-serif";
    if (st.phase === "corner") {
      ctx.fillText("1 · Peg the south-west corner", 70, y + 56);
      ctx.fillStyle = C.dim;
      ctx.font = "26px system-ui, sans-serif";
      wrap(ctx, "Point at the ground where the south-west corner of the house will stand and pinch. The outline of the house follows your hand.", 70, y + 104, W - 160, 36);
      this.btn({ x: 70, y: y + 236, w: 420, h: 70, label: "Corner at my feet", tone: "primary", onPress: () => h.cornerAtFeet() });
      ctx.fillStyle = C.dim;
      ctx.font = "22px system-ui, sans-serif";
      wrap(ctx, "Easier outdoors: stand on the corner peg and pinch this button.", 516, y + 266, W - 600, 30);
      return;
    }
    if (st.phase === "direction") {
      ctx.fillText("2 · Sight along the south wall", 70, y + 56);
      ctx.fillStyle = C.dim;
      ctx.font = "26px system-ui, sans-serif";
      wrap(ctx, "Point at the ground further along the south wall, towards the east corner, and pinch. The further the point, the more exact the angle.", 70, y + 104, W - 160, 36);
      this.btn({ x: 70, y: y + 236, w: 420, h: 70, label: "Wall runs where I look", tone: "primary", onPress: () => h.wallAlongGaze() });
      this.btn({ x: 506, y: y + 236, w: 240, h: 70, label: "Back", onPress: () => h.realign() });
      return;
    }
    // Fine-tuning.
    const step = st.fine ? 0.02 : 0.1;
    const deg = st.fine ? 1 : 5;
    ctx.fillText("Fine-tune the position", 70, y + 52);
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText(`Steps of ${st.fine ? "2 cm and 1°" : "10 cm and 5°"}, as seen from where you stand.`, 430, y + 52, W - 500);
    const b = (x: number, yy: number, w: number, label: string, onPress: () => void) => this.btn({ x, y: yy, w, h: 66, label, tone: "primary", size: 28, onPress });
    const r1 = y + 80;
    b(70, r1, 170, "◀ Left", () => h.nudge(-step, 0, 0));
    b(250, r1, 170, "Right ▶", () => h.nudge(step, 0, 0));
    b(430, r1, 170, "▲ Away", () => h.nudge(0, step, 0));
    b(610, r1, 170, "▼ Closer", () => h.nudge(0, -step, 0));
    b(790, r1, 165, "⟲ Turn", () => h.rotate(deg));
    b(965, r1, 165, "Turn ⟳", () => h.rotate(-deg));
    const r2 = y + 158;
    b(70, r2, 170, "Raise", () => h.nudge(0, 0, st.fine ? 0.01 : 0.05));
    b(250, r2, 170, "Lower", () => h.nudge(0, 0, st.fine ? -0.01 : -0.05));
    this.btn({ x: 430, y: r2, w: 350, h: 66, label: st.fine ? "Fine steps ✓" : "Fine steps", active: st.fine, size: 28, onPress: () => store.setSite({ fine: !st.fine }) });
    this.btn({ x: 790, y: r2, w: 340, h: 66, label: "✓ Looks right", active: true, onPress: () => h.confirm() });
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    wrap(ctx, "The cyan pole is the south-west corner, the orange arrow the south wall. When they sit on your pegs, pinch “Looks right”.", 70, y + 268, W - 160, 32);
  }

  private openFurnish() {
    const { store } = this;
    if (store.s.view === "furnish") {
      store.set({ view: "main", selected: null });
      return;
    }
    // Furniture lives in the finished house.
    store.setTimeline(5);
    store.setXray(false);
    store.set({ view: "furnish", selected: null, message: "Pinch a piece to add it, then pinch and drag it into place." });
  }

  private drawCatalog(y: number) {
    const { ctx } = this;
    ctx.fillStyle = C.text;
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText("Add furniture", 70, y + 52);
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText("It appears in front of you. Pinch it and drag to move.", 300, y + 52, W - 380);
    const cols = 4;
    const bw = (W - 140 - (cols - 1) * 12) / cols;
    CATALOG.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.btn({ x: 70 + col * (bw + 12), y: y + 78 + row * 82, w: bw, h: 70, label: c.label, tone: "primary", onPress: () => this.hooks.addFurniture(c.id) });
    });
  }

  private drawFurniture(y: number) {
    const { ctx, store } = this;
    const s = store.s;
    const t = s.selected!;
    ctx.fillStyle = C.text;
    ctx.font = "700 32px system-ui, sans-serif";
    ctx.fillText(labelFor(s.house, t), 70, y + 54, 640);
    this.btn({ x: 1010, y: y + 22, w: 120, h: 50, label: "Close", onPress: () => store.select(null) });
    this.btn({ x: 70, y: y + 84, w: 230, h: 66, label: "⟲ Turn 45°", tone: "primary", onPress: () => store.rotateFurniture(t.id, 45) });
    this.btn({ x: 312, y: y + 84, w: 230, h: 66, label: "Turn 45° ⟳", tone: "primary", onPress: () => store.rotateFurniture(t.id, -45) });
    this.btn({ x: 554, y: y + 84, w: 200, h: 66, label: "Remove", tone: "danger", onPress: () => store.removeFurniture(t.id) });
    this.btn({ x: 766, y: y + 84, w: 364, h: 66, label: "+ Add more", onPress: () => store.set({ selected: null, view: "furnish" }) });
    ctx.fillStyle = C.dim;
    ctx.font = "26px system-ui, sans-serif";
    const blocked = s.findings.find((f) => f.elementIds.includes(t.id));
    if (blocked) {
      ctx.fillStyle = C.warn;
      wrap(ctx, `⚠ ${blocked.title}. ${blocked.detail}`, 70, y + 200, W - 160, 34);
    } else wrap(ctx, "Pinch it and drag along the floor to move it. Doors that would hit it light up in orange.", 70, y + 200, W - 160, 34);
  }

  private drawLight(y: number) {
    const { ctx, store } = this;
    const L = store.s.light;
    ctx.fillStyle = C.text;
    ctx.font = "600 30px system-ui, sans-serif";
    const hh = Math.floor(L.hour);
    const mm = Math.round((L.hour - hh) * 60 / 15) * 15;
    const time = `${String(hh).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
    ctx.fillText(`Light at ${time}`, 70, y + 50);
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    const el = this.sunInfo.elevation;
    const sunText = el > 0 ? `Sun ${Math.round(el)}° high, from the ${compass(this.sunInfo.azimuth)}` : "The sun is down";
    ctx.fillText(`${sunText} · Franzen, Waldviertel`, 330, y + 50, W - 400);
    // Hour slider 5:00–22:00.
    const sl = { x: 90, y: y + 70, w: W - 180, h: 64 };
    const H0 = 5, H1 = 22;
    const f = (L.hour - H0) / (H1 - H0);
    ctx.fillStyle = C.line;
    roundRect(ctx, sl.x, sl.y + 24, sl.w, 16, 8);
    ctx.fill();
    const grad = ctx.createLinearGradient(sl.x, 0, sl.x + sl.w, 0);
    grad.addColorStop(0, "#3a4a7a");
    grad.addColorStop(0.2, "#f2b36b");
    grad.addColorStop(0.5, "#fff1c4");
    grad.addColorStop(0.8, "#f2a35b");
    grad.addColorStop(1, "#3a4a7a");
    ctx.fillStyle = grad;
    roundRect(ctx, sl.x, sl.y + 24, sl.w, 16, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(sl.x + sl.w * f, sl.y + 32, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.dim;
    ctx.font = "22px system-ui, sans-serif";
    for (const hTick of [6, 9, 12, 15, 18, 21]) {
      ctx.textAlign = "center";
      ctx.fillText(`${hTick}:00`, sl.x + (sl.w * (hTick - H0)) / (H1 - H0), sl.y + 80);
    }
    ctx.textAlign = "left";
    this.sliders.push({ ...sl, set: (v) => store.setLight({ hour: H0 + v * (H1 - H0) }), done: () => store.setLight({ hour: Math.round(store.s.light.hour * 4) / 4 }) });
    // Month and weather.
    const by = y + 168;
    MONTHS.forEach((m, i) => this.btn({ x: 70 + i * 132, y: by, w: 124, h: 60, label: m.label.slice(0, 3), active: L.month === m.id, onPress: () => store.setLight({ month: m.id }) }));
    const weathers: [Weather, string][] = [["clear", "Sunny"], ["cloudy", "Clouds"], ["overcast", "Grey"], ["fog", "Fog"], ["snow", "Snow"]];
    weathers.forEach(([w, label], i) => this.btn({ x: 620 + i * 104, y: by, w: 96, h: 60, label, active: L.weather === w, onPress: () => store.setLight({ weather: w }) }));
    ctx.fillStyle = C.dim;
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText("Weather you get in the Waldviertel: sun, cloud, grey days, autumn fog, winter snow.", 70, by + 100, W - 140);
  }

  private drawChanges(y: number) {
    const { ctx, store } = this;
    const s = store.s;
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = "700 30px system-ui, sans-serif";
    ctx.fillText("Change requests for the architect", 70, y + 50);
    this.btn({ x: 890, y: y + 18, w: 240, h: 54, label: "Copy all", tone: "primary", disabled: !s.changes.length, onPress: () => this.onExport(changeRequestText(s.house.name, s.changes)) });
    ctx.font = "24px system-ui, sans-serif";
    if (!s.changes.length) {
      ctx.fillStyle = C.dim;
      ctx.fillText("No changes yet.", 70, y + 110);
      return;
    }
    s.changes.slice(-6).forEach((c, i) => {
      const yy = y + 104 + i * 40;
      ctx.fillStyle = C[c.impact.level];
      ctx.beginPath();
      ctx.arc(82, yy - 8, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      ctx.fillText(`${c.label}: ${c.description} (${c.stageName})`, 104, yy, W - 200);
    });
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}
