import { getSession } from "@/lib/session";
import { readMediaIndex } from "@/lib/media";
import Link from "next/link";
import GalleryClient from "./GalleryClient";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return (
      <main className="p-8">
        <p>
          Not connected yet. <Link className="underline" href="/">Go to home</Link>
        </p>
      </main>
    );
  }

  const index = await readMediaIndex(
    session.accessToken,
    session.repoOwner,
    session.repoName
  );

  return <GalleryClient initialItems={index} />;
}
