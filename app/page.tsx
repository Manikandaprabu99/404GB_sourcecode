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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">404GB</h1>
      <p className="text-neutral-400">Your phone is full. Your repo isn&apos;t.</p>

      {isLoggedIn ? (
        <div className="flex flex-col items-center gap-3">
          <p>
            Signed in as <span className="font-mono">{session.githubLogin}</span>
          </p>
          <Link
            href="/repos"
            className="rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-900"
          >
            Choose a repo
          </Link>
        </div>
      ) : (
        <a
          href="/api/auth/github/login"
          className="rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-900"
        >
          Connect GitHub
        </a>
      )}
      <p className="max-w-md text-center text-sm text-neutral-500">
        Requests the <code>repo</code> scope so 404GB can read/write the
        storage repo you choose. Your GitHub token is stored only in an
        encrypted, httpOnly session cookie — it never touches the browser
        bundle or IndexedDB.
      </p>
    </main>
  );
}
