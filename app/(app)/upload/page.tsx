import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import UploadClient from "./UploadClient";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const session = await getSession();
  if (!session.accessToken) redirect("/");
  if (!session.repoOwner || !session.repoName) redirect("/repos");
  return <UploadClient />;
}
