"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session/useSession";
import SignInPanel from "./components/auth/SignInPanel";
import BrandMark from "./components/ui/BrandMark";
import Splash from "./components/ui/Splash";

const FEATURES = [
  {
    title: "Original quality",
    body: "Photos and videos are kept exactly as you took them.",
    icon: "M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Zm4 9 3-3.5 2.5 2.5L16 12l2 2.5M9 9.5h.01",
  },
  {
    title: "Automatic backup",
    body: "The Android app saves new photos in the background.",
    icon: "M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 10a4 4 0 0 1-1 7.87M12 12v8m0-8-3 3m3-3 3 3",
  },
  {
    title: "Yours to keep",
    body: "Everything lives in a private GitHub repo you own.",
    icon: "M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Zm-2.5 9 1.8 1.8L15 10",
  },
];

// Screens a signed-in session can land on directly. The app's local server answers every
// path with this page, so a full load of /albums/view?id=… shows the home screen first.
const APP_ROUTES = new Set([
  "/gallery",
  "/albums",
  "/albums/view",
  "/albums/category",
  "/albums/trash",
  "/people",
  "/people/view",
  "/upload",
  "/settings",
  "/repos",
]);

function destination(hasRepo: boolean): string {
  if (!hasRepo) return "/repos";
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return APP_ROUTES.has(path) ? `${path}${window.location.search}` : "/gallery";
}

/** Home: the sign-in screen, or (once a session has loaded) a hop onward to the library. */
export default function HomePage() {
  const session = useSession();
  const router = useRouter();
  const signedIn = session.status === "ready" && Boolean(session.token);
  const hasRepo = Boolean(session.owner && session.repo);

  useEffect(() => {
    if (!signedIn) return;
    const target = destination(hasRepo);
    // This page was served for the deeper path itself: the router has it cached as this
    // page, so load the real screen in place instead of "navigating" to where it already is.
    if (target !== "/" && target === `${window.location.pathname}${window.location.search}`) router.refresh();
    else router.replace(target);
  }, [signedIn, hasRepo, router]);

  if (session.status !== "ready" || signedIn) return <Splash />;

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 pb-safe-12 pt-safe-12 sm:px-6">
      {/* Ambient background: slow-drifting blurred color fields over a faint
       * fading grid, all pure CSS (globals.css .bg-blob / .bg-grid-fade). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-fade" />
        <div
          className="bg-blob left-[6%] top-[10%] h-72 w-72 animate-blob bg-accent/40 sm:h-96 sm:w-96"
          style={{ animationDelay: "0s" }}
        />
        <div
          className="bg-blob right-[4%] top-[30%] h-64 w-64 animate-blob bg-glow-sky/30 sm:h-80 sm:w-80"
          style={{ animationDelay: "-7s" }}
        />
        <div
          className="bg-blob bottom-[10%] left-[22%] h-72 w-72 animate-blob bg-glow-fuchsia/25 sm:h-96 sm:w-96"
          style={{ animationDelay: "-13s" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/10 to-bg/70" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-7 text-center animate-fade-in-up">
        <BrandMark className="h-20 w-20 drop-shadow-[0_12px_32px_rgb(99_102_241/0.45)]" />

        <div className="flex flex-col gap-3">
          <h1 className="text-display font-bold tracking-tight">404GB</h1>
          <p className="text-body-lg text-ink-muted">Your phone is full. Your repo isn&apos;t.</p>
        </div>

        {session.ended && (
          <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-2.5 text-small text-danger animate-fade-in">
            Your GitHub sign-in ended. Sign in again to continue — your photos are safe in your repo.
          </p>
        )}

        <SignInPanel lastLogin={session.login} />

        <ul className="grid w-full gap-3 text-left sm:grid-cols-3 sm:gap-4">
          {FEATURES.map((feature, i) => (
            <li
              key={feature.title}
              className="flex items-start gap-3 rounded-xl border border-border/70 bg-surface/60 p-3.5 backdrop-blur animate-fade-in-up sm:flex-col sm:gap-2"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={feature.icon} />
                </svg>
              </span>
              <span>
                <span className="block text-small font-semibold text-ink">{feature.title}</span>
                <span className="mt-0.5 block text-small text-ink-muted">{feature.body}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="max-w-sm text-small text-ink-faint">
          404GB needs the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">repo</code> scope to read
          and write the storage repo you choose. Your token stays on this device and is only ever sent to GitHub.
        </p>
      </div>
    </main>
  );
}
