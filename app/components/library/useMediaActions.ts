"use client";

import { useCallback } from "react";
import { useToast, type ToastHandle } from "@/app/components/ui/Toast";
import { deleteWithUndo, setFavorites, UNDO_WINDOW_MS } from "@/lib/library/mediaStore";
import { ApiError } from "@/lib/library/api";

function itemsLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

/** Library actions with the app's optimistic + toast conventions. */
export function useMediaActions() {
  const toast = useToast();

  const deleteItems = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      let handle: ToastHandle | null = null;
      // Toasts pause while hovered; once the delete is sent, Undo must not linger.
      const pending = deleteWithUndo(ids, { delayMs: UNDO_WINDOW_MS, onCommitStart: () => handle?.dismiss() });
      handle = toast({
        message: `Deleted ${itemsLabel(ids.length)}`,
        actionLabel: "Undo",
        onAction: pending.undo,
        durationMs: UNDO_WINDOW_MS,
      });
      void pending.done.then((outcome) => {
        if (outcome.status !== "failed") return;
        const restored = outcome.restoredIds.length;
        toast({
          tone: "error",
          message:
            outcome.error.kind === "auth"
              ? "You're signed out, so nothing was deleted."
              : outcome.error.kind === "offline"
                ? `You're offline. ${itemsLabel(restored)} restored.`
                : `Couldn't delete ${itemsLabel(restored)}. ${restored === 1 ? "It's" : "They're"} back in your library.`,
        });
      });
    },
    [toast]
  );

  const setFavorite = useCallback(
    async (ids: readonly string[], favorite: boolean): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        await setFavorites(ids, favorite);
        return true;
      } catch (err) {
        toast({
          tone: "error",
          message:
            err instanceof ApiError && err.kind === "offline"
              ? "You're offline. Favorites weren't changed."
              : "Couldn't update favorites. Try again.",
        });
        return false;
      }
    },
    [toast]
  );

  return { deleteItems, setFavorite };
}
