import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { TrackPreviewWaveform } from '../lib/queries/analysisData';

const detailCache = new Map<string, TrackPreviewWaveform>();

async function maybeGunzip(blob: Blob): Promise<Blob> {
  if (!('DecompressionStream' in window)) return blob;
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    return blob;
  }
}

export function useDropLabDetailWaveform(
  importId: string | null,
  trackId: string | null,
  previewWaveform: TrackPreviewWaveform | null | undefined,
) {
  const [waveform, setWaveform] = useState<TrackPreviewWaveform | null>(previewWaveform ?? null);
  const [loading, setLoading] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setWaveform(previewWaveform ?? null);
    setUsedFallback(false);

    if (!importId || !trackId || !previewWaveform) {
      setLoading(false);
      return;
    }
    if (!previewWaveform.detailStorageBucket || !previewWaveform.detailStoragePath) {
      setLoading(false);
      setUsedFallback(true);
      return;
    }

    const cacheKey = `${importId}:${trackId}`;
    const cached = detailCache.get(cacheKey);
    if (cached) {
      setWaveform(cached);
      setLoading(false);
      setUsedFallback(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase.storage
        .from(previewWaveform.detailStorageBucket!)
        .download(previewWaveform.detailStoragePath!);
      if (error || !data) throw new Error(error?.message ?? 'Detailed waveform unavailable.');
      const payload = await maybeGunzip(data);
      const json = await payload.text();
      const parsed = JSON.parse(json) as Partial<TrackPreviewWaveform> & { previewColumns?: unknown };
      const columns = Array.isArray(parsed.previewColumns) ? parsed.previewColumns : previewWaveform.previewColumns;
      const detail: TrackPreviewWaveform = {
        ...previewWaveform,
        previewColumns: columns as TrackPreviewWaveform['previewColumns'],
        previewColumnsValid: columns.length > 0,
        previewColumnCount: columns.length,
      };
      detailCache.set(cacheKey, detail);
      return detail;
    })()
      .then((detail) => {
        if (requestId !== requestIdRef.current) return;
        setWaveform(detail);
        setUsedFallback(false);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setWaveform(previewWaveform);
        setUsedFallback(true);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [importId, trackId, previewWaveform]);

  return { waveform, loading, usedFallback };
}

