// The background People runner page (runner/faces.html) the Android app opens headlessly with the
// app closed; host contract in ./runnerHost and docs/FACES.md "Background".

import { disableTrashCleanup, ensureLibrary, syncLibrary } from "@/lib/library/mediaStore";
import type { BackupAuth } from "@/lib/native/backup";
import { adoptHostSession } from "@/lib/session";
import type { FaceRunnerHost } from "./runnerHost";
import { NETWORK_BUDGET_PER_HOUR, runBackgroundScan } from "./scanner";

/** When the host gives no usable deadline (a plain Android job is stopped after 10 minutes). */
const DEFAULT_RUN_MS = 9 * 60_000;
/** A deadline further out than this is taken as this. */
const MAX_RUN_MS = 30 * 60_000;
const MAX_REASON_LENGTH = 300;
const NOT_SIGNED_IN = "Sign in to 404GB and choose your library to find people in the background.";

interface RunnerConfig {
  budgetPerHour: number;
  deadlineMs: number;
  localThumbnails: boolean;
}

let started = false;

function parse(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readAuth(host: FaceRunnerHost): BackupAuth | null {
  const raw = parse(host.getAuth());
  if (!raw) return null;
  const auth = { token: text(raw.token), login: text(raw.login), owner: text(raw.owner), repo: text(raw.repo), branch: text(raw.branch) };
  return auth.token && auth.owner && auth.repo ? auth : null;
}

function readConfig(host: FaceRunnerHost): RunnerConfig {
  const raw = parse(host.config()) ?? {};
  const now = Date.now();
  const budget = Number(raw.budgetPerHour);
  const deadline = Number(raw.deadlineMs);
  return {
    budgetPerHour: Number.isFinite(budget) && budget >= 0 ? Math.floor(budget) : NETWORK_BUDGET_PER_HOUR,
    // A deadline already past just means: save and finish.
    deadlineMs: Number.isFinite(deadline) && deadline > 0 ? Math.min(deadline, now + MAX_RUN_MS) : now + DEFAULT_RUN_MS,
    localThumbnails: raw.localThumbnails === true,
  };
}

/** Calls the host, which may be gone already (the run is over then anyway). */
function tell(call: () => void): void {
  try {
    call();
  } catch {
    // Nothing to do about it here.
  }
}

async function run(host: FaceRunnerHost, signal: AbortSignal): Promise<void> {
  let checked = 0;
  let reason: string;
  const extra: { left?: number; resumeAt?: number } = {};
  try {
    const auth = readAuth(host);
    const config = readConfig(host);
    if (!auth) {
      reason = NOT_SIGNED_IN;
    } else {
      // In memory only: this page never stores the session anywhere.
      adoptHostSession(auth);
      disableTrashCleanup();
      const repoKey = `${auth.owner}/${auth.repo}`;
      ensureLibrary(repoKey);
      void syncLibrary();
      const result = await runBackgroundScan(repoKey, {
        budgetPerHour: config.budgetPerHour,
        deadlineAt: config.deadlineMs,
        localThumbnails: config.localThumbnails,
        signal,
        onProgress: (done, total) => tell(() => host.progress(JSON.stringify({ checked: done, total }))),
      });
      checked = result.checked;
      reason = result.reason;
      // The host chains a follow-up run on "deadline" while photos are left, not before resumeAt.
      if (result.left !== null) extra.left = result.left;
      if (result.resumeAt !== null) extra.resumeAt = result.resumeAt;
    }
  } catch (err) {
    reason = `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
  }
  tell(() => host.finished(JSON.stringify({ checked, reason: reason.slice(0, MAX_REASON_LENGTH), ...extra })));
}

/** Starts the run (once per page), with the host's stop hook in place before the first call. */
export function startFaceRunner(host: FaceRunnerHost): void {
  if (started) return;
  started = true;
  const stop = new AbortController();
  window.__404gbStopRunner = () => stop.abort();
  void run(host, stop.signal);
}
