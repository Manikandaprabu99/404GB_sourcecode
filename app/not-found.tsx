import Link from "next/link";
import StatusScreen, { primaryButtonClass } from "./components/ui/StatusScreen";

export default function NotFound() {
  return (
    <StatusScreen
      eyebrow="404"
      title="This page is missing"
      message="Like the empty tile in our logo, there's nothing here. Your photos are safe."
    >
      <Link href="/gallery" className={primaryButtonClass}>
        Back to your photos
      </Link>
    </StatusScreen>
  );
}
