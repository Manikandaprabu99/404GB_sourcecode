"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { MediaIndexEntry } from "@/lib/media";
import type { Spotlight } from "@/lib/library/memories";
import { canStream, streamUrl, subscribeStreamSupport } from "@/lib/media/stream";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { CloseIcon } from "@/app/components/library/icons";
import GalleryThumb from "../GalleryThumb";

interface StoryPlayerProps {
  spotlight: Spotlight;
  repoKey: string;
  /** The story has closed (its animation finished); unmount it. */
  onClose: () => void;
  /** "Open" or a swipe up: show this item in the viewer (the story closes first). */
  onOpenItem: (id: string) => void;
}

/** docs/DESIGN.md "Photos — new experiences" 2: 5s per photo. */
const PHOTO_MS = 5000;
const HOLD_MS = 220;
/** A photo that hasn't loaded after this long plays anyway (its skeleton shows). */
const LOAD_WAIT_MS = 4000;
const CLOSE_DRAG_PX = 110;
const OPEN_DRAG_PX = 90;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function isVideo(item: MediaIndexEntry): boolean {
  return item.mimeType.startsWith("video/");
}

function dateOf(item: MediaIndexEntry | undefined): string {
  const taken = item?.takenAt ?? item?.createdAt;
  if (!taken) return "";
  const date = new Date(taken);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function VolumeGlyph({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
      {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}

/** Full-screen memory story: 5s per photo, tap thirds to step, hold to pause, swipe down to
 * close into the card, swipe up or "Open" for the viewer. Back closes it. */
export default function StoryPlayer({ spotlight, repoKey, onClose, onOpenItem }: StoryPlayerProps) {
  const items = spotlight.items;
  const [index, setIndex] = useState(0);
  const [holding, setHolding] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  // Bumped on every step so the running segment restarts even on the same index.
  const [epoch, setEpoch] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused || holding;
  const streamable = useSyncExternalStore(subscribeStreamSupport, canStream, () => false);
  const [videoFailed, setVideoFailed] = useState<ReadonlySet<string>>(() => new Set());
  const current = items[index];
  const playsVideo = Boolean(current && isVideo(current) && streamable && !videoFailed.has(current.id));

  const step = useCallback(
    (direction: 1 | -1) => {
      setEpoch((e) => e + 1);
      setIndex((i) => {
        const next = i + direction;
        if (next < 0) return 0;
        if (next >= items.length) {
          // Played to the end: close.
          window.setTimeout(() => requestCloseRef.current(), 0);
          return i;
        }
        return next;
      });
    },
    [items.length]
  );

  // ---- open / close animations (into and out of the card) ----

  const cardTransform = useCallback(() => {
    const stage = stageRef.current;
    const card = document.querySelector<HTMLElement>(`[data-memory="${CSS.escape(spotlight.key)}"]`);
    if (!stage || !card) return null;
    const c = card.getBoundingClientRect();
    if (c.width === 0 || c.bottom <= 0 || c.top >= window.innerHeight) return null;
    const s = { left: stage.offsetLeft, top: stage.offsetTop, width: stage.offsetWidth, height: stage.offsetHeight };
    const scale = c.width / s.width;
    const tx = c.left - s.left;
    const ty = c.top + c.height / 2 - s.top - (s.height * scale) / 2;
    const insetY = Math.max(0, (s.height * scale - c.height) / 2 / scale);
    return {
      transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
      clipPath: `inset(${insetY}px 0px ${insetY}px 0px round ${26 / scale}px)`,
    };
  }, [spotlight.key]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const backdrop = backdropRef.current;
    if (!stage || !backdrop || typeof stage.animate !== "function") return;
    if (reducedMotion()) {
      rootRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      return;
    }
    const from = cardTransform();
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: EASE });
    if (from) {
      stage.animate([from, { transform: "translate3d(0, 0, 0) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" }], {
        duration: 420,
        easing: EASE,
      });
    } else {
      stage.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "scale(1)" }], { duration: 320, easing: EASE });
    }
  }, [cardTransform]);

  const finishClose = useCallback(
    (then?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const stage = stageRef.current;
      const backdrop = backdropRef.current;
      const done = () => {
        onClose();
        then?.();
      };
      if (!stage || !backdrop || typeof stage.animate !== "function") return done();
      if (reducedMotion() || then) {
        const animation = rootRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: then ? 160 : 120, fill: "forwards" });
        if (animation) animation.onfinish = done;
        else done();
        return;
      }
      const to = cardTransform();
      const start = stage.style.transform || "translate3d(0, 0, 0) scale(1)";
      backdrop.animate([{ opacity: Number(backdrop.style.opacity || 1) }, { opacity: 0 }], { duration: 360, easing: EASE, fill: "forwards" });
      const animation = to
        ? stage.animate([{ transform: start, clipPath: "inset(0px 0px 0px 0px round 22px)" }, to], { duration: 380, easing: EASE, fill: "forwards" })
        : stage.animate([{ transform: start, opacity: 1 }, { transform: `${start} scale(0.92)`, opacity: 0 }], { duration: 260, easing: EASE, fill: "forwards" });
      animation.onfinish = done;
    },
    [cardTransform, onClose]
  );
  const requestCloseRef = useRef<() => void>(() => {});
  requestCloseRef.current = () => finishClose();

  // Back (browser or Android) closes the story.
  useHistoryOverlay(true, () => finishClose());

  const openCurrent = useCallback(() => {
    const id = items[index]?.id;
    if (!id) return;
    finishClose(() => onOpenItem(id));
  }, [finishClose, index, items, onOpenItem]);

  // ---- playback clock: photos 5s (once loaded), videos by their own time ----

  useEffect(() => {
    const fill = fillRef.current;
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    let waited = 0;
    const slide = () => stageRef.current?.querySelector<HTMLElement>(`[data-slide="${index}"]`);
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const hidden = document.visibilityState === "hidden";
      const el = slide();
      const video = playsVideo ? el?.querySelector("video") : null;
      let progress = 0;
      if (video) {
        if (pausedRef.current || hidden) {
          if (!video.paused) video.pause();
        } else if (video.paused && !video.ended) {
          void video.play().catch(() => {});
        }
        progress = video.ended ? 1 : video.duration > 0 ? video.currentTime / video.duration : 0;
      } else {
        const img = el?.querySelector("img");
        const ready = Boolean(img && img.complete && img.naturalWidth > 0) || !current?.thumb || waited > LOAD_WAIT_MS;
        if (!pausedRef.current && !hidden) {
          if (ready) elapsed += dt;
          else waited += dt;
        }
        progress = elapsed / PHOTO_MS;
      }
      if (fill) fill.style.transform = `scaleX(${Math.min(1, progress)})`;
      if (progress >= 1) {
        step(1);
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      if (fill) fill.style.transform = "";
    };
  }, [index, epoch, playsVideo, current, step]);

  // The video element's `muted` follows the button (React doesn't keep the property in sync).
  useEffect(() => {
    const video = stageRef.current?.querySelector<HTMLVideoElement>(`[data-slide="${index}"] video`);
    if (video) video.muted = muted;
  }, [muted, index, playsVideo]);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // Keyboard: arrows step, space pauses, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Escape") finishClose();
      else if (e.key === " ") setPaused((p) => !p);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, finishClose]);

  // ---- gestures: tap left/right third, hold to pause, swipe down to close, up to open ----

  const gesture = useRef<{ id: number; x: number; y: number; t: number; timer: number; dragging: boolean; held: boolean } | null>(null);

  const setDrag = (dy: number) => {
    const stage = stageRef.current;
    const backdrop = backdropRef.current;
    if (!stage || !backdrop) return;
    if (dy === 0) {
      stage.style.transform = "";
      backdrop.style.opacity = "";
      return;
    }
    const down = Math.max(0, dy);
    const scale = 1 - Math.min(0.25, down / 1800);
    const width = stage.offsetWidth;
    stage.style.transform = `translate3d(${(width * (1 - scale)) / 2}px, ${dy > 0 ? dy : dy * 0.35}px, 0) scale(${scale})`;
    backdrop.style.opacity = String(Math.max(0.2, 1 - down / 500));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || closingRef.current) return;
    if ((e.target as Element).closest("button, a")) return;
    const g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), timer: 0, dragging: false, held: false };
    g.timer = window.setTimeout(() => {
      g.held = true;
      setHolding(true);
    }, HOLD_MS);
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.dragging && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      g.dragging = true;
      window.clearTimeout(g.timer);
      setHolding(true);
    }
    if (g.dragging) setDrag(dy);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    window.clearTimeout(g.timer);
    const dy = e.clientY - g.y;
    const elapsed = performance.now() - g.t;
    if (g.dragging) {
      const fast = elapsed < 260;
      if (dy > CLOSE_DRAG_PX || (fast && dy > 50)) {
        finishClose();
        return;
      }
      if (dy < -OPEN_DRAG_PX || (fast && dy < -50)) {
        setDrag(0);
        openCurrent();
        return;
      }
      const stage = stageRef.current;
      if (stage && typeof stage.animate === "function" && stage.style.transform) {
        stage.animate([{ transform: stage.style.transform }, { transform: "translate3d(0, 0, 0) scale(1)" }], { duration: 300, easing: EASE });
      }
      setDrag(0);
      setHolding(false);
      return;
    }
    if (g.held) {
      setHolding(false);
      return;
    }
    if (e.type === "pointercancel") return;
    const rect = e.currentTarget.getBoundingClientRect();
    step(e.clientX - rect.left < rect.width / 3 ? -1 : 1);
  };

  const date = dateOf(current);
  const chromeHidden = holding;

  // Slides around the current one: the previous fades out, the next two load ahead.
  const slides: number[] = [];
  for (let i = Math.max(0, index - 1); i <= Math.min(items.length - 1, index + 2); i++) slides.push(i);

  const content = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${spotlight.title} story`}
      className={`fixed inset-0 z-viewer select-none overflow-hidden text-white ${paused || holding ? "lp-story-paused" : ""}`}
      style={{ touchAction: "none" }}
    >
      <div ref={backdropRef} className="absolute inset-0 bg-black" />
      <div
        ref={stageRef}
        className="absolute inset-0 origin-top-left overflow-hidden bg-black will-change-transform sm:inset-y-4 sm:left-0 sm:right-0 sm:mx-auto sm:w-[min(30rem,calc((100dvh-2rem)*0.5625))] sm:rounded-[22px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {slides.map((i) => {
          const item = items[i];
          const on = i === index;
          const video = on && playsVideo;
          return (
            <div
              key={item.id}
              data-slide={i}
              aria-hidden={!on}
              className="lp-story-slide absolute inset-0"
              style={{ opacity: on ? 1 : 0 }}
            >
              <div className={`absolute inset-0 ${on ? "lp-story-zoom" : ""}`}>
                <GalleryThumb
                  repoKey={repoKey}
                  mediaId={item.id}
                  alt={on ? item.filename : ""}
                  size={800}
                  hasThumbnail={Boolean(item.thumb)}
                  isVideo={isVideo(item)}
                  className="h-full w-full object-cover"
                />
                {video && (
                  <video
                    src={streamUrl(item.id)}
                    muted
                    playsInline
                    autoPlay
                    preload="auto"
                    onError={() => setVideoFailed((prev) => new Set(prev).add(item.id))}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Scrims so the white chrome reads on any photo. */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent transition-opacity duration-200 ${chromeHidden ? "opacity-0" : ""}`} />
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/50 to-transparent transition-opacity duration-200 ${chromeHidden ? "opacity-0" : ""}`} />

        <div className={`absolute inset-x-0 top-0 px-3 pt-safe-2 transition-opacity duration-200 sm:pt-3 ${chromeHidden ? "opacity-0" : ""}`}>
          <div
            className="flex gap-1 pt-2"
            role="progressbar"
            aria-label="Story progress"
            aria-valuemin={1}
            aria-valuemax={items.length}
            aria-valuenow={index + 1}
            aria-valuetext={`${index + 1} of ${items.length}`}
          >
            {items.map((item, i) => (
              <span key={item.id} className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/30">
                <span
                  key={i === index ? `run-${epoch}` : "rest"}
                  ref={i === index ? fillRef : undefined}
                  data-state={i < index ? "done" : i === index ? "run-js" : "idle"}
                  className="lp-story-fill absolute inset-0 rounded-full bg-white"
                />
              </span>
            ))}
          </div>
          <div className="flex items-start gap-2 pl-1 pt-3">
            <div className="min-w-0 flex-1 [text-shadow:0_1px_8px_rgb(0_0_0/0.35)]">
              <p className="truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em]">{spotlight.title}</p>
              <p className="truncate text-[13px] leading-[18px] text-white/80 tabular-nums">
                {date}
                {spotlight.kind === "on-this-day" && spotlight.subtitle ? ` · ${spotlight.subtitle.split(" · ")[0]}` : ""}
              </p>
            </div>
            {playsVideo && (
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute" : "Mute"}
                className="lp-story-chrome flex h-10 w-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <VolumeGlyph muted={muted} />
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => finishClose()}
              aria-label="Close story"
              className="lp-story-chrome flex h-10 w-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </div>

        <div className={`absolute inset-x-0 bottom-0 flex justify-center pb-safe-4 transition-opacity duration-200 sm:pb-5 ${chromeHidden ? "opacity-0" : ""}`}>
          <button
            type="button"
            onClick={openCurrent}
            className="lp-story-chrome flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
            Open
          </button>
        </div>
        {paused && !holding && (
          <button
            type="button"
            onClick={() => setPaused(false)}
            aria-label="Resume story"
            className="lp-story-chrome absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-fade-in items-center justify-center rounded-full"
          >
            <svg viewBox="0 0 12 12" width="20" height="20" aria-hidden="true" fill="currentColor">
              <path d="M3.2 1.7v8.6a.7.7 0 0 0 1.06.6l6.9-4.3a.7.7 0 0 0 0-1.2L4.26 1.1a.7.7 0 0 0-1.06.6Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(content, document.body);
}
