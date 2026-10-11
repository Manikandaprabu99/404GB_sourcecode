"use client";

import { useRequiredSession } from "@/app/components/useRequiredSession";
import UploadClient from "./UploadClient";

export default function UploadPage() {
  const session = useRequiredSession(true);
  if (!session) return null;
  return <UploadClient />;
}
