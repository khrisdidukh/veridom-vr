import * as THREE from "three";
import { normAngle, type Alignment, type WorldPoint } from "./align";

// The optional WebXR pieces the on-site mode uses when the headset grants
// them: hit-test against real surfaces, an anchor that keeps the house on its
// spot, a persistent handle for the next visit, and the unbounded reference
// space for large plots. Every piece is optional; without it the mode falls
// back to the floor plane of the reference space and to localStorage.

type PersistentAnchor = XRAnchor & { requestPersistentHandle?: () => Promise<string> };
type PersistentSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
  enabledFeatures?: readonly string[];
};

const yawQuat = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

function alignmentFromTransform(t: XRRigidTransform): Alignment {
  const q = new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return { x: t.position.x, y: t.position.y, z: t.position.z, yaw: normAngle(Math.atan2(-ax.z, ax.x)) };
}

export class SiteXR {
  readonly features = { hitTest: false, anchors: false, persistent: false, unbounded: false };
  /** "anchor" (tracked by the headset), "anchor-saved" (also kept for the next visit) or "none". */
  anchorState: "none" | "anchor" | "anchor-saved" = "none";
  anchorId: string | undefined;
  spaceType = "local-floor";
  private session: PersistentSession | null = null;
  private hitSources = new Map<XRInputSource, XRHitTestSource>();
  private anchor: PersistentAnchor | null = null;
  private pendingUnbounded: XRReferenceSpace | null = null;
  private triedUnbounded = false;
  private placeToken = 0;

  constructor(private renderer: THREE.WebGLRenderer, private allowUnbounded = true) {}

  start(session: XRSession) {
    this.session = session as PersistentSession;
    const on = this.session.enabledFeatures;
    const has = (f: string, probe: boolean) => (on ? on.includes(f) : probe);
    this.features.hitTest = has("hit-test", false) && typeof session.requestHitTestSource === "function";
    this.features.anchors = has("anchors", false);
    this.features.persistent = this.features.anchors && typeof this.session.restorePersistentAnchor === "function";
    this.features.unbounded = false;
    this.spaceType = "local-floor";
    this.triedUnbounded = false;
    this.pendingUnbounded = null;
    this.anchor = null;
    this.anchorState = "none";
    this.hitSources.clear();
  }

  end() {
    this.session = null;
    this.hitSources.clear();
    this.anchor = null;
    this.anchorState = "none";
    this.pendingUnbounded = null;
  }

  /** Starts hit-testing along this hand's or controller's pointing ray. */
  addInput(source: XRInputSource) {
    const s = this.session;
    if (!s || !this.features.hitTest || this.hitSources.has(source) || !s.requestHitTestSource) return;
    s.requestHitTestSource({ space: source.targetRaySpace })
      ?.then((hs) => {
        if (hs && this.session === s) this.hitSources.set(source, hs);
      })
      .catch(() => {
        /* no hit-test for this input: the floor plane is used */
      });
  }

  removeInput(source: XRInputSource) {
    const hs = this.hitSources.get(source);
    this.hitSources.delete(source);
    try {
      hs?.cancel();
    } catch {
      /* already gone */
    }
  }

  /** Where this input's ray meets a real surface, if the headset knows. */
  hit(source: XRInputSource | null, frame: XRFrame | null): WorldPoint | null {
    const hs = source && this.hitSources.get(source);
    const ref = this.renderer.xr.getReferenceSpace();
    if (!hs || !frame || !ref) return null;
    try {
      const pose = frame.getHitTestResults(hs)[0]?.getPose(ref);
      if (!pose) return null;
      const p = pose.transform.position;
      return { x: p.x, y: p.y, z: p.z };
    } catch {
      return null;
    }
  }

  /**
   * Large plots: move to the unbounded reference space when the session has it.
   * The new space is offset so its origin and floor coincide with the current
   * one, which keeps everything already placed where it is.
   */
  requestUnbounded() {
    const s = this.session;
    if (!s || this.triedUnbounded || !this.allowUnbounded) return;
    this.triedUnbounded = true;
    if (s.enabledFeatures && !s.enabledFeatures.includes("unbounded")) return;
    s.requestReferenceSpace("unbounded").then(
      (space) => {
        if (this.session === s) this.pendingUnbounded = space as XRReferenceSpace;
      },
      () => {
        /* not granted: local-floor stays */
      },
    );
  }

  /** Call every frame. Returns the anchor's current alignment when one is tracked. */
  update(frame: XRFrame | null): Alignment | null {
    const ref = this.renderer.xr.getReferenceSpace();
    if (!frame || !ref) return null;
    if (this.pendingUnbounded) {
      try {
        const pose = frame.getPose(ref, this.pendingUnbounded);
        if (pose) {
          this.renderer.xr.setReferenceSpace(this.pendingUnbounded.getOffsetReferenceSpace(pose.transform));
          this.features.unbounded = true;
          this.spaceType = "unbounded";
          this.pendingUnbounded = null;
        }
      } catch {
        this.pendingUnbounded = null;
      }
      return null; // anchor poses are read in the new space from the next frame on
    }
    if (!this.anchor) return null;
    try {
      const pose = frame.getPose(this.anchor.anchorSpace, ref);
      return pose ? alignmentFromTransform(pose.transform) : null;
    } catch {
      return null;
    }
  }

  /** Pins the house origin to the real world. Resolves with the persistent handle, if the browser gives one. */
  async place(a: Alignment, frame: XRFrame | null): Promise<string | undefined> {
    const token = ++this.placeToken;
    const old = this.anchor;
    const oldId = this.anchorId;
    this.anchor = null;
    this.anchorId = undefined;
    this.anchorState = "none";
    try {
      old?.delete();
    } catch {
      /* already gone */
    }
    const s = this.session;
    if (oldId && s?.deletePersistentAnchor) s.deletePersistentAnchor(oldId).catch(() => {});
    const ref = this.renderer.xr.getReferenceSpace();
    if (!s || !this.features.anchors || !frame?.createAnchor || !ref) return undefined;
    try {
      const q = yawQuat(a.yaw);
      const anchor = (await frame.createAnchor(new XRRigidTransform({ x: a.x, y: a.y, z: a.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), ref)) as PersistentAnchor | undefined;
      if (!anchor || token !== this.placeToken || this.session !== s) {
        anchor?.delete();
        return undefined;
      }
      this.anchor = anchor;
      this.anchorState = "anchor";
      if (anchor.requestPersistentHandle) {
        try {
          const id = await anchor.requestPersistentHandle();
          if (token === this.placeToken) {
            this.anchorId = id;
            this.anchorState = "anchor-saved";
          }
          return id;
        } catch {
          /* tracked for this session only */
        }
      }
    } catch {
      /* anchors refused: the alignment still holds in the reference space */
    }
    return undefined;
  }

  /** Brings back the anchor of an earlier visit. */
  async restore(id: string): Promise<boolean> {
    const s = this.session;
    if (!s?.restorePersistentAnchor || !this.features.anchors) return false;
    try {
      const anchor = await s.restorePersistentAnchor(id);
      if (this.session !== s) return false;
      this.anchor = anchor as PersistentAnchor;
      this.anchorId = id;
      this.anchorState = "anchor-saved";
      return true;
    } catch {
      return false;
    }
  }

  /** Forgets the anchor (before a re-align). */
  release() {
    this.placeToken++;
    try {
      this.anchor?.delete();
    } catch {
      /* already gone */
    }
    if (this.anchorId && this.session?.deletePersistentAnchor) this.session.deletePersistentAnchor(this.anchorId).catch(() => {});
    this.anchor = null;
    this.anchorId = undefined;
    this.anchorState = "none";
  }
}
