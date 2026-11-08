import { useState } from 'react';
import { MusicNote } from 'iconoir-react/regular';
import type { DiscoverySetlistResult } from '../../types';

interface SetlistFeedCardProps {
  setlist: DiscoverySetlistResult;
  onOpen: (setlist: DiscoverySetlistResult) => void;
  /** Shown first in the detail line, for rows that mix artists. */
  artistName?: string | null;
}

function SetlistThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} className="discovery-setlist-thumb" />;
  return <span className="discovery-setlist-thumb" aria-hidden="true"><MusicNote width={24} height={24} aria-hidden="true" /></span>;
}

/** One setlist: a wide thumbnail, its title, then (for rows that mix artists) the artist, its date and the share of its tracks that are identified. */
export function SetlistFeedCard({ setlist, onOpen, artistName }: SetlistFeedCardProps) {
  const title = setlist.title ?? 'Untitled Set';
  const completionPct = setlist.completion_pct != null ? Math.round(setlist.completion_pct) : null;
  const detail = [artistName, setlist.set_date, completionPct != null ? `${completionPct}%` : null].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className="discovery-setlist"
      title={completionPct != null ? `${title} · ${completionPct}% of its tracks identified` : title}
      onClick={() => onOpen(setlist)}
    >
      <SetlistThumb url={setlist.artwork_url ?? null} />
      <span className="discovery-setlist-title">{title}</span>
      {detail && <span className="discovery-setlist-detail">{detail}</span>}
    </button>
  );
}
