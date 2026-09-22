"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import InstallPrompt from "./InstallPrompt";

const links = [
  { href: "/gallery", label: "Gallery" },
  { href: "/upload", label: "Upload" },
  { href: "/repos", label: "Change repo" },
];

export default function NavBar({ repoLabel }: { repoLabel?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3 sm:px-8">
      <div className="flex items-center gap-4">
        <Link href="/" className="font-bold">
          404GB
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              pathname === l.href
                ? "text-sm font-medium text-neutral-50"
                : "text-sm text-neutral-500 hover:text-neutral-200"
            }
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        {repoLabel && <span className="font-mono">{repoLabel}</span>}
        <InstallPrompt />
        <button onClick={logout} className="hover:text-neutral-200">
          Log out
        </button>
      </div>
    </nav>
  );
}
