"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";

const EMPTY: ReadonlySet<string> = new Set();

export interface Selection {
  active: boolean;
  selectedIds: ReadonlySet<string>;
  count: number;
  allSelected: boolean;
  /** Enters selection mode, optionally with one item already selected. */
  start: (id?: string) => void;
  toggle: (id: string, extend?: boolean) => void;
  setMany: (ids: readonly string[], selected: boolean) => void;
  selectAll: () => void;
  clear: () => void;
  exit: () => void;
}

/** Multi-select over `items` (in display order). Browser/Android Back exits it. */
export function useSelection(items: readonly MediaIndexEntry[]): Selection {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const anchorRef = useRef<string | null>(null);

  const exit = useCallback(() => {
    setActive(false);
    setSelectedIds(EMPTY);
    anchorRef.current = null;
  }, []);

  useHistoryOverlay(active, exit);

  // Items can vanish underneath a selection (deleted, filtered out, synced away).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(items.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (present.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [items]);

  const start = useCallback((id?: string) => {
    setActive(true);
    setSelectedIds(id ? new Set([id]) : EMPTY);
    anchorRef.current = id ?? null;
  }, []);

  const toggle = useCallback(
    (id: string, extend = false) => {
      const prev = selectedRef.current;
      const anchor = anchorRef.current;
      anchorRef.current = id;
      const next = new Set(prev);
      if (extend && anchor && anchor !== id) {
        const from = items.findIndex((item) => item.id === anchor);
        const to = items.findIndex((item) => item.id === id);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i++) next.add(items[i].id);
          setSelectedIds(next);
          return;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Deselecting the last item leaves selection mode, like Google Photos.
      if (next.size === 0 && prev.size > 0) exit();
      else setSelectedIds(next);
    },
    [items, exit]
  );

  const setMany = useCallback((ids: readonly string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, [items]);

  const clear = useCallback(() => setSelectedIds(EMPTY), []);

  const count = active ? selectedIds.size : 0;
  const allSelected = active && items.length > 0 && selectedIds.size >= items.length;

  return useMemo(
    () => ({ active, selectedIds, count, allSelected, start, toggle, setMany, selectAll, clear, exit }),
    [active, selectedIds, count, allSelected, start, toggle, setMany, selectAll, clear, exit]
  );
}
