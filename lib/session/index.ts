// The GitHub session { token, login, owner, repo, branch } (docs/STANDALONE.md). In the
// Android app the native Backup plugin stores it (setAuth/getAuth/clearAuth), so the
// background worker uses the same token; in a browser it lives in localStorage. Either way
// a complete session is mirrored for the service worker (./authMirror).
//
// A 401 from GitHub ends the sign-in: the token is dropped but the account and repo are
// kept, so signing in again returns to the same library. The dead token's fingerprint is
// remembered, so a copy that survives somewhere can't bring the ended sign-in back.
//
// A page can instead be handed its session by its host (adoptHostSession: the Android app's
// background People runner, docs/FACES.md "Background"). That session is read-only: it lives
// in the page's memory and nothing about it is ever stored.

import { applyBackupStatus } from "@/lib/library/backupStore";
import { sha256HexOf, utf8Bytes } from "@/lib/github/bytes";
import { setUnauthorizedListener } from "@/lib/github/client";
import { Backup, type BackupAuth, type BackupStatus } from "@/lib/native/backup";
import { hasNativePlugin } from "@/lib/native/platform";
import { mirrorAuth } from "./authMirror";

export interface Session {
  /** "loading" until the stored session has been read (a native call in the app). */
  status: "loading" | "ready";
  token: string | null;
  login: string | null;
  owner: string | null;
  repo: string | null;
  branch: string | null;
  /** GitHub ended the last sign-in; the sign-in screen says so until the next sign-in. */
  ended: boolean;
}

interface StoredSession {
  /** In the app only while no repo is chosen yet (the native store needs the full session). */
  token?: string;
  login?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  ended?: boolean;
}

const STORAGE_KEY = "404gb-session";
const DEAD_TOKEN_KEY = "404gb-ended-token";
const NATIVE_TIMEOUT_MS = 5000;

const LOADING: Session = {
  status: "loading",
  token: null,
  login: null,
  owner: null,
  repo: null,
  branch: null,
  ended: false,
};

let snapshot: Session = LOADING;
/** True when the native Backup plugin is the source of truth. */
let native = false;
/** True when the page's host handed the session over (adoptHostSession): nothing is persisted. */
let hosted = false;
let loading: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const changeListeners = new Set<() => void>();

function emit(next: Session) {
  const changed =
    next.token !== snapshot.token || next.owner !== snapshot.owner || next.repo !== snapshot.repo;
  snapshot = next;
  for (const listener of listeners) listener();
  if (changed && next.token) for (const listener of changeListeners) listener();
}

/** Called when a token or library is taken into use (a sign-in, another repo). */
export function onSessionChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSession(): Session {
  return snapshot;
}

export function getServerSession(): Session {
  return LOADING;
}

/** "owner/repo" of the selected library, or null. */
export function currentRepoKey(session: Session = snapshot): string | null {
  return session.owner && session.repo ? `${session.owner}/${session.repo}` : null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readStored(): StoredSession {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as StoredSession) : {};
  } catch {
    return {};
  }
}

function writeStored(value: StoredSession): void {
  try {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "");
    if (entries.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage disabled: the session lasts as long as the page.
  }
}

function fingerprint(token: string): Promise<string> {
  return sha256HexOf(utf8Bytes(`404gb:${token}`)).then((hex) => hex.slice(0, 32));
}

async function isEndedToken(token: string): Promise<boolean> {
  try {
    const dead = window.localStorage.getItem(DEAD_TOKEN_KEY);
    return dead !== null && dead === (await fingerprint(token));
  } catch {
    return false;
  }
}

function rememberEndedToken(token: string): void {
  void fingerprint(token).then((value) => {
    try {
      window.localStorage.setItem(DEAD_TOKEN_KEY, value);
    } catch {
      // Without storage the in-memory session still has no token.
    }
  });
}

function onNativeStatus(status: BackupStatus | null | undefined): void {
  if (status && typeof status === "object" && "state" in status) applyBackupStatus(status);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function completeAuth(session: Session) {
  const { token, login, owner, repo, branch } = session;
  return token && login && owner && repo && branch ? { token, login, owner, repo, branch } : null;
}

/** Writes the current session where it belongs; serialized so writes land in order. */
function persist(): Promise<void> {
  // A host's session is the host's to keep: not in localStorage, the plugin or the mirror.
  if (hosted) return Promise.resolve();
  const session = snapshot;
  const run = async () => {
    const complete = completeAuth(session);
    const kept: StoredSession = {
      login: session.login ?? undefined,
      owner: session.owner ?? undefined,
      repo: session.repo ?? undefined,
      branch: session.branch ?? undefined,
      ended: session.ended || undefined,
    };
    if (!native) {
      writeStored({ ...kept, token: session.token ?? undefined });
    } else if (complete) {
      try {
        onNativeStatus(await Backup.setAuth(complete));
        writeStored(kept);
      } catch {
        // Keep the token here rather than lose it; the next start offers it to the plugin again.
        writeStored({ ...kept, token: complete.token });
      }
    } else {
      // The worker must never keep using a token or repo this page no longer has.
      writeStored({ ...kept, token: session.token ?? undefined });
      try {
        onNativeStatus(await Backup.clearAuth());
      } catch {
        // Older builds: nothing stored natively to clear.
      }
    }
    await mirrorAuth(complete);
  };
  persistChain = persistChain.then(run, run);
  return persistChain;
}

async function load(): Promise<void> {
  if (hosted) return;
  const stored = readStored();
  let next: Session = {
    status: "ready",
    token: nonEmpty(stored.token),
    login: nonEmpty(stored.login),
    owner: nonEmpty(stored.owner),
    repo: nonEmpty(stored.repo),
    branch: nonEmpty(stored.branch),
    ended: stored.ended === true,
  };
  let nativeHadAuth = false;

  if (hasNativePlugin("Backup")) {
    try {
      const { auth } = await withTimeout(Backup.getAuth(), NATIVE_TIMEOUT_MS);
      native = true;
      if (auth && nonEmpty(auth.token)) {
        nativeHadAuth = true;
        next = {
          ...next,
          token: auth.token,
          login: nonEmpty(auth.login) ?? next.login,
          owner: nonEmpty(auth.owner),
          repo: nonEmpty(auth.repo),
          branch: nonEmpty(auth.branch),
          ended: false,
        };
      }
    } catch {
      // An app build without getAuth: keep the session in localStorage like a browser.
      native = false;
    }
  }

  if (next.token && (await isEndedToken(next.token))) {
    next = { ...next, token: null, ended: true };
  }
  // The host handed a session over while this read was going: that one stands.
  if (hosted) return;
  emit(next);
  // Native storage disagrees with what the page holds (a dead copy, or a session saved before
  // the plugin could store it): bring it in line.
  const complete = completeAuth(next);
  if (native && ((nativeHadAuth && !next.token) || (!nativeHadAuth && complete))) await persist();
  else await mirrorAuth(complete);
}

/** Reads the stored session once per page (later calls share the first). */
export function loadSession(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!loading) {
    loading = load().catch(() => {
      emit({ ...LOADING, status: "ready" });
    });
    window.addEventListener("storage", (event) => {
      // Another tab signed in, out or switched repos.
      if (native || hosted || event.key !== STORAGE_KEY) return;
      const stored = readStored();
      emit({
        status: "ready",
        token: nonEmpty(stored.token),
        login: nonEmpty(stored.login),
        owner: nonEmpty(stored.owner),
        repo: nonEmpty(stored.repo),
        branch: nonEmpty(stored.branch),
        ended: stored.ended === true,
      });
    });
  }
  return loading;
}

/**
 * Uses the session the page's host hands over instead of a stored one: the Android app's
 * background People runner (lib/faces/runner.ts). It stays in this page's memory only —
 * never written to localStorage, the native plugin or the service worker's mirror — and this
 * page can't change it (a 401 only ends it here; the host learns why from the run's result).
 */
export function adoptHostSession(auth: BackupAuth): void {
  if (typeof window === "undefined") return;
  hosted = true;
  native = false;
  loading = Promise.resolve();
  emit({
    status: "ready",
    token: auth.token,
    login: nonEmpty(auth.login),
    owner: auth.owner,
    repo: auth.repo,
    // "" = the repo's default branch, looked up on first use (withRepo).
    branch: nonEmpty(auth.branch),
    ended: false,
  });
}

function assertOwnSession(): void {
  if (hosted) throw new Error("This page's GitHub session belongs to the app");
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** Signs in with a validated token. The same account gets its library back; another starts without one. */
export async function signIn(token: string, login: string): Promise<void> {
  assertOwnSession();
  await loadSession();
  const sameAccount = snapshot.login === login;
  try {
    window.localStorage.removeItem(DEAD_TOKEN_KEY);
  } catch {
    // Storage disabled.
  }
  emit({
    status: "ready",
    token,
    login,
    owner: sameAccount ? snapshot.owner : null,
    repo: sameAccount ? snapshot.repo : null,
    branch: sameAccount ? snapshot.branch : null,
    ended: false,
  });
  await persist();
}

/** Makes `owner/repo` the library (in the app, the phone backs up into it from now on). */
export async function selectRepo(owner: string, repo: string, branch: string): Promise<void> {
  assertOwnSession();
  if (!snapshot.token) throw new Error("Sign in first");
  emit({ ...snapshot, owner, repo, branch });
  await persist();
}

/** Records the library's default branch when it had to be looked up. */
export function setBranch(branch: string): void {
  if (!snapshot.token || snapshot.branch === branch) return;
  emit({ ...snapshot, branch });
  void persist();
}

/** GitHub rejected `token` (401): drops it, keeping the account and repo. Ignores tokens no longer in use. */
export function endSession(token: string): void {
  if (!snapshot.token || snapshot.token !== token) return;
  if (!hosted) rememberEndedToken(token);
  emit({ ...snapshot, token: null, ended: true });
  void persist();
}

/** Forgets the token (and in the app the native copy) but keeps the account and repo for signing back in. */
export function dropToken(): void {
  if (snapshot.token) endSession(snapshot.token);
}

/** Signs this device out completely: token, account and repo choice. */
export async function signOut(): Promise<void> {
  assertOwnSession();
  emit({ ...LOADING, status: "ready" });
  try {
    window.localStorage.removeItem(DEAD_TOKEN_KEY);
  } catch {
    // Storage disabled.
  }
  await persist();
}

setUnauthorizedListener((token) => endSession(token));
