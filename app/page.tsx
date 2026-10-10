import { getSession } from "@/lib/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import ConnectGitHubButton from "./components/ConnectGitHubButton";

export const dynamic = "force-dynamic";

const SIGN_IN_ERRORS: Record<string, string> = {
  oauth_state: "Sign-in expired or was interrupted. Please try again.",
  access_denied: "GitHub sign-in was cancelled.",
  app_signin_failed: "Couldn't finish signing in to the app. Please try again.",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  const isLoggedIn = !!session.accessToken;
  const errorCode = typeof searchParams.error === "string" ? searchParams.error : null;
  const errorMessage = errorCode
    ? SIGN_IN_ERRORS[errorCode] ?? "Sign-in failed. Please try again."
    : null;

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
          <ConnectGitHubButton />
        )}

        {errorMessage && (
          <p role="alert" className="text-small text-danger">
            {errorMessage}
          </p>
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
