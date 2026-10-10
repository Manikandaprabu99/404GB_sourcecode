import { Capacitor } from "@capacitor/core";

/** True inside the 404GB Android app, false in any browser (and during SSR). */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

/** True when the installed app build includes the given native plugin. Older
 * APKs lack newer plugins, so UI should check before offering a feature. */
export function hasNativePlugin(name: string): boolean {
  return isNativeApp() && Capacitor.isPluginAvailable(name);
}
