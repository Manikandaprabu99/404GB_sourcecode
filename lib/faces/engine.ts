// Main-thread handle on the face model worker (faces.worker.ts). The worker — and with it
// face-api and TensorFlow.js — is only created when there is something to scan, so none of
// it is in the main bundle.

import type { FaceBox } from "./people";

export interface DetectedFace {
  box: FaceBox;
  score: number;
  descriptor: ArrayLike<number>;
}

export interface FaceEngine {
  /** "webgl", "wasm", "cpu", or "stub" in tests. */
  readonly backend: string;
  detect(mediaId: string, blob: Blob): Promise<DetectedFace[]>;
  dispose(): void;
}

/** The thumbnail couldn't be decoded: skip the item instead of retrying it forever. */
export class FaceDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceDecodeError";
  }
}

/** The model can't run here (no worker support, no backend, model files missing). */
export class FaceEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceEngineUnavailableError";
  }
}

/** One photo took longer than `detectTimeoutMs`: the backend may be stuck rather than the photo bad. */
export class FaceDetectTimeoutError extends Error {
  constructor() {
    super("Face detection timed out");
    this.name = "FaceDetectTimeoutError";
  }
}

export interface FaceEngineOptions {
  /** TensorFlow.js backends to try, in order (default WebGL, WebAssembly, CPU). */
  backends?: readonly string[];
  /** How long the model may take to load (default 90 s). */
  initTimeoutMs?: number;
  /** How long one photo may take (default 120 s). */
  detectTimeoutMs?: number;
  /** Keep the model files in Cache Storage on a web host (default true; pages that serve
   * them from the device, like the background runner, needn't). */
  cacheModels?: boolean;
}

/** Test seam: an end-to-end test can replace the model with a deterministic detector. */
export type StubFaceDetector = (input: {
  mediaId: string;
  blob: Blob;
}) => Promise<Array<{ box: number[]; score?: number; descriptor: ArrayLike<number> }>>;

declare global {
  interface Window {
    __404GB_FACE_DETECTOR__?: StubFaceDetector;
  }
}

const BACKENDS = ["webgl", "wasm", "cpu"];
const INIT_TIMEOUT_MS = 90_000;
const DETECT_TIMEOUT_MS = 120_000;

function stubEngine(stub: StubFaceDetector): FaceEngine {
  return {
    backend: "stub",
    async detect(mediaId, blob) {
      const faces = await stub({ mediaId, blob });
      return faces.map((f) => ({
        box: [f.box[0], f.box[1], f.box[2], f.box[3]] as FaceBox,
        score: f.score ?? 0.9,
        descriptor: f.descriptor,
      }));
    },
    dispose() {},
  };
}

type WorkerReply =
  | { type: "ready"; backend: string }
  | { type: "init-error"; error: string }
  | { type: "faces"; id: number; faces: DetectedFace[]; backend: string }
  | { type: "detect-error"; id: number; error: string; decode: boolean };

export async function createFaceEngine(options: FaceEngineOptions = {}): Promise<FaceEngine> {
  const stub = typeof window !== "undefined" ? window.__404GB_FACE_DETECTOR__ : undefined;
  if (typeof stub === "function") return stubEngine(stub);
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    throw new FaceEngineUnavailableError("This browser can't run face grouping in the background.");
  }
  const initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS;
  const detectTimeoutMs = options.detectTimeoutMs ?? DETECT_TIMEOUT_MS;

  const worker = new Worker(new URL("./faces.worker.ts", import.meta.url));
  const waiting = new Map<number, { resolve(faces: DetectedFace[]): void; reject(err: Error): void; timer: number }>();
  let nextId = 1;
  let backend = "";
  let dead: Error | null = null;

  const fail = (err: Error) => {
    dead = err;
    for (const entry of waiting.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(err);
    }
    waiting.clear();
  };

  const ready = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new FaceEngineUnavailableError("The face model took too long to load.")),
      initTimeoutMs
    );
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === "ready") {
        window.clearTimeout(timer);
        backend = reply.backend;
        resolve(reply.backend);
      } else if (reply.type === "init-error") {
        window.clearTimeout(timer);
        reject(new FaceEngineUnavailableError(reply.error));
      } else if (reply.type === "faces" || reply.type === "detect-error") {
        const entry = waiting.get(reply.id);
        if (!entry) return;
        waiting.delete(reply.id);
        window.clearTimeout(entry.timer);
        if (reply.type === "faces") {
          backend = reply.backend;
          entry.resolve(reply.faces);
        } else {
          entry.reject(reply.decode ? new FaceDecodeError(reply.error) : new Error(reply.error));
        }
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const err = new FaceEngineUnavailableError(event.message || "The face model worker stopped.");
      window.clearTimeout(timer);
      reject(err);
      fail(err);
    };
  });

  worker.postMessage({
    type: "init",
    modelUrl: new URL("/faces/models/", window.location.href).href,
    wasmUrl: new URL("/faces/wasm/", window.location.href).href,
    backends: options.backends ? [...options.backends] : BACKENDS,
    cacheModels: options.cacheModels !== false,
  });

  try {
    await ready;
  } catch (err) {
    worker.terminate();
    throw err;
  }

  return {
    get backend() {
      return backend;
    },
    detect(_mediaId, blob) {
      if (dead) return Promise.reject(dead);
      return new Promise<DetectedFace[]>((resolve, reject) => {
        const id = nextId++;
        const timer = window.setTimeout(() => {
          waiting.delete(id);
          reject(new FaceDetectTimeoutError());
        }, detectTimeoutMs);
        waiting.set(id, { resolve, reject, timer });
        worker.postMessage({ type: "detect", id, blob });
      });
    },
    dispose() {
      fail(new Error("disposed"));
      worker.terminate();
    },
  };
}
