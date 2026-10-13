import type { Metadata } from "next";
import FaceRunner from "./FaceRunner";

// The background People runner (lib/faces/runner.ts), exported as runner/faces.html for the
// Android app's headless WebView (docs/FACES.md "Background"). Outside the tab shell: no
// navigation, no scanner of its own, next to no DOM.
export const metadata: Metadata = {
  title: "People runner",
  robots: { index: false, follow: false },
};

export default function FaceRunnerPage() {
  return <FaceRunner />;
}
