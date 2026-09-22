// Client-side video introspection: duration/width/height + a poster frame,
// extracted via an offscreen <video> element (Section 9 of the product spec —
// Video Handling). Never transcodes: the original file's bytes are chunked
// and stored as-is (see lib/chunking); this module only reads metadata and
// draws one frame to a canvas for the poster/thumbnail image.

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
}

const POSTER_SEEK_SECONDS = 1;

function loadVideoElement(file: File | Blob): Promise<{ video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const onError = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video metadata"));
    };
    video.onerror = onError;
    video.onloadedmetadata = () => resolve({ video, url });
  });
}

/** Extract duration/width/height without downloading/decoding the whole file. */
export async function extractVideoMetadata(file: File | Blob): Promise<VideoMetadata> {
  const { video, url } = await loadVideoElement(file);
  try {
    return {
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Seek to ~1s (or the midpoint for very short clips) and draw that frame to
 * a canvas, exporting it as a webp Blob — used both as the poster and as the
 * source still-frame fed into the normal thumbnail resize pipeline.
 */
export async function captureVideoPosterFrame(file: File | Blob): Promise<Blob> {
  const { video, url } = await loadVideoElement(file);
  try {
    const seekTo = Math.min(
      POSTER_SEEK_SECONDS,
      Number.isFinite(video.duration) ? video.duration / 2 : POSTER_SEEK_SECONDS
    );
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", () => reject(new Error("video seek failed")), {
        once: true,
      });
      video.currentTime = seekTo;
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
        "image/webp",
        0.85
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
