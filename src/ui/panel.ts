import { changeRequestText } from "../edit/changes";
import { STAGES } from "../edit/stages";
import { labelFor, type Store } from "../state";

// One control panel drawn on a canvas. In the headset it is a texture on a
// floating plane; on a desktop the same canvas sits in the page. Hits arrive
// as (u, v) in 0..1, so both use the same buttons.

const W = 1200;
const H = 860;

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
};

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
  dragging = false;
  onRedraw: () => void = () => {};
  onExport: (text: string) => void = () => {};

  constructor(private store: Store, private hooks: { enterRoom: (id: string) => void; turn: (deg: number) => void; rotateModel: (deg: number) => void }) {
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
    const s = this.slider;
    if (x >= s.x - 10 && x <= s.x + s.w + 10 && y >= s.y && y <= s.y + s.h) {
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
    if (!this.dragging) return;
    const t = ((u * W - this.slider.x) / this.slider.w) * 5;
    this.store.setTimeline(t);
  }

  release() {
    if (!this.dragging) return;
    this.dragging = false;
    // Snap to the nearest stage so the panel shows a clean stage name.
    this.store.setTimeline(Math.round(this.store.s.timeline * 4) / 4);
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
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.w - 16);
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
    ctx.fillText("Veridom · Before you build", 40, 64);
    ctx.fillStyle = C.dim;
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(s.house.name, 40, 100);
    this.btn({ x: 660, y: 34, w: 160, h: 64, label: "Model", active: s.mode === "model", onPress: () => store.set({ mode: "model" }) });
    this.btn({ x: 832, y: 34, w: 160, h: 64, label: "Walk in", active: s.mode === "walk", onPress: () => store.set({ mode: "walk" }) });
    this.btn({ x: 1004, y: 34, w: 156, h: 64, label: "X-ray", active: s.xray, onPress: () => store.set({ xray: !s.xray }) });

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
    if (s.mode === "walk") {
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

    // Body: selected element or change list.
    y = 360;
    ctx.fillStyle = C.card;
    roundRect(ctx, 40, y, W - 80, 340, 20);
    ctx.fill();
    if (s.view === "changes") this.drawChanges(y);
    else this.drawSelection(y);

    // Footer: findings and changes.
    y = 724;
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
