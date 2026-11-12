// Soft background music for the tour, made in the browser: slow chords from a
// few sine and triangle voices through a low-pass filter. No audio files.

/** Four bars that go round: A, F♯ minor, D, E — as frequencies in hertz. */
export const CHORDS: number[][] = [
  [220.0, 277.18, 329.63],
  [185.0, 220.0, 277.18],
  [146.83, 220.0, 293.66],
  [164.81, 207.65, 246.94],
];
export const BAR_SECONDS = 6;

/** Which chord sounds at time t (seconds since the music started). */
export const chordAt = (t: number) => CHORDS[Math.floor(Math.max(0, t) / BAR_SECONDS) % CHORDS.length]!;

type AC = AudioContext;

export class TourMusic {
  private ctx: AC | null = null;
  private master: GainNode | null = null;
  private startedAt = 0;
  private scheduledBar = -1;
  muted = false;
  playing = false;

  /** Starts (or restarts) the music. Fails quietly where the browser will not play sound. */
  start() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx ??= new Ctor();
      void this.ctx.resume();
      this.master?.disconnect();
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(filter).connect(this.ctx.destination);
      this.startedAt = this.ctx.currentTime;
      this.scheduledBar = -1;
      this.playing = true;
      this.setMuted(this.muted);
      this.tick();
    } catch {
      this.playing = false;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master && this.playing) this.master.gain.setTargetAtTime(m ? 0 : 0.11, this.ctx.currentTime, 0.4);
  }

  /** Call every frame: schedules the next bar a little ahead of time. */
  tick() {
    const { ctx, master } = this;
    if (!ctx || !master || !this.playing) return;
    const bar = Math.floor((ctx.currentTime - this.startedAt + 0.5) / BAR_SECONDS);
    if (bar <= this.scheduledBar) return;
    this.scheduledBar = bar;
    const t0 = this.startedAt + bar * BAR_SECONDS;
    chordAt(bar * BAR_SECONDS).forEach((f, i) => {
      for (const [type, mult, level] of [["sine", 1, 0.5], ["triangle", 2.003, 0.12]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = f * mult;
        // Each voice swells and fades over its bar, a little after the one before.
        const a = Math.max(ctx.currentTime, t0 + i * 0.35);
        g.gain.setValueAtTime(0, a);
        g.gain.linearRampToValueAtTime(level, a + 2.2);
        g.gain.linearRampToValueAtTime(0, t0 + BAR_SECONDS + 2.5);
        o.connect(g).connect(master);
        o.start(a);
        o.stop(t0 + BAR_SECONDS + 2.6);
      }
    });
  }

  stop() {
    if (this.ctx && this.master && this.playing) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    this.playing = false;
  }
}
