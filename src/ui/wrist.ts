import type { Store } from "../state";
import { C, roundRect } from "./panel";
import { nextStyle, styleById } from "../style/styles";

// The compact panel in the palm of the left hand: modes, the wall slider,
// undo and before/after. Same press / drag / release contract as the big panel.

const W = 640;
const H = 490;

type Btn = { x: number; y: number; w: number; h: number; label: string; active?: boolean; disabled?: boolean; onPress: () => void };

export class WristPanel {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buttons: Btn[] = [];
  private slider = { x: 40, y: 196, w: W - 80, h: 70 };
  dragging = false;
  onRedraw: () => void = () => {};

  constructor(private store: Store, private hooks: { site: () => void }) {
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
    b?.onPress();
    return !!b;
  }

  dragTo(u: number) {
    if (!this.dragging) return;
    this.store.setWallOpacity(Math.max(0, Math.min(1, (u * W - this.slider.x) / this.slider.w)), false);
  }

  release() {
    if (!this.dragging) return;
    this.dragging = false;
    this.store.setWallOpacity(Math.round(this.store.wallOpacity * 20) / 20);
  }

  private btn(b: Btn) {
    this.buttons.push(b);
    const { ctx } = this;
    ctx.fillStyle = b.disabled ? "#191d22" : b.active ? C.accent : C.card;
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.strokeStyle = b.active ? C.accent : C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = b.disabled ? "#59616b" : b.active ? "#08262a" : C.text;
    ctx.font = "600 32px system-ui, sans-serif";
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
    roundRect(ctx, 0, 0, W, H, 30);
    ctx.fill();
    // Modes.
    const bw = (W - 80 - 20) / 3;
    this.btn({ x: 40, y: 30, w: bw, h: 78, label: "Model", active: s.mode === "model", onPress: () => store.setMode("model") });
    this.btn({ x: 50 + bw, y: 30, w: bw, h: 78, label: "Walk in", active: s.mode === "walk", onPress: () => store.setMode("walk") });
    this.btn({ x: 60 + bw * 2, y: 30, w: bw, h: 78, label: "On site", active: s.mode === "site", onPress: () => this.hooks.site() });
    // Walls.
    const op = store.wallOpacity;
    const sl = this.slider;
    ctx.fillStyle = C.text;
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText(`Walls ${Math.round(op * 100)} %`, 40, 166);
    ctx.fillStyle = C.dim;
    ctx.font = "24px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(s.mode === "site" && s.site.here ? s.site.here : "", W - 40, 166, 360);
    ctx.textAlign = "left";
    ctx.fillStyle = C.line;
    roundRect(ctx, sl.x, sl.y + 26, sl.w, 18, 9);
    ctx.fill();
    ctx.fillStyle = C.accent;
    roundRect(ctx, sl.x, sl.y + 26, Math.max(18, sl.w * op), 18, 9);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(sl.x + sl.w * op, sl.y + 35, 24, 0, Math.PI * 2);
    ctx.fill();
    // Undo, before/after, X-ray.
    this.btn({ x: 40, y: 292, w: bw, h: 78, label: "Undo", disabled: s.changes.length === 0 || s.comparing, onPress: () => store.undo() });
    this.btn({ x: 50 + bw, y: 292, w: bw, h: 78, label: "Original", active: s.comparing, onPress: () => store.setCompare(!s.comparing) });
    this.btn({ x: 60 + bw * 2, y: 292, w: bw, h: 78, label: "X-ray", active: s.xray, onPress: () => store.setXray(!s.xray) });
    // Interior look: one press goes to the next.
    this.btn({ x: 40, y: 384, w: W - 80, h: 78, label: `Style: ${styleById(s.style).label}  ▸`, onPress: () => store.setStyle(nextStyle(s.style)) });
    this.onRedraw();
  }
}
