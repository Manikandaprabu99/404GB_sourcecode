import { getSession } from "@/lib/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import ConnectGitHubButton from "./components/ConnectGitHubButton";
import BrandMark from "./components/ui/BrandMark";

export const dynamic = "force-dynamic";

const SIGN_IN_ERRORS: Record<string, string> = {
  oauth_state: "Sign-in expired or was interrupted. Please try again.",
  access_denied: "GitHub sign-in was cancelled.",
  app_signin_failed: "Couldn't finish signing in to the app. Please try again.",
  session_expired: "Your GitHub sign-in ended. Sign in again to continue — your photos are safe in your repo.",
};

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

export default async function HomePage({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  const errorCode = typeof searchParams.error === "string" ? searchParams.error : null;
  // After the app found the session dead, show sign-in even if a stale cookie survived.
  const isLoggedIn = !!session.accessToken && errorCode !== "session_expired";
  const errorMessage = errorCode
    ? SIGN_IN_ERRORS[errorCode] ?? "Sign-in failed. Please try again."
    : null;

  if (isLoggedIn && session.repoOwner && session.repoName) {
    redirect("/gallery");
  }

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-safe-12 pt-safe-12">
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

      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center animate-fade-in-up">
        <BrandMark className="h-20 w-20 drop-shadow-[0_12px_32px_rgb(99_102_241/0.45)]" />

        <div className="flex flex-col gap-3">
          <h1 className="text-display font-bold tracking-tight">404GB</h1>
          <p className="text-body-lg text-ink-muted">
            Your phone is full. Your repo isn&apos;t.
          </p>
        </div>

        {isLoggedIn ? (
          <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-surface/80 p-6 shadow-soft backdrop-blur">
            <p className="text-body text-ink-muted">
              Signed in as{" "}
              <span className="font-mono text-ink">{session.githubLogin}</span>
            </p>
            <Link
              href="/repos"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-body font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-[0.98]"
            >
              Choose a repo
              <span aria-hidden className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </div>
        ) : (
          <ConnectGitHubButton />
        )}

        {errorMessage && (
          <p role="alert" className="rounded-full bg-danger/10 px-4 py-2 text-small text-danger">
            {errorMessage}
          </p>
        )}

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
          Requests the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">repo</code> scope
          so 404GB can read/write the storage repo you choose. Your GitHub token is stored only in an
          encrypted, httpOnly session cookie — it never touches the browser bundle or IndexedDB.
        </p>
      </div>
    </main>
  );
}
