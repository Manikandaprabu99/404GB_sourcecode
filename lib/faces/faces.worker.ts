// Web Worker: on-device face detection + recognition with @vladmandic/face-api (TensorFlow.js),
// off the main thread. Everything it loads comes from this app's own files (public/faces/,
// copied from node_modules at build time); photos never leave the device. docs/FACES.md.
//
// Pipeline per thumbnail: decode (createImageBitmap) → RGB tensor → tiny face detector at two
// input sizes (512 finds small faces in group shots, 224 finds close-ups the 512 pass misses)
// merged by overlap → 68-point landmarks (tiny) → aligned 150×150 crop → 128-d descriptor.

import * as faceapi from "@vladmandic/face-api";

export {};

interface InitMessage {
  type: "init";
  modelUrl: string;
  wasmUrl: string;
  backends: string[];
  /** False when the page's files are on the device anyway (the background runner). */
  cacheModels?: boolean;
}

interface DetectMessage {
  type: "detect";
  id: number;
  blob: Blob;
}

export interface WorkerFace {
  box: [number, number, number, number];
  score: number;
  descriptor: Float32Array;
}

type Box = { x: number; y: number; width: number; height: number };

// The parts of the bundled TensorFlow.js used here (face-api re-exports the whole library).
interface Tf {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
  getBackend(): string;
  env(): { set(flag: string, value: unknown): void };
  setWasmPaths?(prefix: string, usePlatformFetch?: boolean): void;
  engine(): { reset?(): void };
  browser: { fromPixels(pixels: ImageData): { dispose(): void } };
  memory(): { numTensors: number };
}

const tf = faceapi.tf as unknown as Tf;
const DETECT_SIZES = [512, 224];
const SCORE_THRESHOLD = 0.5;
const MERGE_IOU = 0.3;
/** Faces smaller than this (in thumbnail pixels) give unreliable descriptors. */
const MIN_FACE_PX = 20;
const MAX_FACES = 24;
const MODEL_CACHE = "404gb-faces-models-v1";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | DetectMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  fetch: typeof fetch;
  location: Location;
  caches?: CacheStorage;
};

let backends: string[] = [];
let ready: Promise<string> | null = null;
let cacheModels = true;

/** Model files are local; on a real web host keep a copy so a visit doesn't re-download 6 MB. */
async function modelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const host = scope.location.hostname;
  const cacheable = cacheModels && scope.location.protocol === "https:" && host !== "localhost" && scope.caches;
  if (!cacheable) return scope.fetch(input, init);
  const cache = await scope.caches!.open(MODEL_CACHE);
  const hit = await cache.match(input);
  if (hit) return hit;
  const res = await scope.fetch(input, init);
  if (res.ok) await cache.put(input, res.clone()).catch(() => {});
  return res;
}

/** face-api assumes a page (window, <canvas>); in a worker it gets OffscreenCanvas instead.
 * Inputs are always tensors here, so no DOM image element is ever needed. */
function useWorkerEnv() {
  const unavailable = () => {
    throw new Error("not available in a worker");
  };
  faceapi.env.setEnv({
    Canvas: OffscreenCanvas,
    CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
    Image: ImageBitmap,
    ImageData,
    Video: class {},
    createCanvasElement: () => new OffscreenCanvas(1, 1),
    createImageElement: unavailable,
    createVideoElement: unavailable,
    fetch: modelFetch,
    readFile: unavailable,
  } as unknown as Parameters<typeof faceapi.env.setEnv>[0]);
}

async function useBackend(from: number): Promise<string> {
  for (let i = from; i < backends.length; i++) {
    try {
      if (await tf.setBackend(backends[i])) {
        await tf.ready();
        return tf.getBackend();
      }
    } catch {
      // Try the next one (no WebGL in this worker, WASM blocked, …).
    }
  }
  throw new Error("No TensorFlow.js backend works on this device");
}

async function init(msg: InitMessage): Promise<string> {
  useWorkerEnv();
  backends = msg.backends;
  cacheModels = msg.cacheModels !== false;
  tf.setWasmPaths?.(msg.wasmUrl);
  // Threads need cross-origin isolation, which neither the app nor a static host has.
  tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
  const backend = await useBackend(0);
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(msg.modelUrl),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(msg.modelUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(msg.modelUrl),
  ]);
  return backend;
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}

async function pixelsOf(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("2d context unavailable in worker");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function detect(pixels: ImageData): Promise<WorkerFace[]> {
  const input = tf.browser.fromPixels(pixels) as unknown as Parameters<typeof faceapi.detectAllFaces>[0];
  try {
    const found: faceapi.FaceDetection[] = [];
    for (const inputSize of DETECT_SIZES) {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: SCORE_THRESHOLD });
      for (const d of await faceapi.detectAllFaces(input, options)) {
        if (Math.min(d.box.width, d.box.height) < MIN_FACE_PX) continue;
        if (!found.some((k) => iou(k.box, d.box) > MERGE_IOU)) found.push(d);
      }
    }
    found.sort((a, b) => b.box.area - a.box.area);
    const parents = found.slice(0, MAX_FACES).map((d) => faceapi.extendWithFaceDetection({}, d));
    if (parents.length === 0) return [];
    const results = await new faceapi.DetectAllFaceLandmarksTask(Promise.resolve(parents), input, true).withFaceDescriptors();
    const { width, height } = pixels;
    return results.map((r) => {
      const b = r.detection.box;
      return {
        box: [b.x / width, b.y / height, b.width / width, b.height / height],
        score: r.detection.score,
        // Its own buffer, so it can be transferred.
        descriptor: Float32Array.from(r.descriptor),
      };
    });
  } finally {
    (input as unknown as { dispose(): void }).dispose();
  }
}

function usable(faces: WorkerFace[]): boolean {
  return faces.every((f) => f.descriptor.length === 128 && f.descriptor.every(Number.isFinite));
}

async function detectWithFallback(blob: Blob): Promise<WorkerFace[]> {
  const pixels = await pixelsOf(blob);
  let faces = await detect(pixels);
  // A GPU driver that returns garbage (NaN) gets the next backend, for good.
  for (let i = backends.indexOf(tf.getBackend()) + 1; !usable(faces) && i > 0 && i < backends.length; i++) {
    await useBackend(i);
    faces = await detect(pixels);
  }
  if (!usable(faces)) throw new Error("The face model returned invalid results on this device");
  return faces;
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    ready = init(msg);
    ready.then(
      (backend) => scope.postMessage({ type: "ready", backend }),
      (err: unknown) => scope.postMessage({ type: "init-error", error: err instanceof Error ? err.message : String(err) })
    );
    return;
  }
  if (msg.type === "detect") {
    const { id, blob } = msg;
    (ready ?? Promise.reject(new Error("not initialized")))
      .then(() => detectWithFallback(blob))
      .then(
        (faces) =>
          scope.postMessage(
            { type: "faces", id, faces, backend: tf.getBackend() },
            faces.map((f) => f.descriptor.buffer)
          ),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const decode = err instanceof DOMException || /decode|source image/i.test(message);
          scope.postMessage({ type: "detect-error", id, error: message, decode });
        }
      );
  }
};
