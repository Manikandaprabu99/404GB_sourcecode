"use client";

import { useEffect, useRef } from "react";

/**
 * Makes an open overlay (photo viewer, editor, sheet) a browser history entry,
 * so the browser's Back button — and Android's back button inside the app,
 * which goes back in WebView history — closes the overlay instead of leaving
 * the page. Nested overlays close one at a time, top first.
 */
export function useHistoryOverlay(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const marker = Math.random().toString(36).slice(2);
    window.history.pushState({ ...window.history.state, __overlay: marker }, "");

    let closedByBack = false;
    const onPopState = () => {
      if (window.history.state?.__overlay === marker) return; // a nested overlay closed
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // Closed from the UI rather than Back: remove the entry this overlay added.
      if (!closedByBack && window.history.state?.__overlay === marker) window.history.back();
    };
  }, [open]);
}
