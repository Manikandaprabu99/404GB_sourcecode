"use client";

import { memo, useEffect, useState } from "react";
import { useCachedThumb } from "./useCachedThumb";

interface Layer {
  id: string;
  url: string;
  shown: boolean;
}

const FADE_MS = 420;

/** The ambient background: the photo's small thumbnail, blurred and darkened; new photos crossfade in. */
function Ambient({ repoKey, mediaId, enabled }: { repoKey: string; mediaId: string; enabled: boolean }) {
  const url = useCachedThumb(repoKey, mediaId, 320, enabled);
  const [layers, setLayers] = useState<Layer[]>([]);

  useEffect(() => {
    if (!url) return;
    setLayers((current) => {
      if (current.some((layer) => layer.url === url && layer.id === mediaId)) return current;
      return [...current.slice(-1), { id: mediaId, url, shown: false }];
    });
  }, [url, mediaId]);

  // Show the newest layer on the next frame (so it transitions), then drop the ones under it.
  const newest = layers[layers.length - 1];
  useEffect(() => {
    if (!newest || newest.shown) return;
    const frame = requestAnimationFrame(() =>
      setLayers((current) => current.map((layer) => (layer === newest ? { ...layer, shown: true } : layer)))
    );
    return () => cancelAnimationFrame(frame);
  }, [newest]);

  useEffect(() => {
    if (layers.length < 2 || !newest?.shown) return;
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), FADE_MS + 60);
    return () => window.clearTimeout(timer);
  }, [layers.length, newest]);

  return (
    <div className="lv-ambient" aria-hidden="true">
      {layers.map((layer) => (
        <div key={`${layer.id}:${layer.url}`} className="lv-ambient-layer" data-shown={layer.shown}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={layer.url} alt="" draggable={false} decoding="async" className="lv-ambient-img" />
        </div>
      ))}
    </div>
  );
}

export default memo(Ambient);
