"use client";

// Full-screen photo editor: filters, adjustments, crop/rotate/flip. Saves an edited
// copy through the upload queue; the original is never modified.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MediaIndexEntry } from "@/lib/media";
import { buttonClass } from "@/app/components/ui/Button";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
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
import "./viewer/viewer.css";

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

// Always dark: the Lumen dark neutrals; the accent follows the theme and is only used as a fill.
const DARK_TOKENS = {
  "--bg": "7 8 11",
  "--surface": "16 18 23",
  "--surface-2": "24 27 34",
  "--surface-3": "33 37 46",
  "--border": "37 41 51",
  "--border-strong": "55 61 74",
  "--ink": "244 246 250",
  "--ink-muted": "160 167 182",
  "--ink-faint": "122 129 145",
  "--success": "52 211 153",
  "--warning": "251 191 36",
  "--danger": "255 99 117",
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
      className="lv-round bg-white/[0.08] hover:bg-white/[0.14]"
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
            // The viewer's Original badge while the full-resolution photo loads.
            <span className="lv-badge lv-glass-still lv-fade-in min-w-0">
              <SpinnerIcon size={13} />
              <span className="truncate">Loading original{percent > 0 ? ` ${percent}%` : ""}</span>
            </span>
          ) : sizeNote ? (
            <span className="lv-fade-in truncate text-[13px] tabular-nums text-ink-muted">{sizeNote}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          data-saved={saved ? "true" : undefined}
          className="lv-ed-save"
        >
          {busy ? <SpinnerIcon size={16} /> : saved ? <CheckIcon size={18} /> : null}
          {saved ? "Saved" : "Save copy"}
        </button>
      </header>

      {loadingOriginal && (
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-transparent" aria-hidden="true">
          <div
            className="h-full rounded-r-full bg-accent transition-[width] duration-320 ease-out-expo"
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
            <span className="lv-badge lv-glass-still lv-fade-in pointer-events-none absolute left-3 top-3">
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
              className="lv-round lv-glass-still absolute bottom-3 right-3 touch-none select-none animate-scale-in"
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
                  className="flex w-full max-w-xs flex-col items-center gap-3 rounded-[22px] bg-surface-2 p-5 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_16px_40px_rgb(0_0_0/0.4)] animate-scale-in"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger">
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
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink animate-check-pop">
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

        <section className="flex shrink-0 flex-col bg-bg lg:w-[22rem] lg:border-l lg:border-border/60">
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
          <div
            className="px-4 pb-3 pt-1 lg:pb-3 lg:pt-4"
            style={{ paddingBottom: "calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))" }}
          >
            {/* Pill tool tabs; the selected tab's pill slides between them. */}
            <nav role="tablist" aria-label="Editing tools" className="lv-ed-tabs mx-auto max-w-sm">
              <span
                aria-hidden="true"
                className="lv-ed-tab-thumb"
                style={{
                  width: `calc((100% - 0.5rem - ${TABS.length - 1} * 0.25rem) / ${TABS.length})`,
                  transform: `translateX(calc(${TABS.findIndex((t) => t.id === tab)} * (100% + 0.25rem)))`,
                }}
              />
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
                    className="lv-ed-tab"
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
