import { useState } from 'react';
import { FileUp, CheckCircle2, Music, ListMusic, Calendar, User, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import type { RekordboxImport, UserProfile } from '../../types';

interface LibraryHeroProps {
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
}

const ANALYSIS_TITLES: Record<string, string> = {
  partial: 'Analysis Incomplete',
  failed: 'Analysis Failed',
  awaiting_upload: 'Analysis Pending',
  uploading: 'Analysis Stalled',
  parsing: 'Analysis Processing…',
};

export function LibraryHero({ latestImport, profile, onImport, onResumeAnalysis }: LibraryHeroProps) {
  const [imgError, setImgError] = useState(false);
  const { volumeName } = useUsbConnection();

  const libraryName = profile?.display_name
    ? profile.display_name.toUpperCase()
    : 'MY LIBRARY';

  const avatarUrl = profile?.avatar_url ?? null;
  const initials = profile?.display_name
    ? profile.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : null;

  const shortDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });

  const analysisStatus = latestImport.analysis_status;
  const showAnalysis = analysisStatus && analysisStatus !== 'not_requested' && analysisStatus !== 'completed';
  const isAmber = analysisStatus === 'partial' || analysisStatus === 'awaiting_upload' || analysisStatus === 'uploading';
  const isActionable = analysisStatus === 'partial' || analysisStatus === 'failed' || analysisStatus === 'awaiting_upload' || analysisStatus === 'uploading';

  return (
    <div className="glass rounded-3xl border border-[var(--color-border-subtle)] overflow-hidden">
      <div className="flex flex-col lg:flex-row">

        {/* ── Left: main info ── */}
        <div className="flex-1 p-6 md:p-8 flex gap-6 items-start">
          {/* Profile avatar */}
          <div className="relative shrink-0 hidden sm:block">
            {avatarUrl && !imgError ? (
              <img
                src={avatarUrl}
                alt={profile?.display_name ?? 'Profile'}
                onError={() => setImgError(true)}
                className="w-20 h-20 rounded-full object-cover ring-4 ring-primary/25 shadow-xl"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center shadow-lg">
                {initials ? (
                  <span className="text-2xl font-black text-primary">{initials}</span>
                ) : (
                  <User size={32} className="text-primary/70" />
                )}
              </div>
            )}
            <div className="absolute inset-[-6px] rounded-full border border-primary/10 pointer-events-none" />
            <div className="absolute inset-[-13px] rounded-full border border-primary/5 pointer-events-none" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-black uppercase leading-tight tracking-tight">
              {libraryName}
            </h1>
            <p className="text-xs font-semibold mt-2">
              {latestImport.track_count.toLocaleString()} tracks across {latestImport.playlist_count} playlists
            </p>
          </div>
        </div>

        {/* ── Right: status + stats aligned row-by-row ── */}
        <div className="shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 px-6 py-5 flex items-start gap-6">

          {/* Status column — rows mirror the stats column rows */}
          <div className="flex flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-4 py-3">
            {/* Row 1: aligns with stat icons */}
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold leading-none h-3 flex items-center">
              USB Import
            </p>
            {/* Row 2: aligns with stat values */}
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle2 size={14} className="text-green-500 shrink-0" />
              <span className="font-black text-lg leading-none text-green-500">Import Complete</span>
            </div>
            {/* Row 3: spacer aligns with stat labels row */}
            <div className="mt-0.5 h-3" aria-hidden="true" />
            {/* Row 4: Import Library button aligns with "Imported from" */}
            <button
              onClick={onImport}
              className="mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors text-xs font-semibold"
            >
              <FileUp size={12} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Import New Library</span>
              <ChevronRight size={12} className="text-muted-foreground shrink-0" />
            </button>
          </div>

          <div className="w-px self-stretch bg-[var(--color-border-subtle)]" />

          {/* Analysis Status column — only rendered when non-complete */}
          {showAnalysis && (
            <>
              <div className="flex flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-4 py-3">
                {/* Row 1: aligns with stat icons */}
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold leading-none h-3 flex items-center">
                  Track Analysis
                </p>
                {/* Row 2: aligns with stat values */}
                <div className="flex items-center gap-1.5 mt-1">
                  <AlertTriangle size={14} className={isAmber ? 'text-amber-400 shrink-0' : 'text-red-400 shrink-0'} />
                  <span className={`font-black text-lg leading-none ${isAmber ? 'text-amber-400' : 'text-red-400'}`}>
                    {ANALYSIS_TITLES[analysisStatus] ?? 'Analysis Issue'}
                  </span>
                </div>
                {/* Row 3: spacer aligns with stat labels row */}
                <div className="mt-0.5 h-3" aria-hidden="true" />
                {/* Row 4: resume button aligns with "Imported from" */}
                {isActionable && onResumeAnalysis ? (
                  <button
                    onClick={() => onResumeAnalysis(latestImport.id)}
                    className="mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors text-xs font-semibold"
                  >
                    <RefreshCw size={12} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-left">Resume Analysis</span>
                    <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                  </button>
                ) : (
                  <div className="mt-1.5 h-3" aria-hidden="true" />
                )}
              </div>

              <div className="w-px self-stretch bg-[var(--color-border-subtle)]" />
            </>
          )}

          {/* Stats — per-row layout so rows align with the status column */}
          <div className="grid grid-cols-3 gap-x-6">
            {/* Row 1: icons */}
            <Music size={12} className="text-muted-foreground" />
            <ListMusic size={12} className="text-muted-foreground" />
            <Calendar size={12} className="text-muted-foreground" />
            {/* Row 2: values */}
            <span className="text-lg font-black tabular-nums leading-none mt-1">
              {latestImport.track_count >= 1000
                ? `${(latestImport.track_count / 1000).toFixed(1)}k`
                : latestImport.track_count}
            </span>
            <span className="text-lg font-black tabular-nums leading-none mt-1">{latestImport.playlist_count}</span>
            <span className="text-base font-black leading-none mt-1">{shortDate}</span>
            {/* Row 3: labels */}
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">Tracks</span>
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">Playlists</span>
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">Last Import</span>
            {/* Row 4: filename */}
            <p className="col-span-3 text-[10px] text-muted-foreground font-mono mt-1.5">
              Imported from {latestImport.device_name ?? volumeName ?? latestImport.source_filename}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
