// Copies the on-device face models and the TensorFlow.js WASM binaries from node_modules into
// public/faces/ before `next build` / `next dev` (npm runs this as prebuild/predev), so the
// static export ships them and nothing is ever fetched from a CDN. See docs/FACES.md.
//
//   public/faces/models/  tiny face detector, 68-point landmarks (tiny), 128-d face recognition
//   public/faces/wasm/    tfjs-backend-wasm binaries (plain + SIMD; no threads: needs COOP/COEP)
//
// The copies are build output (gitignored), not sources.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

const MODEL_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];
const WASM_FILES = ["tfjs-backend-wasm.wasm", "tfjs-backend-wasm-simd.wasm"];

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

function readVersion(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
}

function copyAll(fromDir, files, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  let bytes = 0;
  for (const file of files) {
    const from = path.join(fromDir, file);
    const to = path.join(toDir, file);
    if (!fs.existsSync(from)) throw new Error(`missing ${from}`);
    const stat = fs.statSync(from);
    bytes += stat.size;
    // Skip unchanged files so repeated dev starts stay fast.
    if (fs.existsSync(to) && fs.statSync(to).size === stat.size && fs.statSync(to).mtimeMs >= stat.mtimeMs) continue;
    fs.copyFileSync(from, to);
  }
  return bytes;
}

const faceApiDir = packageDir("@vladmandic/face-api");
const wasmDir = packageDir("@tensorflow/tfjs-backend-wasm");

// The WASM binary must match the backend glue code bundled inside face-api exactly.
const bundled = fs.readFileSync(path.join(faceApiDir, "dist", "tfjs.version.js"), "utf8");
const bundledWasm = /"tfjs-backend-wasm":(\w+)/.exec(bundled)?.[1];
const bundledVersion = bundledWasm ? new RegExp(`var ${bundledWasm}="([^"]+)"`).exec(bundled)?.[1] : undefined;
const wasmVersion = readVersion(wasmDir);
if (bundledVersion && bundledVersion !== wasmVersion) {
  throw new Error(
    `@tensorflow/tfjs-backend-wasm is ${wasmVersion} but face-api bundles ${bundledVersion}; pin the same version`
  );
}

const out = path.join(root, "public", "faces");
const modelBytes = copyAll(path.join(faceApiDir, "model"), MODEL_FILES, path.join(out, "models"));
const wasmBytes = copyAll(path.join(wasmDir, "dist"), WASM_FILES, path.join(out, "wasm"));
const mb = (n) => (n / 1048576).toFixed(1);
console.log(
  `face assets: models ${mb(modelBytes)} MB (face-api ${readVersion(faceApiDir)}), wasm ${mb(wasmBytes)} MB (tfjs ${wasmVersion})`
);
