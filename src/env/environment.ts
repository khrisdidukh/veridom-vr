import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { FRANZEN, MONTHS, sunPosition, type MonthId } from "./sun";

// Sky, sun, clouds, weather and night lights. The sun follows the real path
// over the plot for the chosen month and hour.

export type Weather = "clear" | "cloudy" | "overcast" | "fog" | "snow";
export type LightSettings = { hour: number; month: MonthId; weather: Weather };

type WeatherLook = { turbidity: number; rayleigh: number; cover: number; sun: number; ambient: number; cloud: number; fog: number };
const LOOK: Record<Weather, WeatherLook> = {
  clear: { turbidity: 2.2, rayleigh: 1.2, cover: 0.12, sun: 1, ambient: 1, cloud: 1, fog: 0 },
  cloudy: { turbidity: 4, rayleigh: 1.6, cover: 0.48, sun: 0.75, ambient: 0.95, cloud: 0.95, fog: 0 },
  overcast: { turbidity: 10, rayleigh: 2.5, cover: 1, sun: 0.08, ambient: 0.75, cloud: 0.78, fog: 0 },
  fog: { turbidity: 12, rayleigh: 3, cover: 1, sun: 0.04, ambient: 0.6, cloud: 0.82, fog: 0.07 },
  snow: { turbidity: 10, rayleigh: 2.5, cover: 1, sun: 0.05, ambient: 0.8, cloud: 0.86, fog: 0.025 },
};

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5b4a3a, 0.4);
  readonly group = new THREE.Group(); // sky, clouds and snow: hidden in mixed reality
  private sky = new Sky();
  private envSky = new Sky();
  private envScene = new THREE.Scene();
  private clouds: THREE.Mesh;
  private envClouds: THREE.Mesh;
  private cloudTex: THREE.CanvasTexture;
  private snow: THREE.Points;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvKey = "";
  private lastCover = -1;
  readonly lamps: THREE.PointLight[] = [];
  /** 0 by day, 1 at night: drives lamps and the panel text. */
  darkness = 0;
  sunElevation = 0;
  sunAzimuth = 0;
  private settings: LightSettings = { hour: 15, month: "sep", weather: "clear" };

  constructor(readonly scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    for (const s of [this.sky, this.envSky]) s.scale.setScalar(180);
    this.group.add(this.sky);
    this.envScene.add(this.envSky);

    this.cloudTex = new THREE.CanvasTexture(document.createElement("canvas"));
    this.cloudTex.colorSpace = THREE.SRGBColorSpace;
    const dome = () => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(170, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }),
      );
      m.renderOrder = -1;
      return m;
    };
    this.clouds = dome();
    this.envClouds = dome();
    this.group.add(this.clouds);
    this.envScene.add(this.envClouds);

    const n = 5000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.visible = false;
    this.group.add(this.snow);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target, this.hemi, this.group);
  }

  get current() {
    return this.settings;
  }

  /** Recomputes sun, sky and env map. Cheap enough to call while a slider moves. */
  apply(settings: LightSettings) {
    this.settings = settings;
    const look = LOOK[settings.weather];
    const month = MONTHS.find((m) => m.id === settings.month) ?? MONTHS[2];
    const sp = sunPosition(FRANZEN.lat, FRANZEN.lon, month.day, settings.hour, month.utcOffset);
    this.sunElevation = sp.elevation;
    this.sunAzimuth = sp.azimuth;
    const el = THREE.MathUtils.degToRad(sp.elevation);
    const az = THREE.MathUtils.degToRad(sp.azimuth);
    // Plan: x east, z north → three (x, y, −z).
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();

    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity!.value = look.turbidity;
      u.rayleigh!.value = look.rayleigh;
      u.mieCoefficient!.value = 0.005;
      u.mieDirectionalG!.value = 0.8;
      u.sunPosition!.value.copy(dir);
      u.cloudCoverage!.value = look.cover;
      u.cloudDensity!.value = 0.35 + 0.6 * look.cover;
      u.showSunDisc!.value = look.sun > 0.5 ? 1 : 0;
    }

    // Daylight factor: full above 10°, fading through dusk, dark below −6°.
    const day = THREE.MathUtils.smoothstep(sp.elevation, -6, 10);
    this.darkness = 1 - THREE.MathUtils.smoothstep(sp.elevation, -8, 2);
    const warm = 1 - THREE.MathUtils.smoothstep(sp.elevation, 2, 25);
    this.sun.color.setRGB(1, 0.96 - warm * 0.3, 0.9 - warm * 0.55);
    this.sun.intensity = 7 * look.sun * THREE.MathUtils.smoothstep(sp.elevation, -1, 6);
    this.sun.castShadow = look.sun > 0.3;
    this.sun.position.copy(dir).multiplyScalar(40);
    // Warm bounce light softens the blue cast the sky gives interiors.
    this.hemi.intensity = (0.05 + 1.2 * day) * look.ambient;
    this.hemi.color.setRGB(1, 0.95, 0.88);
    this.hemi.groundColor.setRGB(0.55, 0.45, 0.36);
    this.scene.environmentIntensity = (0.04 + 0.14 * day) * look.ambient;

    if (look.cover >= 0.99 && this.lastCover < 0) {
      this.paintClouds(1);
      this.lastCover = 1;
    }
    for (const c of [this.clouds, this.envClouds]) c.visible = look.cover >= 0.99;
    const cloudShade = (0.12 + 0.88 * day) * look.cloud;
    for (const c of [this.clouds, this.envClouds]) {
      const m = c.material as THREE.MeshBasicMaterial;
      m.color.setRGB(cloudShade * (1 + warm * 0.15), cloudShade * (1 - warm * 0.05), cloudShade * (1 - warm * 0.15));
    }

    // Fog and snow.
    if (look.fog > 0) {
      const f = 0.55 + 0.35 * day;
      const color = new THREE.Color(f, f * 1.01, f * 1.03);
      this.scene.fog = new THREE.FogExp2(color, look.fog);
    } else this.scene.fog = null;
    this.snow.visible = settings.weather === "snow";

    this.renderer.toneMappingExposure = 0.55 - 0.15 * day + (look.cover > 0.9 ? 0.25 * day : 0);
    this.updateEnvMap(`${settings.weather}|${settings.month}|${settings.hour.toFixed(2)}`);
    for (const l of this.lamps) l.visible = this.darkness > 0.05;
  }

  private updateEnvMap(key: string) {
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 400);
    this.scene.environment = rt.texture;
    this.envRT?.dispose();
    this.envRT = rt;
  }

  /** Fits the sun's shadow box to what is being looked at. */
  focus(center: THREE.Vector3, radius: number) {
    const dir = this.sun.position.clone().normalize();
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(dir, radius * 3);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = radius * 0.5;
    cam.far = radius * 6;
    cam.updateProjectionMatrix();
    this.snow.position.copy(center);
    this.snow.scale.setScalar(Math.max(0.02, radius / 14));
  }

  /** Snow fall; call every frame. */
  tick(dt: number) {
    if (!this.snow.visible) return;
    const a = this.snow.geometry.getAttribute("position") as THREE.BufferAttribute;
    const t = performance.now() / 1000;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - dt * 0.9;
      if (y < 0) y += 14;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.08);
    }
    a.needsUpdate = true;
  }

  /** Paints a soft cloud layer with the given cover (0 clear … 1 overcast). */
  private paintClouds(cover: number) {
    const W = 512, H = 128;
    const canvas = this.cloudTex.image as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const noise = makeNoise(7);
    for (let y = 0; y < H; y++) {
      // Dome v runs from top (y = 0) to just below the horizon.
      const horizonFade = 1 - THREE.MathUtils.smoothstep(y / H, 0.82, 1);
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        let n = 0, amp = 0.5, f = 3;
        for (let o = 0; o < 4; o++) {
          n += amp * noise(Math.cos(u * Math.PI * 2) * f + 10, Math.sin(u * Math.PI * 2) * f + 10, v * f * 2.2);
          amp *= 0.5;
          f *= 2.1;
        }
        const thr = 1 - cover;
        let a = cover >= 0.99 ? 1 : THREE.MathUtils.smoothstep(n, thr - 0.05, thr + 0.28);
        a *= horizonFade * (cover >= 0.99 ? 1 : 0.95);
        const shade = cover >= 0.99 ? 210 + n * 40 : 235 + n * 20;
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = shade;
        img.data[i + 2] = Math.min(255, shade + 6);
        img.data[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.cloudTex.needsUpdate = true;
  }
}

/** Small value-noise in 3D, enough for clouds. */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const val = (x: number, y: number, z: number) => perm[(perm[(perm[x & 255]! + y) & 255]! + z) & 255]! / 255;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const l = THREE.MathUtils.lerp;
    const c = (dx: number, dy: number, dz: number) => val(xi + dx, yi + dy, zi + dz);
    return l(
      l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
      l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
      zf,
    );
  };
}
