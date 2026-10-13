import Link from "next/link";
import StatusScreen, { MissingTileCode, primaryButtonClass } from "./components/ui/StatusScreen";

export default function NotFound() {
  return (
    <StatusScreen
      eyebrow="Error 404 · Page not found"
      title="This page is missing"
      message="Like the empty tile in our logo, there's nothing here. Your photos are safe."
      art={<MissingTileCode />}
    >
      <Link href="/gallery" className={primaryButtonClass}>
        Back to your photos
      </Link>
    </StatusScreen>
  );
}
