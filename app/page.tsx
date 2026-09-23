import { getSession } from "@/lib/session";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  const isLoggedIn = !!session.accessToken;

  if (isLoggedIn && session.repoOwner && session.repoName) {
    redirect("/gallery");
  }

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16">
      {/* Ambient background: a few slow-drifting blurred color fields plus a
       * faint fading grid, all pure CSS (see globals.css .bg-blob/.bg-grid-fade)
       * — a lightweight stand-in for a "mesh gradient" hero, no canvas/WebGL. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-fade" />
        <div
          className="bg-blob left-[8%] top-[12%] h-72 w-72 animate-blob bg-accent/40 sm:h-96 sm:w-96"
          style={{ animationDelay: "0s" }}
        />
        <div
          className="bg-blob right-[6%] top-[28%] h-64 w-64 animate-blob bg-[rgb(56_189_248)]/25 sm:h-80 sm:w-80"
          style={{ animationDelay: "-7s" }}
        />
        <div
          className="bg-blob bottom-[6%] left-[28%] h-72 w-72 animate-blob bg-[rgb(232_121_249)]/15 sm:h-96 sm:w-96"
          style={{ animationDelay: "-13s" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-7 text-center animate-fade-in-up">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border-strong bg-surface font-mono text-lg font-semibold shadow-elevated">
          gb
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-display font-bold tracking-tight">404GB</h1>
          <p className="text-body-lg text-ink-muted">
            Your phone is full. Your repo isn&apos;t.
          </p>
        </div>

        {isLoggedIn ? (
          <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-6 shadow-soft">
            <p className="text-body text-ink-muted">
              Signed in as{" "}
              <span className="font-mono text-ink">{session.githubLogin}</span>
            </p>
            <Link
              href="/repos"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-body font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-[0.98]"
            >
              Choose a repo
            </Link>
          </div>
        ) : (
          <a
            href="/api/auth/github/login"
            className="group inline-flex items-center gap-2.5 rounded-full bg-ink px-6 py-3.5 text-body font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-glow-accent active:translate-y-0 active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.26 5.69.42.36.78 1.08.78 2.17 0 1.57-.01 2.83-.01 3.22 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
            </svg>
            <span className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
              Connect GitHub
            </span>
          </a>
        )}

        <p className="max-w-sm text-small text-ink-faint">
          Requests the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">repo</code> scope
          so 404GB can read/write the storage repo you choose. Your GitHub token is stored only in an
          encrypted, httpOnly session cookie — it never touches the browser bundle or IndexedDB.
        </p>
      </div>
    </main>
  );
}
