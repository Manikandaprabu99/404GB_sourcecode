"use client";

import { useCallback } from "react";
import { useToast, type ToastHandle } from "@/app/components/ui/Toast";
import {
  deleteForever,
  moveToTrashWithUndo,
  restoreFromTrash,
  setFavorites,
  UNDO_WINDOW_MS,
} from "@/lib/library/mediaStore";
import { ApiError } from "@/lib/library/api";

function itemsLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

function failureKind(err: unknown): string | null {
  return err instanceof ApiError ? err.kind : null;
}

/** Library actions with the app's optimistic + toast conventions. */
export function useMediaActions() {
  const toast = useToast();

  /** Moves items to Trash, with Undo while the toast shows. */
  const deleteItems = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      let handle: ToastHandle | null = null;
      // Toasts pause while hovered; once the move is sent, Undo must not linger.
      const pending = moveToTrashWithUndo(ids, { delayMs: UNDO_WINDOW_MS, onCommitStart: () => handle?.dismiss() });
      handle = toast({
        message: `Moved ${itemsLabel(ids.length)} to Trash`,
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
              ? "You're signed out, so nothing was moved to Trash."
              : outcome.error.kind === "offline"
                ? `You're offline. ${itemsLabel(restored)} restored.`
                : `Couldn't move ${itemsLabel(restored)} to Trash. ${restored === 1 ? "It's" : "They're"} back in your library.`,
        });
      });
    },
    [toast]
  );

  const restoreItems = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        await restoreFromTrash(ids);
        toast({ tone: "success", message: `Restored ${itemsLabel(ids.length)}` });
        return true;
      } catch (err) {
        toast({
          tone: "error",
          message:
            failureKind(err) === "offline"
              ? "You're offline. Nothing was restored."
              : `Couldn't restore ${itemsLabel(ids.length)}. Try again.`,
        });
        return false;
      }
    },
    [toast]
  );

  /** Deletes for good (callers confirm first): there is no undo. */
  const deleteItemsForever = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        const gone = await deleteForever(ids);
        toast({ message: `Deleted ${itemsLabel(gone.length || ids.length)} forever` });
        return true;
      } catch (err) {
        toast({
          tone: "error",
          message:
            failureKind(err) === "offline"
              ? "You're offline. Nothing was deleted."
              : failureKind(err) === "auth"
                ? "You're signed out, so nothing was deleted."
                : `Couldn't delete ${itemsLabel(ids.length)}. ${ids.length === 1 ? "It's" : "They're"} still in Trash.`,
        });
        return false;
      }
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

  return { deleteItems, restoreItems, deleteItemsForever, setFavorite };
}
