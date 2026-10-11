// GitHub's Device Flow, for the Android app (docs/STANDALONE.md "Signing in"): no server and
// no client secret. github.com/login/* sends no CORS headers, so these calls go through
// Capacitor's native HTTP (CapacitorHttp), which only works inside the app.

import { CapacitorHttp } from "@capacitor/core";
import { OAUTH_SCOPE } from "@/lib/github";
import { isNativeApp } from "@/lib/native/platform";

/** The OAuth App's client id, baked in at build time; empty hides "Sign in with GitHub". */
export const GITHUB_CLIENT_ID = (process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? "").trim();

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** True when this build can offer "Sign in with GitHub": inside the app, with a client id. */
export function deviceFlowAvailable(): boolean {
  return GITHUB_CLIENT_ID !== "" && isNativeApp();
}

export interface DeviceCode {
  deviceCode: string;
  /** What the user types on GitHub, e.g. "WDJB-MJHT". */
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSec: number;
}

export type DeviceFlowErrorCode = "expired" | "denied" | "disabled" | "network" | "failed";

export class DeviceFlowError extends Error {
  constructor(
    readonly code: DeviceFlowErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

function errorFor(error: string, description?: unknown): DeviceFlowError {
  switch (error) {
    case "expired_token":
      return new DeviceFlowError("expired", "The code expired before it was entered. Get a new one and try again.");
    case "access_denied":
      return new DeviceFlowError("denied", "Sign-in was cancelled on GitHub.");
    case "device_flow_disabled":
      return new DeviceFlowError(
        "disabled",
        "Device sign-in is turned off for this app. Tick “Enable Device Flow” in the GitHub OAuth App's settings, or use a personal access token instead."
      );
    default:
      return new DeviceFlowError(
        "failed",
        typeof description === "string" && description ? description : "GitHub couldn't finish signing in. Try again."
      );
  }
}

async function post(url: string, data: Record<string, string>): Promise<Record<string, unknown>> {
  let res: { status: number; data: unknown };
  try {
    res = await CapacitorHttp.post({
      url,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      data,
    });
  } catch {
    throw new DeviceFlowError("network", "Couldn't reach GitHub. Check your connection and try again.");
  }
  let body = res.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object") throw new DeviceFlowError("failed", `GitHub answered ${res.status}. Try again.`);
  return body as Record<string, unknown>;
}

/** Step 1: a code for the user to enter at `verificationUri`. */
export async function requestDeviceCode(): Promise<DeviceCode> {
  const body = await post(DEVICE_CODE_URL, { client_id: GITHUB_CLIENT_ID, scope: OAUTH_SCOPE });
  if (typeof body.error === "string") throw errorFor(body.error, body.error_description);
  const { device_code, user_code, verification_uri, expires_in, interval } = body;
  if (typeof device_code !== "string" || typeof user_code !== "string" || typeof verification_uri !== "string") {
    throw new DeviceFlowError("failed", "GitHub didn't send a sign-in code. Try again.");
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresAt: Date.now() + (Number(expires_in) || 900) * 1000,
    intervalSec: Math.max(1, Number(interval) || 5),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Step 2: polls every `interval` seconds until the user approves; resolves with the token. */
export async function pollForToken(code: DeviceCode, signal: AbortSignal): Promise<string> {
  let interval = code.intervalSec;
  for (;;) {
    await sleep(interval * 1000, signal);
    if (Date.now() > code.expiresAt) throw errorFor("expired_token");
    let body: Record<string, unknown>;
    try {
      body = await post(ACCESS_TOKEN_URL, {
        client_id: GITHUB_CLIENT_ID,
        device_code: code.deviceCode,
        grant_type: GRANT_TYPE,
      });
    } catch (err) {
      // A dropped connection while the user is in the browser: keep waiting.
      if (err instanceof DeviceFlowError && err.code === "network") continue;
      throw err;
    }
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (typeof body.access_token === "string" && body.access_token) return body.access_token;
    const error = typeof body.error === "string" ? body.error : "";
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    throw errorFor(error, body.error_description);
  }
}
