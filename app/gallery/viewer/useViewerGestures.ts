"use client";

// Pointer/wheel gestures for the viewer. Transforms go straight to the DOM; React hears only outcomes.

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  IDENTITY,
  clamp,
  clampZoom,
  panBounds,
  rubberBand,
  zoomAround,
  zoomTransform,
  type Size,
  type Zoom,
} from "./geometry";

export const SLIDE_GAP = 24;
export const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const NAV_MS = 300;
const SNAP_MS = 280;
const DOUBLE_TAP_MS = 260;
const DRAG_SLOP_TOUCH = 8;
const DRAG_SLOP_MOUSE = 4;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface GestureContext {
  width: number;
  height: number;
  /** The current item's fitted box at scale 1. */
  box: Size;
  canZoom: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  enabled: boolean;
}

export interface GestureCallbacks {
  getContext(): GestureContext;
  onTap(): void;
  /** First zoom-in on the current item (time to fetch the original). */
  onZoomIn(): void;
  onZoomedChange(zoomed: boolean): void;
  /** The slide-out animation finished; show the neighbour in that direction. */
  onNavigate(direction: -1 | 1): void;
  /** Swipe-down released past the threshold; the photo stays where it was let go, for the viewer to animate. */
  onDismiss(at: { x: number; y: number; s: number }): void;
  onSwipeUp(): void;
  /** 0..1 while the photo is dragged down (fade the chrome). */
  onDismissProgress(progress: number): void;
}

type Mode = "idle" | "pending" | "swipe" | "dismiss" | "pan" | "pinch";

interface Point {
  x: number;
  y: number;
}

interface Elements {
  track: HTMLDivElement | null;
  zoom: HTMLDivElement | null;
  dismiss: HTMLDivElement | null;
  backdrop: HTMLDivElement | null;
}

function readMatrix(el: HTMLElement | null): DOMMatrix | null {
  if (!el) return null;
  const value = getComputedStyle(el).transform;
  if (!value || value === "none") return null;
  try {
    return new DOMMatrix(value);
  } catch {
    return null;
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [data-gesture-ignore]"));
}

export function useViewerGestures(stageRef: RefObject<HTMLDivElement>, callbacks: GestureCallbacks) {
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const els = useRef<Elements>({ track: null, zoom: null, dismiss: null, backdrop: null });
  const st = useRef({
    mode: "idle" as Mode,
    pointers: new Map<number, Point>(),
    pointerType: "touch",
    origin: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0, t: 0 },
    velocity: { x: 0, y: 0 },
    zoom: IDENTITY as Zoom,
    zoomStart: IDENTITY as Zoom,
    panStart: { x: 0, y: 0 },
    pinchDistance: 1,
    pinchMid: { x: 0, y: 0 },
    lastPinchMid: { x: 0, y: 0 },
    trackX: 0,
    trackStart: 0,
    trackAnimUntil: 0,
    zoomAnimUntil: 0,
    dismissY: 0,
    dismissX: 0,
    dismissing: false,
    zoomedNotified: false,
    zoomInFired: false,
    tapTimer: 0,
    lastTap: { t: 0, x: 0, y: 0 },
    navDir: 0 as -1 | 0 | 1,
    navTimer: 0,
    queuedNav: 0 as -1 | 0 | 1,
    rebase: 0,
    settleFallback: 0,
    idleTimer: 0,
  });

  // ---- low-level writers -------------------------------------------------

  const setTrack = useCallback((x: number, ms = 0) => {
    const s = st.current;
    s.trackX = x;
    s.trackAnimUntil = ms ? performance.now() + ms : 0;
    const el = els.current.track;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
    el.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
  }, []);

  const scheduleIdle = useCallback((after: number) => {
    const s = st.current;
    window.clearTimeout(s.idleTimer);
    // Once still, drop the compositor layer so the browser re-rasterizes the zoomed image sharply.
    s.idleTimer = window.setTimeout(() => {
      const el = els.current.zoom;
      if (s.mode !== "idle" || !el) return;
      const z = s.zoom;
      el.style.transition = "none";
      el.style.willChange = "auto";
      el.style.transform = z.s === 1 && z.x === 0 && z.y === 0 ? "" : zoomTransform(z, false);
    }, after + 80);
  }, []);

  const setZoom = useCallback(
    (zoom: Zoom, ms = 0) => {
      const s = st.current;
      s.zoom = zoom;
      s.zoomAnimUntil = ms ? performance.now() + ms : 0;
      const el = els.current.zoom;
      if (el) {
        el.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
        el.style.willChange = "transform";
        el.style.transform = zoomTransform(zoom, true);
      }
      const zoomed = zoom.s > 1.01;
      if (zoomed !== s.zoomedNotified) {
        s.zoomedNotified = zoomed;
        cb.current.onZoomedChange(zoomed);
      }
      if (zoomed && !s.zoomInFired) {
        s.zoomInFired = true;
        cb.current.onZoomIn();
      }
      scheduleIdle(ms);
    },
    [scheduleIdle]
  );

  const setDismiss = useCallback((dy: number, dx: number, ms = 0) => {
    const s = st.current;
    s.dismissY = dy;
    s.dismissX = dx;
    const height = cb.current.getContext().height || 1;
    const progress = dy > 0 ? clamp(dy / (height * 0.45), 0, 1) : 0;
    const resting = dy === 0 && dx === 0;
    const el = els.current.dismiss;
    if (el) {
      el.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
      el.style.transform = resting ? "" : `translate3d(${dx}px, ${dy}px, 0) scale(${1 - progress * 0.25})`;
      // A compositor layer only while the photo follows the finger.
      el.style.willChange = resting && !ms ? "" : "transform";
    }
    const backdrop = els.current.backdrop;
    if (backdrop) {
      backdrop.style.transition = ms ? `opacity ${ms}ms ${EASE}` : "none";
      backdrop.style.opacity = progress === 0 ? "" : String(1 - progress * 0.85);
      backdrop.style.willChange = resting && !ms ? "" : "opacity";
    }
    if (resting && ms) {
      window.setTimeout(() => {
        if (s.dismissY !== 0 || s.dismissX !== 0) return;
        if (els.current.dismiss) els.current.dismiss.style.willChange = "";
        if (els.current.backdrop) els.current.backdrop.style.willChange = "";
      }, ms + 40);
    }
    cb.current.onDismissProgress(progress);
  }, []);

  const cancelTap = useCallback(() => {
    const s = st.current;
    if (s.tapTimer) window.clearTimeout(s.tapTimer);
    s.tapTimer = 0;
  }, []);

  // ---- navigation -------------------------------------------------------

  const finishNav = useCallback(() => {
    const s = st.current;
    const dir = s.navDir;
    if (!dir) return;
    window.clearTimeout(s.navTimer);
    s.navTimer = 0;
    s.navDir = 0;
    // After the index moves, the new current slide sits where the old neighbour was.
    s.rebase = dir * ((cb.current.getContext().width || 0) + SLIDE_GAP);
    cb.current.onNavigate(dir);
    window.clearTimeout(s.settleFallback);
    s.settleFallback = window.setTimeout(() => {
      s.rebase = 0;
      setTrack(0, SNAP_MS);
    }, 450);
  }, [setTrack]);

  const navigate = useCallback(
    (dir: -1 | 1) => {
      const s = st.current;
      const ctx = cb.current.getContext();
      if ((dir === 1 && !ctx.hasNext) || (dir === -1 && !ctx.hasPrev)) {
        if (s.trackX !== 0) setTrack(0, SNAP_MS);
        return;
      }
      if (s.navDir) {
        s.queuedNav = dir;
        finishNav();
        return;
      }
      cancelTap();
      const distance = ctx.width + SLIDE_GAP;
      const target = -dir * distance;
      const ms = Math.round(clamp((Math.abs(target - s.trackX) / Math.max(1, distance)) * NAV_MS, 140, NAV_MS));
      setTrack(target, ms);
      s.navDir = dir;
      s.navTimer = window.setTimeout(finishNav, ms);
    },
    [cancelTap, finishNav, setTrack]
  );

  /** Call (from a layout effect) whenever the displayed item changes. */
  const itemChanged = useCallback(() => {
    const s = st.current;
    window.clearTimeout(s.settleFallback);
    const shift = s.rebase;
    s.rebase = 0;
    if (shift && s.mode !== "idle") {
      s.trackStart += shift;
      setTrack(s.trackX + shift);
    } else {
      setTrack(0);
    }
    s.zoom = IDENTITY;
    s.zoomStart = IDENTITY;
    s.zoomInFired = false;
    s.dismissY = 0;
    s.dismissing = false;
    if (s.zoomedNotified) {
      s.zoomedNotified = false;
      cb.current.onZoomedChange(false);
    }
    if (s.mode === "pan" || s.mode === "pinch") {
      s.mode = "idle";
      s.pointers.clear();
    }
    const queued = s.queuedNav;
    s.queuedNav = 0;
    if (queued) requestAnimationFrame(() => navigate(queued));
  }, [navigate, setTrack]);

  // ---- zoom helpers -----------------------------------------------------

  const settleZoom = useCallback(
    (focal: Point, ms = SNAP_MS) => {
      const ctx = cb.current.getContext();
      let z = st.current.zoom;
      if (z.s <= 1.01) {
        setZoom(IDENTITY, ms);
        return;
      }
      if (z.s > MAX_ZOOM) z = zoomAround(z, MAX_ZOOM, focal.x, focal.y);
      setZoom(clampZoom(z, ctx.box, ctx.width, ctx.height), ms);
    },
    [setZoom]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const ctx = cb.current.getContext();
      if (!ctx.canZoom) return;
      const current = st.current.zoom;
      const next = clamp(current.s * factor, 1, MAX_ZOOM);
      setZoom(
        next <= 1.001 ? IDENTITY : clampZoom(zoomAround(current, next, 0, 0), ctx.box, ctx.width, ctx.height),
        SNAP_MS
      );
    },
    [setZoom]
  );

  const resetZoom = useCallback(
    (animate = true) => {
      if (st.current.zoom !== IDENTITY) setZoom(IDENTITY, animate ? SNAP_MS : 0);
    },
    [setZoom]
  );

  // ---- pointer handling -------------------------------------------------

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = st.current;

    const relative = (p: Point, ctx: GestureContext): Point => ({
      x: p.x - s.origin.x - ctx.width / 2,
      y: p.y - s.origin.y - ctx.height / 2,
    });

    const twoPointers = (): [Point, Point] => {
      const values = Array.from(s.pointers.values());
      return [values[0], values[1]];
    };

    const beginPinch = (ctx: GestureContext) => {
      if (s.trackX !== 0) setTrack(0, SNAP_MS);
      if (s.dismissY !== 0) setDismiss(0, 0, SNAP_MS);
      cancelTap();
      const [a, b] = twoPointers();
      s.mode = "pinch";
      s.pinchDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      s.pinchMid = relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ctx);
      s.lastPinchMid = s.pinchMid;
      s.zoomStart = s.zoom;
    };

    const freezeRunningAnimations = () => {
      const now = performance.now();
      if (now < s.trackAnimUntil) {
        const m = readMatrix(els.current.track);
        setTrack(m ? m.e : s.trackX);
      }
      if (now < s.zoomAnimUntil) {
        const m = readMatrix(els.current.zoom);
        if (m) setZoom({ s: m.a, x: m.e, y: m.f });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const ctx = cb.current.getContext();
      if (!ctx.enabled || s.dismissing) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (isInteractive(e.target)) return;

      if (s.pointers.size === 0) {
        const rect = stage.getBoundingClientRect();
        s.origin = { x: rect.left, y: rect.top };
        freezeRunningAnimations();
        // A swipe that's still sliding: land it now so fast swipes chain.
        if (s.navDir) finishNav();
      }
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.pointerType = e.pointerType;
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone.
      }

      if (s.pointers.size === 1) {
        s.mode = "pending";
        s.start = { x: e.clientX, y: e.clientY };
        s.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        s.velocity = { x: 0, y: 0 };
        s.trackStart = s.trackX;
      } else if (s.pointers.size === 2 && ctx.canZoom) {
        beginPinch(ctx);
      }
    };

    const movePan = (x0: number, y0: number, ctx: GestureContext) => {
      let x = s.zoomStart.x + (x0 - s.panStart.x);
      let y = s.zoomStart.y + (y0 - s.panStart.y);
      const bounds = panBounds(ctx.box, s.zoom.s, ctx.width, ctx.height);
      let track = 0;
      // Past the image edge the drag carries on into the neighbouring photo.
      if (x > bounds.x) {
        const over = x - bounds.x;
        if (ctx.hasPrev) {
          track = over;
          x = bounds.x;
        } else x = bounds.x + rubberBand(over, ctx.width);
      } else if (x < -bounds.x) {
        const over = x + bounds.x;
        if (ctx.hasNext) {
          track = over;
          x = -bounds.x;
        } else x = -bounds.x + rubberBand(over, ctx.width);
      }
      if (y > bounds.y) y = bounds.y + rubberBand(y - bounds.y, ctx.height);
      else if (y < -bounds.y) y = -bounds.y + rubberBand(y + bounds.y, ctx.height);
      setZoom({ s: s.zoom.s, x, y });
      setTrack(track);
    };

    const movePinch = (ctx: GestureContext) => {
      const [a, b] = twoPointers();
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ctx);
      s.lastPinchMid = mid;
      let scale = s.zoomStart.s * (distance / s.pinchDistance);
      if (scale > MAX_ZOOM) scale = MAX_ZOOM * Math.pow(scale / MAX_ZOOM, 0.3);
      else if (scale < 1) scale = Math.pow(scale, 0.45);
      const ratio = scale / s.zoomStart.s;
      setZoom({
        s: scale,
        x: mid.x - ratio * (s.pinchMid.x - s.zoomStart.x),
        y: mid.y - ratio * (s.pinchMid.y - s.zoomStart.y),
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const ctx = cb.current.getContext();
      if (s.mode === "pinch") {
        if (s.pointers.size >= 2) movePinch(ctx);
        return;
      }
      if (s.pointers.size !== 1 || s.mode === "idle") return;

      const dt = e.timeStamp - s.last.t;
      if (dt > 0) {
        const vx = (e.clientX - s.last.x) / dt;
        const vy = (e.clientY - s.last.y) / dt;
        s.velocity = { x: 0.7 * vx + 0.3 * s.velocity.x, y: 0.7 * vy + 0.3 * s.velocity.y };
        s.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      }
      const dx = e.clientX - s.start.x;
      const dy = e.clientY - s.start.y;

      if (s.mode === "pending") {
        const slop = s.pointerType === "mouse" ? DRAG_SLOP_MOUSE : DRAG_SLOP_TOUCH;
        if (Math.hypot(dx, dy) < slop) return;
        if (s.zoom.s > 1.01) {
          s.mode = "pan";
          s.panStart = { x: e.clientX, y: e.clientY };
          s.zoomStart = s.zoom;
        } else {
          s.mode = Math.abs(dx) >= Math.abs(dy) || s.trackX !== 0 ? "swipe" : "dismiss";
        }
      }

      if (s.mode === "swipe") {
        let x = s.trackStart + dx;
        if ((x > 0 && !ctx.hasPrev) || (x < 0 && !ctx.hasNext)) x = rubberBand(x, ctx.width, 0.4);
        setTrack(x);
      } else if (s.mode === "dismiss") {
        if (dy >= 0) setDismiss(dy, dx * 0.5);
        else setDismiss(rubberBand(dy, ctx.height, 0.35), 0);
      } else if (s.mode === "pan") {
        movePan(e.clientX, e.clientY, ctx);
      }
    };

    const releaseTrack = (ctx: GestureContext): boolean => {
      const x = s.trackX;
      const v = s.velocity.x;
      const threshold = ctx.width * 0.18;
      if ((x < -threshold || (v < -0.45 && x < -16)) && ctx.hasNext) {
        navigate(1);
        return true;
      }
      if ((x > threshold || (v > 0.45 && x > 16)) && ctx.hasPrev) {
        navigate(-1);
        return true;
      }
      if (x !== 0) setTrack(0, SNAP_MS);
      return false;
    };

    const releaseDismiss = (ctx: GestureContext) => {
      const dy = s.dismissY;
      const vy = s.velocity.y;
      if (dy > 110 || (vy > 0.55 && dy > 24)) {
        s.dismissing = true;
        const progress = clamp(dy / ((ctx.height || 1) * 0.45), 0, 1);
        cb.current.onDismiss({ x: s.dismissX, y: dy, s: 1 - progress * 0.25 });
        return;
      }
      setDismiss(0, 0, SNAP_MS);
      if (dy < -60 || (vy < -0.5 && dy < -16)) cb.current.onSwipeUp();
    };

    const releasePan = (ctx: GestureContext) => {
      if (s.trackX !== 0 && releaseTrack(ctx)) return;
      if (s.zoom.s < 1) {
        setZoom(IDENTITY, SNAP_MS);
        return;
      }
      // A flick keeps gliding briefly, then stops at the edges.
      const glide = 220;
      const target = { s: s.zoom.s, x: s.zoom.x + s.velocity.x * glide, y: s.zoom.y + s.velocity.y * glide };
      setZoom(clampZoom(target, ctx.box, ctx.width, ctx.height), SNAP_MS + 120);
    };

    const handleTap = (x: number, y: number, ctx: GestureContext) => {
      const now = performance.now();
      const prev = s.lastTap;
      if (ctx.canZoom && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < 40) {
        cancelTap();
        s.lastTap = { t: 0, x: 0, y: 0 };
        if (s.zoom.s > 1.01) {
          setZoom(IDENTITY, SNAP_MS);
        } else {
          const z = zoomAround(IDENTITY, Math.min(MAX_ZOOM, DOUBLE_TAP_ZOOM), x - ctx.width / 2, y - ctx.height / 2);
          setZoom(clampZoom(z, ctx.box, ctx.width, ctx.height), SNAP_MS);
        }
        return;
      }
      s.lastTap = { t: now, x, y };
      cancelTap();
      if (!ctx.canZoom) {
        cb.current.onTap();
        return;
      }
      s.tapTimer = window.setTimeout(() => {
        s.tapTimer = 0;
        cb.current.onTap();
      }, DOUBLE_TAP_MS);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.delete(e.pointerId);
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {
        // Already released.
      }
      const ctx = cb.current.getContext();
      if (e.timeStamp - s.last.t > 90) s.velocity = { x: 0, y: 0 };

      if (s.mode === "pinch") {
        if (s.pointers.size === 1) {
          const [p] = Array.from(s.pointers.values());
          s.mode = "pan";
          s.panStart = { ...p };
          s.start = { ...p };
          s.zoomStart = s.zoom;
          s.last = { x: p.x, y: p.y, t: e.timeStamp };
          s.velocity = { x: 0, y: 0 };
        } else if (s.pointers.size === 0) {
          s.mode = "idle";
          settleZoom(s.lastPinchMid);
        }
        return;
      }
      if (s.pointers.size > 0) return;

      const mode = s.mode;
      s.mode = "idle";
      if (e.type === "pointercancel") {
        if (s.trackX !== 0) setTrack(0, SNAP_MS);
        if (s.dismissY !== 0) setDismiss(0, 0, SNAP_MS);
        settleZoom({ x: 0, y: 0 });
        return;
      }
      if (mode === "pending") handleTap(e.clientX - s.origin.x, e.clientY - s.origin.y, ctx);
      else if (mode === "swipe") releaseTrack(ctx);
      else if (mode === "dismiss") releaseDismiss(ctx);
      else if (mode === "pan") releasePan(ctx);
    };

    const onWheel = (e: WheelEvent) => {
      const ctx = cb.current.getContext();
      if (!ctx.enabled) return;
      e.preventDefault();
      if (!ctx.canZoom || s.mode !== "idle") return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? ctx.height : 1;
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0022));
      const current = s.zoom;
      const next = clamp(current.s * factor, 1, MAX_ZOOM);
      if (next === current.s) return;
      const rect = stage.getBoundingClientRect();
      const fx = e.clientX - rect.left - ctx.width / 2;
      const fy = e.clientY - rect.top - ctx.height / 2;
      setZoom(next <= 1.001 ? IDENTITY : clampZoom(zoomAround(current, next, fx, fy), ctx.box, ctx.width, ctx.height));
    };

    const onContextMenu = (e: Event) => {
      if (s.pointerType !== "mouse") e.preventDefault();
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("contextmenu", onContextMenu);
    return () => {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("contextmenu", onContextMenu);
      window.clearTimeout(s.tapTimer);
      window.clearTimeout(s.navTimer);
      window.clearTimeout(s.settleFallback);
      window.clearTimeout(s.idleTimer);
    };
  }, [stageRef, cancelTap, finishNav, navigate, setDismiss, setTrack, setZoom, settleZoom]);

  // ---- element refs -----------------------------------------------------

  const setTrackEl = useCallback((el: HTMLDivElement | null) => {
    els.current.track = el;
  }, []);

  // The zoom/dismiss refs move to a new slide when the item changes; clear what the old one kept.
  const setZoomEl = useCallback((el: HTMLDivElement | null) => {
    const prev = els.current.zoom;
    if (prev && prev !== el) {
      prev.style.transform = "";
      prev.style.transition = "";
      prev.style.willChange = "";
    }
    els.current.zoom = el;
  }, []);

  const setDismissEl = useCallback((el: HTMLDivElement | null) => {
    const prev = els.current.dismiss;
    if (prev && prev !== el) {
      prev.style.transform = "";
      prev.style.transition = "";
      prev.style.opacity = "";
    }
    els.current.dismiss = el;
  }, []);

  const setBackdropEl = useCallback((el: HTMLDivElement | null) => {
    els.current.backdrop = el;
  }, []);

  /** The current item's zoom (scale and pan from the stage centre). */
  const currentZoom = useCallback((): Zoom => st.current.zoom, []);

  /** Ends any drag at once (the viewer is closing). */
  const cancel = useCallback(() => {
    const s = st.current;
    s.dismissing = true;
    s.mode = "idle";
    s.pointers.clear();
    cancelTap();
  }, [cancelTap]);

  return useMemo(
    () => ({ setTrackEl, setZoomEl, setDismissEl, setBackdropEl, navigate, zoomBy, resetZoom, itemChanged, currentZoom, cancel }),
    [setTrackEl, setZoomEl, setDismissEl, setBackdropEl, navigate, zoomBy, resetZoom, itemChanged, currentZoom, cancel]
  );
}
