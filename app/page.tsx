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
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pb-safe-10 pt-safe-12 sm:px-6">
      {/* Full-screen aurora: static gradients, no blur filter. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-12%] h-[44rem] w-[44rem] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(var(--glow)/0.28),transparent)] lg:left-[30%]" />
        <div className="absolute right-[-20%] top-[20%] h-[30rem] w-[30rem] bg-[radial-gradient(closest-side,rgb(var(--accent-2)/0.14),transparent)]" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[30rem] w-[30rem] bg-[radial-gradient(closest-side,rgb(var(--glow)/0.12),transparent)]" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-8 lg:max-w-5xl lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <div className="flex flex-col items-center gap-6 text-center animate-fade-in-up lg:max-w-md lg:items-start lg:text-left">
          <BrandMark className="h-[88px] w-[88px] drop-shadow-[0_18px_40px_rgb(22_96_235/0.45)]" />

          <div className="flex flex-col gap-2.5">
            <p className="text-headline text-accent-text">404GB</p>
            <h1 className="text-[2.25rem] font-bold leading-[2.625rem] tracking-[-0.03em] text-ink lg:text-[3.25rem] lg:leading-[3.5rem]">
              Your photos. Your GitHub.
            </h1>
            <p className="text-body-lg text-ink-muted">Back up every photo to a private repo you own, in full quality.</p>
          </div>

          <ul className="hidden w-full flex-col gap-3 lg:flex">
            {FEATURES.map((feature, i) => (
              <Feature key={feature.title} {...feature} delay={160 + i * 70} />
            ))}
          </ul>
        </div>

        <div className="flex w-full flex-col items-center gap-6 lg:max-w-md">
          {session.ended && (
            <p
              role="alert"
              className="w-full rounded-control bg-danger/10 px-4 py-3 text-center text-callout font-normal text-ink animate-fade-in dark:text-danger"
            >
              Your GitHub sign-in ended. Sign in again to continue — your photos are safe in your repo.
            </p>
          )}

          <SignInPanel lastLogin={session.login} />

          <ul className="flex w-full flex-col gap-2.5 lg:hidden">
            {FEATURES.map((feature, i) => (
              <Feature key={feature.title} {...feature} delay={120 + i * 70} />
            ))}
          </ul>

          <p className="max-w-sm text-center text-footnote text-ink-muted lg:max-w-none lg:text-left">
            404GB needs the <code className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-mono text-[0.8125em] text-ink">repo</code>{" "}
            scope to read and write the storage repo you choose. Your token stays on this device and is only ever sent to
            GitHub.
          </p>
        </div>
      </div>
    </main>
  );
}

function Feature({ title, body, icon, delay }: { title: string; body: string; icon: string; delay: number }) {
  return (
    <li className="flex items-start gap-3.5 text-left animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-footnote text-ink-muted">{body}</span>
      </span>
    </li>
  );
}
