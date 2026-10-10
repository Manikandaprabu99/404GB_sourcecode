"use client";

import { useEffect } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { APP_AUTH_PREFIX, VERIFIER_STORAGE_KEY } from "@/lib/auth/nativeAuth";

let handling = false;

async function handleAppUrl(url: string) {
  if (handling || !url.startsWith(APP_AUTH_PREFIX)) return;
  // No verifier means this app didn't start a sign-in (or already finished it),
  // so a stray or replayed link is ignored.
  const verifier = localStorage.getItem(VERIFIER_STORAGE_KEY);
  if (!verifier) return;
  handling = true;
  localStorage.removeItem(VERIFIER_STORAGE_KEY);

  const params = new URL(url).searchParams;
  const ticket = params.get("ticket");
  if (!ticket) {
    window.location.replace(`/?error=${encodeURIComponent(params.get("error") ?? "oauth_failed")}`);
    return;
  }

  try {
    const res = await fetch("/api/auth/mobile/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, verifier }),
    });
    const data = (await res.json().catch(() => ({}))) as { next?: unknown };
    window.location.replace(
      res.ok && typeof data.next === "string" ? data.next : "/?error=app_signin_failed"
    );
  } catch {
    window.location.replace("/?error=app_signin_failed");
  }
}

/** Finishes GitHub sign-in when Chrome hands the user back to the Android app. */
export default function NativeAuthHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: PluginListenerHandle | undefined;
    let cancelled = false;
    App.addListener("appUrlOpen", (event) => void handleAppUrl(event.url))
      .then((handle) => {
        if (cancelled) void handle.remove();
        else listener = handle;
      })
      .catch(() => {});
    // Cold start: Android may have killed the app while the user was in Chrome.
    App.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) void handleAppUrl(launch.url);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, []);

  return null;
}
