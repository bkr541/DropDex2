import { useState } from 'react';
import { Music } from '@carbon/icons-react';
import type { DiscoverySetlistResult } from '../../types';

interface SetlistFeedCardProps {
  setlist: DiscoverySetlistResult;
  onOpen: (setlist: DiscoverySetlistResult) => void;
}

function SetlistThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} className="discovery-setlist-thumb" />;
  return <span className="discovery-setlist-thumb" aria-hidden="true"><Music size={16} /></span>;
}

/** One setlist in an artist's row: a thumbnail beside its title, then its date and the share of its tracks that are identified. */
export function SetlistFeedCard({ setlist, onOpen }: SetlistFeedCardProps) {
  const title = setlist.title ?? 'Untitled Set';
  const completionPct = setlist.completion_pct != null ? Math.round(setlist.completion_pct) : null;
  const detail = [setlist.set_date, completionPct != null ? `${completionPct}%` : null].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className="discovery-setlist"
      title={completionPct != null ? `${title} · ${completionPct}% of its tracks identified` : title}
      onClick={(event) => { event.stopPropagation(); onOpen(setlist); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SetlistThumb url={setlist.artwork_url ?? null} />
      <div>
        <p className="studio-name">{title}</p>
        {detail && <p className="studio-sub">{detail}</p>}
      </div>
    </button>
  );
}
