"use client";

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { canStream, streamUrl, subscribeStreamSupport } from "@/lib/media/stream";
import MediaPlaceholder from "../MediaPlaceholder";
import { formatDuration } from "./format";
import type { Size } from "./geometry";
import { DownloadIcon, PauseIcon, PlayIcon, ProgressRing, Spinner, VolumeIcon } from "./icons";
import { describeLoadError, type OriginalEntry, type ProgressListener } from "./originals";
import { useCachedThumb, usePreviewThumb } from "./useCachedThumb";

interface VideoSlideProps {
  item: MediaIndexEntry;
  repoKey: string;
  box: Size;
  active: boolean;
  controlsVisible: boolean;
  loadOriginal: (item: MediaIndexEntry, onProgress: ProgressListener) => Promise<OriginalEntry>;
  releaseOriginal: (id: string) => void;
  onAspect: (id: string, aspect: number) => void;
  onPlayingChange: (playing: boolean) => void;
  /** Any interaction with the player (keeps the controls from auto-hiding). */
  onActivity: () => void;
  onDownload: () => void;
  downloadLabel: string;
}

type Phase = "poster" | "loading" | "playing" | "error";
type Source = { url: string; kind: "stream" | "file" };

const LAYER = "absolute inset-0 h-full w-full object-contain [-webkit-touch-callout:none]";
const RELEASE_ABOVE_BYTES = 64 * 1024 * 1024;

function VideoSlide({
  item,
  repoKey,
  box,
  active,
  controlsVisible,
  loadOriginal,
  releaseOriginal,
  onAspect,
  onPlayingChange,
  onActivity,
  onDownload,
  downloadLabel,
}: VideoSlideProps) {
  const hasThumb = Boolean(item.thumb);
  const small = useCachedThumb(repoKey, item.id, 320, hasThumb);
  const poster = usePreviewThumb(repoKey, item.id, hasThumb);
  const [posterLoaded, setPosterLoaded] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("poster");
  const [source, setSource] = useState<Source | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.duration ?? 0);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const aliveRef = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const scrubbingRef = useRef(false);
  const fileBytesRef = useRef(0);
  const streamable = useSyncExternalStore(subscribeStreamSupport, canStream, () => false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const report = useCallback(
    (playing: boolean) => {
      if (activeRef.current) onPlayingChange(playing);
    },
    [onPlayingChange]
  );

  // Leaving the slide stops playback; a big downloaded file is freed right away.
  useEffect(() => {
    if (active) return;
    videoRef.current?.pause();
    if (sourceRef.current?.kind === "file" && fileBytesRef.current > RELEASE_ABOVE_BYTES) releaseOriginal(item.id);
    setSource(null);
    setPhase((p) => (p === "error" ? p : "poster"));
    setPaused(true);
    setBuffering(false);
    setTime(0);
  }, [active, item.id, releaseOriginal]);

  const playFile = useCallback(async () => {
    setPhase("loading");
    setProgress(null);
    setError(null);
    try {
      const entry = await loadOriginal(item, (fraction) => {
        if (aliveRef.current) setProgress(fraction);
      });
      if (!aliveRef.current || !activeRef.current) return;
      fileBytesRef.current = entry.blob.size;
      setSource({ url: entry.url, kind: "file" });
      setPhase("playing");
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describeLoadError(err, "Couldn't load this video. Try again."));
      setPhase("error");
    }
  }, [item, loadOriginal]);

  const play = useCallback(() => {
    onActivity();
    setError(null);
    // Streaming starts instantly and can seek; without the service worker, download the whole file.
    if (streamable || canStream()) {
      setSource({ url: streamUrl(item.id), kind: "stream" });
      setPhase("playing");
      return;
    }
    void playFile();
  }, [item.id, onActivity, playFile, streamable]);

  const togglePlay = useCallback(() => {
    onActivity();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void video.play().catch(() => setPaused(true));
    else video.pause();
  }, [onActivity]);

  const onVideoError = useCallback(() => {
    // The service worker couldn't stream it: fall back to downloading the whole file.
    if (sourceRef.current?.kind === "stream") {
      void playFile();
      return;
    }
    setSource(null);
    setError("This video can't be played here. Download it to watch.");
    setPhase("error");
    report(false);
  }, [playFile, report]);

  const measure = (w: number, h: number) => {
    if (!w || !h) return;
    const measured = w / h;
    const stated = item.width && item.height ? item.width / item.height : null;
    if (!stated || Math.abs(measured - stated) / stated > 0.03) onAspect(item.id, measured);
  };

  const onPosterLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
    setPosterLoaded(event.currentTarget.getAttribute("src"));
  };

  const playing = phase === "playing" && source !== null;
  const boxStyle = { width: box.w, height: box.h, transform: "translate(-50%, -50%)" };
  const fill = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <>
      <div className="absolute left-1/2 top-1/2 overflow-hidden" style={boxStyle}>
        {hasThumb ? (
          <>
            {small && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={small} alt="" aria-hidden="true" draggable={false} className={LAYER} />
            )}
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={poster}
                src={poster}
                alt={item.filename}
                draggable={false}
                decoding="async"
                onLoad={onPosterLoad}
                className={`${LAYER} transition-opacity duration-250 ${posterLoaded === poster ? "opacity-100" : "opacity-0"}`}
              />
            )}
          </>
        ) : (
          <MediaPlaceholder isVideo variant="overlay" className="absolute inset-0" />
        )}

        {playing && (
          <video
            ref={videoRef}
            src={source.url}
            poster={poster ?? undefined}
            autoPlay
            playsInline
            preload="auto"
            className={`${LAYER} bg-black`}
            onPlay={() => {
              setPaused(false);
              report(true);
            }}
            onPause={() => {
              setPaused(true);
              report(false);
            }}
            onEnded={() => {
              setPaused(true);
              report(false);
            }}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onTimeUpdate={(e) => {
              if (!scrubbingRef.current) setTime(e.currentTarget.currentTime);
            }}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
            onError={onVideoError}
          />
        )}
      </div>

      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <button
            type="button"
            onClick={phase === "loading" ? undefined : play}
            aria-label={phase === "loading" ? "Loading video" : "Play video"}
            tabIndex={active ? 0 : -1}
            className={`lv-play lv-glass-still h-[76px] w-[76px] ${active ? "pointer-events-auto" : ""}`}
          >
            {phase === "loading" ? (
              <ProgressRing value={progress} size={30} className="lv-badge-ring" />
            ) : (
              <PlayIcon size={32} className="translate-x-0.5" />
            )}
          </button>
          {active && phase === "loading" && (
            <p className="lv-glass-still rounded-full px-3.5 py-1.5 text-[13px] font-medium tabular-nums text-white/90" role="status">
              Loading video{progress != null ? ` · ${Math.round(progress * 100)}%` : "…"}
            </p>
          )}
          {active && phase === "error" && error && (
            <div className="lv-glass-still pointer-events-auto flex max-w-xs flex-col items-center gap-3 rounded-[22px] px-5 py-4">
              <p className="text-[14px] leading-5 text-white/85">{error}</p>
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black transition-transform duration-150 active:scale-[0.97]"
              >
                <DownloadIcon size={16} />
                {downloadLabel}
              </button>
            </div>
          )}
          {phase === "poster" && duration > 0 && (
            <span className="lv-glass-still rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white/90">
              {formatDuration(duration)}
            </span>
          )}
        </div>
      )}

      {playing && (
        <>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={paused ? "Play" : "Pause"}
            className={`lv-play lv-glass-still absolute left-1/2 top-1/2 -ml-9 -mt-9 h-[72px] w-[72px] ${
              paused || buffering || controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {buffering && !paused ? (
              <Spinner size={28} />
            ) : paused ? (
              <PlayIcon size={28} className="translate-x-0.5" />
            ) : (
              <PauseIcon size={24} />
            )}
          </button>

          <div
            data-gesture-ignore
            className={`absolute inset-x-0 bottom-safe-[6.25rem] px-safe-4 transition-opacity duration-250 ${
              controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {/* Glass without the blur: the video moves underneath. */}
            <div className="lv-glass-still mx-auto flex max-w-[34rem] items-center gap-1.5 rounded-full py-0.5 pl-1 pr-1 text-[12px] font-medium tabular-nums text-white">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={paused ? "Play" : "Pause"}
                tabIndex={-1}
                aria-hidden="true"
                className="lv-round h-10 w-10 hover:bg-white/10"
              >
                {paused ? <PlayIcon size={18} className="translate-x-px" /> : <PauseIcon size={16} />}
              </button>
              <span className="w-9 shrink-0 text-right">{formatDuration(time)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(time, duration || 0)}
                aria-label="Seek"
                aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
                className="lv-range mx-1.5 min-w-0 flex-1"
                style={{ ["--lv-fill" as string]: `${fill}%` }}
                onPointerDown={() => {
                  scrubbingRef.current = true;
                }}
                onPointerUp={() => {
                  scrubbingRef.current = false;
                }}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setTime(next);
                  if (videoRef.current) videoRef.current.currentTime = next;
                  onActivity();
                }}
              />
              <span className="w-9 shrink-0">{formatDuration(duration)}</span>
              <button
                type="button"
                onClick={() => {
                  onActivity();
                  const video = videoRef.current;
                  if (video) video.muted = !video.muted;
                }}
                aria-label={muted ? "Unmute" : "Mute"}
                className="lv-round h-10 w-10 hover:bg-white/10"
              >
                <VolumeIcon muted={muted} size={20} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default memo(VideoSlide);
