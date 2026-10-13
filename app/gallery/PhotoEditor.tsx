"use client";

// Full-screen photo editor: filters, adjustments, crop/rotate/flip. Saves an edited
// copy through the upload queue; the original is never modified.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MediaIndexEntry } from "@/lib/media";
import { buttonClass } from "@/app/components/ui/Button";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { TileGlyph } from "@/app/components/ui/StatusBadge";
import TileMeter from "@/app/components/ui/TileMeter";
import { useToast } from "@/app/components/ui/Toast";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { aspectRatio, fitCropToAspect, flipEdit, rotateEdit, transformedSize } from "@/lib/editor/geometry";
import { planExport } from "@/lib/editor/plan";
import {
  createEditState,
  FULL_CROP,
  hasColorEdits,
  hasGeometryEdits,
  isEdited,
  NEUTRAL_ADJUSTMENTS,
  type AdjustmentId,
  type AspectId,
  type CropRect,
  type EditState,
  type FilterId,
} from "@/lib/editor/types";
import type { ExportRequest } from "@/lib/editor/exportImage";
import AdjustPanel from "./editor/AdjustPanel";
import CropPanel from "./editor/CropPanel";
import EditorStage, { type StageAnimation } from "./editor/EditorStage";
import FiltersPanel from "./editor/FiltersPanel";
import { AdjustIcon, AlertIcon, CheckIcon, CloseIcon, CompareIcon, CropIcon, FiltersIcon, SpinnerIcon } from "./editor/icons";
import { useEditorSource } from "./editor/useEditorSource";
import { useSaveCopy } from "./editor/useSaveCopy";

export interface PhotoEditorProps {
  media: MediaIndexEntry;
  onClose: () => void;
  /** Called after the edited copy is saved; null if it was already in the library. */
  onSaved: (newMediaId: string | null) => void;
}

export { canEdit } from "@/lib/editor/canEdit";

type Tab = "filters" | "adjust" | "crop";

const TABS: { id: Tab; label: string; Icon: typeof FiltersIcon }[] = [
  { id: "filters", label: "Filters", Icon: FiltersIcon },
  { id: "adjust", label: "Adjust", Icon: AdjustIcon },
  { id: "crop", label: "Crop", Icon: CropIcon },
];

const CLOSE_ANIMATION_MS = 180;

// The editor is always dark (like a darkroom), whatever the app theme: the dark ("Ink") token
// values from globals.css.
const DARK_TOKENS = {
  "--bg": "10 10 11",
  "--surface": "18 18 20",
  "--surface-2": "26 26 29",
  "--surface-3": "35 35 39",
  "--border": "42 42 47",
  "--border-strong": "61 61 68",
  "--ink": "242 242 238",
  "--ink-muted": "161 161 168",
  "--ink-faint": "109 109 117",
  "--signal": "200 245 66",
  "--signal-ink": "14 20 0",
  "--accent": "200 245 66",
  "--accent-strong": "172 222 38",
  "--accent-ink": "14 20 0",
  "--accent-inverse": "74 112 0",
  "--accent-2": "139 124 255",
  "--success": "74 222 128",
  "--warning": "255 181 71",
  "--danger": "255 90 110",
  "--danger-ink": "30 6 10",
  colorScheme: "dark",
  paddingLeft: "var(--safe-area-inset-left, env(safe-area-inset-left, 0px))",
  paddingRight: "var(--safe-area-inset-right, env(safe-area-inset-right, 0px))",
} as CSSProperties;

/** A round 44px icon button (docs/DESIGN.md › Viewer / editor chrome). */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-180 ease-out-expo hover:bg-ink/10 active:scale-[0.94] active:bg-ink/15"
    >
      {children}
    </button>
  );
}

export default function PhotoEditor({ media, onClose, onSaved }: PhotoEditorProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const source = useEditorSource(media);
  const saver = useSaveCopy(media, onSaved);

  const [edit, setEdit] = useState<EditState>(createEditState);
  const [tab, setTab] = useState<Tab>("filters");
  const [activeAdjustment, setActiveAdjustment] = useState<AdjustmentId>("brightness");
  const [interacting, setInteracting] = useState(false);
  const [compare, setCompare] = useState(false);
  const [animation, setAnimation] = useState<StageAnimation | null>(null);
  const [closing, setClosing] = useState(false);
  const [historyArmed, setHistoryArmed] = useState(true);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);
  const closingRef = useRef(false);

  const dirty = isEdited(edit);
  const busy = saver.state.phase === "exporting" || saver.state.phase === "uploading";
  const saved = saver.state.phase === "done";
  const locked = busy || saved;
  const cropping = tab === "crop";

  // ---- closing (button, Escape, or Back) ----

  const finishClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  /** Resolves true when the editor may close (asking first if there are unsaved edits). */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (saved) return true;
    if (busy) {
      toast({ message: "Your edited copy will finish saving in the background." });
      return true;
    }
    if (!dirty) return true;
    if (confirmingRef.current) return false;
    confirmingRef.current = true;
    try {
      return await confirm({
        title: "Discard edits?",
        message: "Your changes to this photo will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
    } finally {
      confirmingRef.current = false;
    }
  }, [busy, confirm, dirty, saved, toast]);

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    if (await confirmLeave()) finishClose();
  }, [confirmLeave, finishClose]);

  // Back has already removed the editor's history entry; re-arm it if the user keeps editing.
  const handleBack = useCallback(async () => {
    setHistoryArmed(false);
    if (closingRef.current) return;
    if (await confirmLeave()) finishClose();
    else setHistoryArmed(true);
  }, [confirmLeave, finishClose]);

  useHistoryOverlay(historyArmed, handleBack);

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Capture phase, so the viewer underneath never sees these keys.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void requestCloseRef.current();
      } else if (/^(Arrow\w+|Delete|Backspace)$/.test(event.key) && !rootRef.current?.contains(event.target as Node)) {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  // ---- edits ----

  const selectFilter = useCallback((filter: FilterId) => {
    setEdit((s) => ({ ...s, filter, filterStrength: s.filter === filter ? s.filterStrength : 100 }));
  }, []);

  const setStrength = useCallback((filterStrength: number) => setEdit((s) => ({ ...s, filterStrength })), []);

  const setAdjustment = useCallback((id: AdjustmentId, value: number) => {
    setEdit((s) => ({ ...s, adjust: { ...s.adjust, [id]: value } }));
  }, []);

  const resetAdjustments = useCallback(() => setEdit((s) => ({ ...s, adjust: { ...NEUTRAL_ADJUSTMENTS } })), []);

  const setCrop = useCallback((crop: CropRect) => setEdit((s) => ({ ...s, crop })), []);

  const preview = source.preview;
  const setAspect = useCallback(
    (aspect: AspectId) => {
      setEdit((s) => {
        if (!preview) return { ...s, aspect };
        const frame = transformedSize(preview, s.rotation);
        const ratio = aspectRatio(aspect, frame);
        return { ...s, aspect, crop: ratio ? fitCropToAspect(s.crop, ratio, frame) : s.crop };
      });
    },
    [preview]
  );

  const rotate = useCallback((direction: 1 | -1) => {
    setEdit((s) => rotateEdit(s, direction));
    setAnimation((a) => ({ kind: direction === 1 ? "rotate-cw" : "rotate-ccw", nonce: (a?.nonce ?? 0) + 1 }));
  }, []);

  const flip = useCallback(() => {
    setEdit(flipEdit);
    setAnimation((a) => ({ kind: "flip", nonce: (a?.nonce ?? 0) + 1 }));
  }, []);

  const resetGeometry = useCallback(() => {
    setEdit((s) => ({ ...s, rotation: 0, flipH: false, crop: { ...FULL_CROP }, aspect: "free" }));
  }, []);

  // ---- saving ----

  const original = source.original;
  const exportRequest = (): ExportRequest | null =>
    original ? { blob: original.blob, mimeType: original.mimeType, state: edit, natural: original.natural } : null;
  const canSave = dirty && Boolean(original) && !locked;

  const handleSave = () => {
    const request = exportRequest();
    if (request && canSave) void saver.save(request);
  };

  const handleRetry = () => {
    const request = exportRequest();
    if (request) saver.retry(request);
  };

  // Only mention the size cap when this copy would actually be smaller than the cropped original.
  const plan = original ? planExport(original.natural, edit) : null;
  const sizeNote = plan?.downscaled ? `Saves at ${plan.output.width} × ${plan.output.height}` : null;

  const compareHandlers = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setCompare(true);
    },
    onPointerUp: () => setCompare(false),
    onPointerCancel: () => setCompare(false),
    onLostPointerCapture: () => setCompare(false),
  };

  if (!mounted) return null;

  const loadingOriginal = source.progress !== null && !source.error;
  const percent = Math.round((source.progress ?? 0) * 100);
  const canCompare = hasColorEdits(edit) && Boolean(preview) && !cropping && !locked;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${media.filename}`}
      style={DARK_TOKENS}
      className={`fixed inset-0 z-[65] flex flex-col overscroll-contain bg-bg text-ink transition-opacity duration-180 ease-out-expo ${
        closing ? "pointer-events-none opacity-0" : "animate-fade-in opacity-100"
      }`}
    >
      <header
        className="relative z-10 flex items-center gap-2 px-2 pb-2"
        style={{ paddingTop: "calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 0.5rem)" }}
      >
        <IconButton label="Close editor" onClick={() => void requestClose()}>
          <CloseIcon />
        </IconButton>
        <div className="flex min-w-0 flex-1 justify-center" aria-live="polite">
          {loadingOriginal ? (
            // The viewer's Original badge, neutral while the full-resolution photo loads.
            <span className="telemetry flex h-6 min-w-0 items-center gap-1.5 rounded-tile-sm bg-surface-3 px-2 text-ink-muted animate-fade-in">
              <TileGlyph state="busy" />
              <span className="truncate">Loading original</span>
              {percent > 0 ? <span className="tabular-nums text-ink">{percent}%</span> : null}
            </span>
          ) : sizeNote ? (
            <span className="telemetry truncate text-ink-muted animate-fade-in">{sizeNote}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={`flex h-10 shrink-0 items-center gap-2 rounded-control bg-signal px-4 text-small font-semibold text-signal-ink transition-[background-color,color,box-shadow,transform] duration-120 ease-out-expo hover:shadow-glow-signal active:scale-[0.97] disabled:shadow-none ${
            saved ? "" : "disabled:bg-surface-3 disabled:text-ink-muted"
          }`}
        >
          {busy ? <SpinnerIcon size={16} /> : saved ? <CheckIcon size={18} /> : null}
          {saved ? "Saved" : "Save copy"}
        </button>
      </header>

      {loadingOriginal && (
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-transparent" aria-hidden="true">
          <div
            className="h-full bg-signal transition-[width] duration-320 ease-out-expo"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <EditorStage
          source={preview}
          state={edit}
          cropping={cropping}
          compare={compare}
          interacting={interacting}
          disabled={locked}
          animation={animation}
          onCropChange={setCrop}
          onInteractionChange={setInteracting}
        >
          {!preview && !source.error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-small text-ink-muted animate-fade-in">
              <SpinnerIcon size={24} />
              Loading photo{percent > 0 ? ` · ${percent}%` : "…"}
            </div>
          )}

          {source.error && (
            <div
              className={
                preview
                  ? "absolute inset-x-3 top-3 flex items-center gap-3 rounded-control border border-border/60 bg-surface-2 py-2.5 pl-4 pr-2.5 text-small shadow-elevated animate-fade-in-up"
                  : "absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-small animate-fade-in"
              }
              role="alert"
            >
              <AlertIcon className="shrink-0 text-danger" />
              <span className={preview ? "min-w-0 flex-1 text-ink" : "max-w-xs text-ink"}>
                {preview ? "Couldn't load the full-resolution photo, so it can't be saved yet." : source.error}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={source.retry} className={buttonClass({ variant: "primary", size: "sm" })}>
                  Retry
                </button>
                {!preview && (
                  <button type="button" onClick={() => void requestClose()} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    Close
                  </button>
                )}
              </div>
            </div>
          )}

          {compare && (
            <span className="telemetry pointer-events-none absolute left-3 top-3 flex h-6 items-center rounded-tile-sm bg-black/65 px-2 text-white animate-fade-in">
              Original
            </span>
          )}

          {canCompare && (
            <button
              type="button"
              aria-label="Hold to compare with the original"
              title="Hold to compare"
              {...compareHandlers}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") setCompare(true);
              }}
              onKeyUp={() => setCompare(false)}
              onContextMenu={(event) => event.preventDefault()}
              className="absolute bottom-3 right-3 flex h-11 w-11 touch-none select-none items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/15 transition-[background-color,transform] duration-180 ease-out-expo active:scale-[0.94] active:bg-black/80 animate-scale-in"
            >
              <CompareIcon />
            </button>
          )}

          {saver.state.phase !== "idle" && (
            // No blur: the overlay is up for the whole save, over a full-size canvas.
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 px-6 animate-fade-in">
              {saver.state.phase === "error" ? (
                <div
                  role="alert"
                  className="flex w-full max-w-xs flex-col items-center gap-3 rounded-dialog border border-border/60 bg-surface p-5 text-center shadow-elevated animate-scale-in"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-tile bg-danger/15 text-danger">
                    <AlertIcon size={22} />
                  </span>
                  <p className="text-body font-semibold">Couldn&apos;t save your copy</p>
                  <p className="text-small text-ink-muted">{saver.state.error}</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={saver.dismiss} className={buttonClass({ variant: "ghost", size: "sm" })}>
                      Keep editing
                    </button>
                    <button type="button" onClick={handleRetry} className={buttonClass({ variant: "primary", size: "sm" })}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex w-52 flex-col items-center gap-3 text-center animate-scale-in" aria-live="polite">
                  {saved ? (
                    <>
                      <span className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-signal text-signal-ink animate-check-pop">
                        <CheckIcon size={28} />
                      </span>
                      <p className="text-small font-medium text-white">{saver.state.label}</p>
                    </>
                  ) : (
                    // Progress as the tile meter, the step in the telemetry line above it.
                    <TileMeter
                      value={Math.round(saver.state.fraction * 100)}
                      max={100}
                      tiles={10}
                      fluid
                      label={saver.state.label}
                      valueText={`${Math.round(saver.state.fraction * 100)}%`}
                      ariaLabel="Saving your copy"
                      className="w-full text-left"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </EditorStage>

        <section className="flex shrink-0 flex-col border-t border-border/70 bg-bg lg:w-[22rem] lg:border-l lg:border-t-0">
          <div key={tab} className="flex min-h-[8.75rem] flex-col justify-center py-2 animate-fade-in lg:order-last lg:flex-1 lg:justify-start lg:py-4">
            {tab === "filters" && (
              <FiltersPanel
                source={preview}
                state={edit}
                disabled={locked}
                onSelect={selectFilter}
                onStrengthChange={setStrength}
                onInteractionChange={setInteracting}
              />
            )}
            {tab === "adjust" && (
              <AdjustPanel
                adjust={edit.adjust}
                active={activeAdjustment}
                disabled={locked}
                onActiveChange={setActiveAdjustment}
                onChange={setAdjustment}
                onReset={resetAdjustments}
                onInteractionChange={setInteracting}
              />
            )}
            {tab === "crop" && (
              <CropPanel
                aspect={edit.aspect}
                canReset={hasGeometryEdits(edit) || edit.aspect !== "free"}
                disabled={locked || !preview}
                onAspectChange={setAspect}
                onRotate={rotate}
                onFlip={flip}
                onReset={resetGeometry}
              />
            )}
          </div>
          <nav
            role="tablist"
            aria-label="Editing tools"
            className="flex border-t border-border/70 lg:border-b lg:border-t-0"
            style={{ paddingBottom: "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" }}
          >
            {TABS.map(({ id, label, Icon }) => {
              const selected = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={locked}
                  onClick={() => setTab(id)}
                  className={`group flex h-[60px] flex-1 flex-col items-center justify-center gap-1 text-micro font-medium transition-colors duration-180 ease-out-expo disabled:opacity-50 ${
                    selected ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {/* The active tool's icon sits in the lime tile, like the tab bar's. */}
                  <span
                    className={`flex h-[30px] w-11 items-center justify-center rounded-tile transition-[background-color,color,transform] duration-250 ease-out-expo group-active:scale-[0.94] ${
                      selected ? "bg-signal text-signal-ink" : ""
                    }`}
                  >
                    <Icon size={20} />
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
        </section>
      </div>
    </div>,
    document.body
  );
}
