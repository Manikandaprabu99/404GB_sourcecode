import { getSession } from "@/lib/session";
import Link from "next/link";
import NavBar from "../components/NavBar";
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

  // Section 11 (Sync Strategy): the media index itself is no longer fetched
  // here on every server render — GalleryClient loads from its IndexedDB
  // cache first and only asks the server for a fresh media-index.json when
  // the repo's HEAD sha has actually moved.
  return (
    <>
      <NavBar repoLabel={`${session.repoOwner}/${session.repoName}`} />
      <GalleryClient repoOwner={session.repoOwner} repoName={session.repoName} />
    </>
  );
}
