// Shared-element zoom: a clip box scaled to the window, the image inside counter-scaled so it
// stays undistorted. Transform and opacity only, keyframes sampled from the spring curve.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A window on screen and how wide the (centred) photo is inside it. */
export interface FlipState {
  window: Rect;
  imageWidth: number;
}

/** The standard spring (docs/DESIGN.md › Motion). */
export const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
export const OPEN_MS = 360;
export const CLOSE_MS = 320;

function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Newton can wander on flat parts of the curve: fall back to bisection.
    if (t < 0 || t > 1 || Math.abs(sampleX(t) - x) > 1e-3) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 24; i++) {
        if (sampleX(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sampleY(t);
  };
}

const springCurve = bezier(0.32, 0.72, 0, 1);

/** The photo fitted to fill the window, cropped (how a grid tile shows it). */
export function coverState(window: Rect, aspect: number): FlipState {
  return { window, imageWidth: Math.max(window.width, window.height * aspect) };
}

/** The photo's own box: the window is the whole photo. */
export function containState(window: Rect): FlipState {
  return { window, imageWidth: window.width };
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

function frame(from: FlipState, to: FlipState, p: number, base: { w: number; h: number }, aspect: number) {
  const left = lerp(from.window.left, to.window.left, p);
  const top = lerp(from.window.top, to.window.top, p);
  const width = Math.max(1, lerp(from.window.width, to.window.width, p));
  const height = Math.max(1, lerp(from.window.height, to.window.height, p));
  const imageWidth = lerp(from.imageWidth, to.imageWidth, p);
  const imageHeight = imageWidth / aspect;
  const sx = width / base.w;
  const sy = height / base.h;
  // The image, in the clip box's own (unscaled) coordinates, centred in the window.
  const ix = (width - imageWidth) / 2 / sx;
  const iy = (height - imageHeight) / 2 / sy;
  const isx = imageWidth / sx / base.w;
  const isy = imageHeight / sy / base.h;
  return {
    clip: `translate3d(${left}px, ${top}px, 0) scale(${sx}, ${sy})`,
    image: `translate3d(${ix}px, ${iy}px, 0) scale(${isx}, ${isy})`,
  };
}

export interface FlipLayer {
  src: string;
  /** Opacity keyframes over the whole run, e.g. [1, 1, 0] to fade out in the second half. */
  opacity?: number[];
}

export interface FlipRun {
  finished: Promise<void>;
  /** Removes the overlay now (also cancels the animation). */
  remove(): void;
}

/** Plays the overlay in `host` from `from` to `to`; `layers` stack bottom to top.
 * It holds its last frame until `remove()`, for a flash-free hand-off. */
export function playFlip({
  host,
  layers,
  aspect,
  from,
  to,
  duration,
  baseWidth,
  fadeOut = false,
}: {
  host: HTMLElement;
  layers: FlipLayer[];
  aspect: number;
  from: FlipState;
  to: FlipState;
  duration: number;
  /** The overlay's layout width before scaling: the photo's fitted width, so it rasterizes at screen size. */
  baseWidth: number;
  /** Fades the whole overlay out over the last part (no tile to land in). */
  fadeOut?: boolean;
}): FlipRun {
  const w = Math.max(1, Math.round(baseWidth));
  const base = { w, h: w / aspect };
  const clip = document.createElement("div");
  clip.className = "lv-flip-clip";
  clip.setAttribute("aria-hidden", "true");
  clip.style.width = `${base.w}px`;
  clip.style.height = `${base.h}px`;
  const images: HTMLImageElement[] = layers.map((layer) => {
    const img = document.createElement("img");
    img.className = "lv-flip-img";
    img.alt = "";
    img.draggable = false;
    img.decoding = "sync";
    img.src = layer.src;
    img.style.width = `${base.w}px`;
    img.style.height = `${base.h}px`;
    clip.appendChild(img);
    return img;
  });

  const steps = Math.max(12, Math.round(duration / 14));
  const clipFrames: Keyframe[] = [];
  const imageFrames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const f = frame(from, to, springCurve(offset), base, aspect);
    clipFrames.push({ offset, transform: f.clip, ...(fadeOut ? { opacity: offset < 0.35 ? 1 : 1 - (offset - 0.35) / 0.65 } : null) });
    imageFrames.push({ offset, transform: f.image });
  }
  const first = frame(from, to, 0, base, aspect);
  clip.style.transform = first.clip;
  for (const img of images) img.style.transform = first.image;
  host.appendChild(clip);

  const animations: Animation[] = [];
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    for (const a of animations) a.cancel();
    // Drop the image data with the nodes: an original must not outlive the transition.
    for (const img of images) img.removeAttribute("src");
    clip.remove();
  };

  const timing: KeyframeAnimationOptions = { duration, easing: "linear", fill: "forwards" };
  let finished: Promise<void>;
  if (typeof clip.animate !== "function") {
    const last = frame(from, to, 1, base, aspect);
    clip.style.transform = last.clip;
    for (const img of images) img.style.transform = last.image;
    finished = Promise.resolve();
  } else {
    animations.push(clip.animate(clipFrames, timing));
    images.forEach((img, i) => {
      animations.push(img.animate(imageFrames, timing));
      const opacity = layers[i].opacity;
      if (opacity && opacity.length > 1) {
        animations.push(img.animate(opacity.map((o) => ({ opacity: o })), { duration, easing: "ease-out", fill: "forwards" }));
      }
    });
    finished = Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
  }
  return { finished, remove };
}

/** A rect as a plain object (DOMRect fields are getters). */
export function toRect(r: { left: number; top: number; width: number; height: number }): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The fitted box centred on the stage, moved and scaled like the dismiss/zoom layers. */
export function boxRect(
  box: { w: number; h: number },
  stage: { w: number; h: number },
  transform: { x: number; y: number; s: number } = { x: 0, y: 0, s: 1 }
): Rect {
  const width = box.w * transform.s;
  const height = box.h * transform.s;
  return {
    left: stage.w / 2 + transform.x - width / 2,
    top: stage.h / 2 + transform.y - height / 2,
    width,
    height,
  };
}
