import { useState } from 'react';
import {
  Search, Music, Settings, Loader2, CheckCircle2, AlertTriangle,
  XCircle, ChevronRight, Database, User, FileUp, Radio, TrendingUp, Layers,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { TrackAnalysisStatusBadge } from '../library/TrackAnalysisStatusBadge';
import { WaveformDisplay } from '../library/WaveformDisplay';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { ImportActivityBanner } from '../imports/ImportActivityBanner';
import { UsbConnectionButton } from '../usb/UsbConnectionButton';
import { PlaylistOverviewCard } from '../library/PlaylistOverviewCard';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { RekordboxImport } from '../../types';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

// ── mock data ─────────────────────────────────────────────────────────────────

const MOCK_IMPORT_PARSING: RekordboxImport = {
  id: 'demo-import-parsing',
  user_id: 'demo',
  source_filename: 'exportLibrary.db',
  source_type: 'file',
  database_version: null,
  device_name: 'PIONEER USB',
  rekordbox_created_date: null,
  track_count: 498,
  playlist_count: 12,
  playlist_track_count: 364,
  status: 'running',
  error_message: null,
  imported_at: new Date().toISOString(),
  source_bundle_type: 'usb_folder',
  analysis_status: 'parsing',
  analysis_expected_track_count: 498,
  analysis_matched_track_count: 498,
  analysis_parsed_track_count: 364,
  analysis_failed_track_count: 0,
  analysis_asset_count: 0,
  analysis_parser_version: null,
  analysis_completed_at: null,
  analysis_warnings: [],
  analysis_progress_processed_track_count: 364,
  analysis_progress_total_track_count: 498,
  analysis_current_track_id: null,
  analysis_current_track_title: 'Strobe',
  analysis_current_track_artist: 'Deadmau5',
  analysis_current_track_label: null,
  analysis_progress_updated_at: null,
};

const MOCK_IMPORT_QUEUED: RekordboxImport = {
  ...MOCK_IMPORT_PARSING,
  id: 'demo-import-queued',
  status: 'queued',
  analysis_status: 'queued',
  analysis_parsed_track_count: 0,
  analysis_progress_processed_track_count: 0,
  analysis_current_track_title: null,
};

const MOCK_PLAYLIST_REGULAR: PlaylistWithCount = {
  id: 'demo-playlist-1',
  import_id: 'demo-import',
  rekordbox_playlist_id: 'rp-1',
  name: 'Peak Hour Rollers',
  parent_playlist_id: null,
  sort_order: 0,
  is_folder: false,
  created_at: new Date().toISOString(),
  track_count: 84,
};

const MOCK_PLAYLIST_FOLDER: PlaylistWithCount = {
  id: 'demo-playlist-2',
  import_id: 'demo-import',
  rekordbox_playlist_id: 'rp-2',
  name: 'DNB Collection',
  parent_playlist_id: null,
  sort_order: 1,
  is_folder: true,
  created_at: new Date().toISOString(),
  track_count: 312,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 p-5">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// ── mock waveform states ───────────────────────────────────────────────────────

const MOCK_SEED = 'reusable-components-demo-seed';

const MOCK_WAVEFORM_LOADING: WaveformLoadState = { status: 'loading', trackId: 'demo' };
const MOCK_WAVEFORM_UNAVAILABLE: WaveformLoadState = { status: 'unavailable', trackId: 'demo' };
const MOCK_WAVEFORM_ERROR: WaveformLoadState = {
  status: 'error', trackId: 'demo', error: 'Network timeout', retryable: true,
};
const MOCK_WAVEFORM_INVALID: WaveformLoadState = {
  status: 'invalid', trackId: 'demo',
  error: 'Unsupported waveform format', reason: 'unsupported', retryable: false,
};

// ── sub-sections ──────────────────────────────────────────────────────────────

function ButtonsSection() {
  return (
    <>
      <Cell label="Primary Button">
        <button className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 transition-colors">
          Import Library
        </button>
        <button className="rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-white hover:bg-secondary/90 transition-colors">
          Open Drop Lab
        </button>
      </Cell>

      <Cell label="Secondary Button">
        <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-surface-hover)] transition-colors">
          Cancel
        </button>
        <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2">
          <Settings size={14} /> Settings
        </button>
      </Cell>

      <Cell label="Danger / Ghost Button">
        <button className="rounded-xl px-4 py-2 text-sm font-bold text-red-400 border border-red-500/20 bg-red-500/10 hover:bg-red-500/15 transition-colors">
          Delete Library
        </button>
        <button className="rounded-xl px-4 py-2 text-sm font-bold text-primary hover:text-primary/80 transition-colors">
          View status →
        </button>
      </Cell>

      <Cell label="Icon Button">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2.5 text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all">
            <Music size={16} />
          </button>
          <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2.5 text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all">
            <Search size={16} />
          </button>
          <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2.5 text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all">
            <Settings size={16} />
          </button>
          <button className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all">
            <XCircle size={16} />
          </button>
        </div>
      </Cell>

      <Cell label="Action Row Button">
        <button className="flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-hover)] transition-colors w-full">
          <FileUp size={12} className="text-muted-foreground" />
          <span className="flex-1 text-left">Import New Library</span>
          <ChevronRight size={12} className="text-muted-foreground" />
        </button>
        <button className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/15 transition-colors w-full">
          <Database size={12} />
          <span className="flex-1 text-left">View status</span>
          <ChevronRight size={12} />
        </button>
      </Cell>

      <Cell label="Disabled Button">
        <button disabled className="rounded-xl bg-primary/40 px-4 py-2 text-sm font-bold text-white cursor-not-allowed opacity-50">
          Processing…
        </button>
        <button disabled className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-bold text-muted-foreground cursor-not-allowed opacity-50 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Connecting…
        </button>
      </Cell>
    </>
  );
}

function InputsSection() {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  return (
    <>
      <Cell label="Text Input">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Display name"
          className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
        />
        <input
          type="email"
          placeholder="Email address"
          className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
        />
      </Cell>

      <Cell label="Search Input">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tracks, artists…"
            className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
          />
        </div>
      </Cell>

      <Cell label="Textarea">
        <textarea
          placeholder="Add a description for this playlist…"
          rows={3}
          className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all resize-none"
        />
      </Cell>
    </>
  );
}

function BadgesSection() {
  return (
    <>
      <Cell label="Status Badge">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-emerald-300">
            Active
          </span>
          <span className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-blue-300">
            Processing
          </span>
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-amber-300">
            Warning
          </span>
          <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-red-300">
            Failed
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-primary">
            73%
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary rounded">
            Active
          </span>
        </div>
      </Cell>

      <Cell label="Analysis Status Badge">
        <div className="flex flex-wrap gap-1.5">
          <TrackAnalysisStatusBadge status="completed" />
          <TrackAnalysisStatusBadge status="parsing" />
          <TrackAnalysisStatusBadge status="failed" />
          <TrackAnalysisStatusBadge status="partial" />
          <TrackAnalysisStatusBadge status="not_requested" />
          <TrackAnalysisStatusBadge status="reused" />
          <TrackAnalysisStatusBadge status="skipped" />
          <TrackAnalysisStatusBadge status="missing_required" />
        </div>
      </Cell>

      <Cell label="Status Dot">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Connected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-muted-foreground">Warning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs text-muted-foreground">Error</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-xs text-muted-foreground">Released</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-muted-foreground">Connecting</span>
          </div>
        </div>
      </Cell>
    </>
  );
}

function FeedbackSection() {
  return (
    <>
      <Cell label="Progress Bar">
        <div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>Parsing tracks</span>
            <span className="font-mono font-bold">73%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface)]">
            <div className="h-full w-[73%] rounded-full bg-primary transition-[width] duration-500" />
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
          <div className="h-full w-[42%] rounded-full bg-secondary" />
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--color-surface)]">
          <div className="h-full w-[91%] rounded-full bg-emerald-500" />
        </div>
      </Cell>

      <Cell label="Spinner / Loader">
        <div className="flex items-center gap-4">
          <Loader2 size={16} className="animate-spin text-primary" />
          <Loader2 size={20} className="animate-spin text-secondary" />
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading tracks…</span>
        </div>
      </Cell>

      <Cell label="Toast / Notification">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-950/60 p-3 text-emerald-50">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-xs font-black">Library is ready</p>
            <p className="mt-0.5 text-[10px] opacity-80">exportLibrary.db finished processing.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-950/60 p-3 text-amber-50">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs font-black">Analysis incomplete</p>
            <p className="mt-0.5 text-[10px] opacity-80">12 tracks could not be parsed.</p>
          </div>
        </div>
      </Cell>

      <Cell label="Import Activity Banner (parsing)">
        <ImportActivityBanner
          item={MOCK_IMPORT_PARSING}
          activeImport={MOCK_IMPORT_PARSING}
          onViewStatus={() => {}}
        />
      </Cell>

      <Cell label="Import Activity Banner (queued)">
        <ImportActivityBanner
          item={MOCK_IMPORT_QUEUED}
          activeImport={null}
          onViewStatus={() => {}}
        />
      </Cell>

      <Cell label="Error / Empty State">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-sm font-bold text-red-400">Import failed</p>
          <p className="mt-1 text-xs text-muted-foreground">Could not read exportLibrary.db. Check the file and try again.</p>
          <button className="mt-2 text-xs font-bold text-primary hover:underline">Retry</button>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] p-4 text-center">
          <p className="text-sm text-muted-foreground italic">No tracks found.</p>
        </div>
      </Cell>

      <Cell label="Warning / Alert Banner">
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-400">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>Select the USB root folder, not a subfolder.</span>
        </div>
        <div className="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
          <XCircle size={11} className="mt-0.5 shrink-0" />
          <span>USB access was denied. Re-authorize to continue.</span>
        </div>
      </Cell>
    </>
  );
}

function WaveformSection() {
  return (
    <>
      <Cell label="Waveform — Decorative (primary)">
        <div className="h-12 w-full">
          <WaveformDisplay seed={MOCK_SEED} barCount={80} color="primary" showFallbackLabel={false} />
        </div>
      </Cell>

      <Cell label="Waveform — Decorative (secondary)">
        <div className="h-12 w-full">
          <WaveformDisplay seed={`${MOCK_SEED}-2`} barCount={80} color="secondary" showFallbackLabel={false} />
        </div>
      </Cell>

      <Cell label="Waveform — With visualizer label">
        <div className="h-12 w-full">
          <WaveformDisplay seed={`${MOCK_SEED}-3`} barCount={60} showFallbackLabel />
        </div>
      </Cell>

      <Cell label="Rekordbox Waveform — Loading">
        <RekordboxPreviewWaveform state={MOCK_WAVEFORM_LOADING} height={40} variant="compact" />
      </Cell>

      <Cell label="Rekordbox Waveform — Unavailable">
        <RekordboxPreviewWaveform state={MOCK_WAVEFORM_UNAVAILABLE} height={40} variant="compact" />
      </Cell>

      <Cell label="Rekordbox Waveform — Error">
        <RekordboxPreviewWaveform
          state={MOCK_WAVEFORM_ERROR}
          height={40}
          variant="compact"
          onRetry={() => {}}
        />
      </Cell>

      <Cell label="Rekordbox Waveform — Invalid / Unsupported">
        <RekordboxPreviewWaveform state={MOCK_WAVEFORM_INVALID} height={40} variant="compact" />
      </Cell>
    </>
  );
}

function CardSection() {
  return (
    <>
      <Cell label="Glass Card">
        <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4">
          <p className="text-sm font-bold">Glass surface</p>
          <p className="text-xs text-muted-foreground mt-1">Used for panels, modals, and content containers throughout DropDex.</p>
        </div>
      </Cell>

      <Cell label="Surface Card">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-bold">Surface card</p>
          <p className="text-xs text-muted-foreground mt-1">Slightly elevated from the background. Used for list items and settings rows.</p>
        </div>
      </Cell>

      <Cell label="Hover Card / Track Row">
        {['Deadmau5 — Strobe', 'Above & Beyond — Sun & Moon', 'Illenium — Fractures'].map((title) => (
          <div
            key={title}
            className="grid grid-cols-[40px_1fr_48px] gap-3 items-center p-3 rounded-xl border border-[var(--color-border-faint)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--color-avatar-bg)] flex items-center justify-center text-[10px] font-bold text-slate-500">
              {title.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{title.split(' — ')[1]}</p>
              <p className="text-[10px] text-muted-foreground uppercase truncate">{title.split(' — ')[0]}</p>
            </div>
            <p className="text-xs font-mono font-bold text-muted-foreground text-right">128.0</p>
          </div>
        ))}
      </Cell>

      <Cell label="Active Track Row">
        <div className="grid grid-cols-[40px_1fr_48px] gap-3 items-center p-3 rounded-xl border border-primary/40 bg-[var(--color-surface-hover)] shadow-primary-selection cursor-pointer">
          <div className="w-10 h-10 rounded-lg brand-gradient flex items-center justify-center text-[10px] font-bold text-white">
            DE
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate text-foreground">Strobe</p>
            <p className="text-[10px] text-muted-foreground uppercase truncate">Deadmau5</p>
          </div>
          <p className="text-xs font-mono font-bold text-primary neon-text-blue text-right">128.0</p>
        </div>
      </Cell>

      <Cell label="Stat Tile / KPI">
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Music, value: '2.4k', label: 'Tracks' },
            { icon: TrendingUp, value: '47', label: 'Playlists' },
            { icon: Radio, value: '128', label: 'Avg BPM' },
          ].map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex flex-col items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
              <Icon size={14} className="text-muted-foreground" />
              <span className="text-lg font-black tabular-nums leading-none">{value}</span>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold">{label}</span>
            </div>
          ))}
        </div>
      </Cell>

      <Cell label="Playlist Card">
        <div className="grid grid-cols-2 gap-3">
          <PlaylistOverviewCard
            playlist={MOCK_PLAYLIST_REGULAR}
            onClick={() => {}}
            onEdit={() => {}}
          />
          <PlaylistOverviewCard
            playlist={MOCK_PLAYLIST_FOLDER}
            onClick={() => {}}
          />
        </div>
      </Cell>
    </>
  );
}

function AvatarSection() {
  return (
    <>
      <Cell label="Avatar — Initials">
        <div className="flex items-center gap-3">
          {[
            { initials: 'KR', size: 'w-8 h-8 text-sm' },
            { initials: 'DV', size: 'w-12 h-12 text-base' },
            { initials: 'AB', size: 'w-16 h-16 text-lg' },
            { initials: 'MX', size: 'w-20 h-20 text-xl' },
          ].map(({ initials, size }) => (
            <div
              key={initials}
              className={cn(
                'rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center font-black text-primary shadow-lg',
                size,
              )}
            >
              {initials}
            </div>
          ))}
        </div>
      </Cell>

      <Cell label="Avatar — Icon Fallback">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center">
            <User size={28} className="text-primary/70" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-[var(--color-avatar-bg)] flex items-center justify-center">
            <User size={18} className="text-slate-500" />
          </div>
        </div>
      </Cell>

      <Cell label="Avatar with ring">
        <div className="relative w-20 h-20 mx-auto">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center">
            <span className="text-2xl font-black text-primary">KR</span>
          </div>
          <div className="absolute inset-[-6px] rounded-full border border-primary/10 pointer-events-none" />
          <div className="absolute inset-[-13px] rounded-full border border-primary/5 pointer-events-none" />
        </div>
      </Cell>
    </>
  );
}

function TypographySection() {
  return (
    <>
      <Cell label="Headings">
        <h1 className="text-3xl font-black italic leading-tight">H1 — Drop Lab</h1>
        <h2 className="text-2xl font-black italic">H2 — My Library</h2>
        <h3 className="text-xl font-black">H3 — Peak Hour Rollers</h3>
        <h4 className="text-base font-bold">H4 — Track Intelligence</h4>
      </Cell>

      <Cell label="Body & Muted Text">
        <p className="text-sm text-foreground">Body — Standard foreground text used for track titles and primary content.</p>
        <p className="text-sm text-muted-foreground">Muted — Secondary content: subtitles, descriptions, metadata.</p>
        <p className="text-xs text-muted-foreground">Small muted — Timestamps, import dates, file sizes.</p>
        <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">Label — Section headers and data labels.</p>
      </Cell>

      <Cell label="Mono / Code Text">
        <p className="font-mono text-sm font-bold tabular-nums">174.2 BPM</p>
        <p className="font-mono text-xs text-muted-foreground">8f591f3e-4c2d-…</p>
        <p className="font-mono text-[10px] text-muted-foreground">Imported from PIONEER USB</p>
        <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary rounded">
          2.0.0
        </span>
      </Cell>

      <Cell label="Brand / Accent Text">
        <p className="text-primary font-bold neon-text-blue">Primary accent — neon blue</p>
        <p className="text-secondary font-bold neon-text-purple">Secondary accent — neon purple</p>
        <p className="text-green-400 font-bold">Success green</p>
        <p className="text-amber-400 font-bold">Warning amber</p>
        <p className="text-red-400 font-bold">Danger red</p>
      </Cell>

      <Cell label="Brand Gradient Text">
        <p className="text-2xl font-black uppercase leading-none">
          Drop<span className="text-[var(--color-brand-primary)]">Dex</span>
        </p>
        <div className="h-px w-full bg-gradient-to-r from-primary/60 via-secondary/40 to-transparent" />
        <div className="h-px w-full bg-[var(--color-border-subtle)]" />
      </Cell>

      <Cell label="Divider">
        <div className="h-px w-full bg-[var(--color-border-subtle)]" />
        <div className="h-px w-full bg-[var(--color-border-faint)]" />
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
        </div>
        <div className="w-px self-stretch bg-[var(--color-border-subtle)] mx-auto h-10" />
      </Cell>
    </>
  );
}

function NavigationSection() {
  const [activeTab, setActiveTab] = useState('overview');
  const [activeNav, setActiveNav] = useState('home');

  const tabs = ['overview', 'playlists', 'tracks', 'genres'];
  const navItems = [
    { id: 'home', icon: Music, label: 'My Library' },
    { id: 'review', icon: TrendingUp, label: 'Review' },
    { id: 'discover', icon: Radio, label: 'Discover' },
    { id: 'components', icon: Layers, label: 'Reusable' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <>
      <Cell label="Sidebar Nav Items">
        <div className="flex flex-col gap-1">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border w-full text-left',
                activeNav === id
                  ? 'text-primary neon-text-blue bg-primary/10 border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent',
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </Cell>

      <Cell label="Tab Navigation">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold capitalize whitespace-nowrap transition-all border',
                activeTab === tab
                  ? 'bg-primary/10 border-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-[var(--color-surface)]',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </Cell>

      <Cell label="Back Button / Breadcrumb">
        <div className="flex items-center gap-2">
          <button className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all">
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <h2 className="text-xl font-black italic">Track Intelligence</h2>
        </div>
        <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Deep Scan Results</p>
      </Cell>

      <Cell label="USB Connection Button">
        <UsbConnectionButton />
      </Cell>

      <Cell label="Settings Row">
        <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
          {[
            { label: 'Version', value: '2.0.0' },
            { label: 'Library Source', value: 'Supabase' },
            { label: 'Import ID', value: '8f591f3e' },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-sm font-mono font-bold">{value}</p>
            </div>
          ))}
        </div>
      </Cell>

      <Cell label="Segmented / Toggle Row">
        <div className="flex rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1 gap-1">
          {['4 bars', '8 bars', '16 bars'].map((label, i) => (
            <button
              key={label}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                i === 1
                  ? 'bg-primary/15 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1 gap-1">
          {['DropDex', 'Rekordbox'].map((label, i) => (
            <button
              key={label}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                i === 0
                  ? 'bg-secondary/15 text-secondary border border-secondary/20'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Cell>
    </>
  );
}

// ── main view ─────────────────────────────────────────────────────────────────

export function ReusableComponentsView() {
  return (
    <div className="space-y-10 pt-2 pb-8 md:max-w-6xl md:mx-auto">

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Buttons</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ButtonsSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Inputs</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <InputsSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Badges & Indicators</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BadgesSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Feedback & Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeedbackSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Waveform</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <WaveformSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Cards & Data Display</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Avatar</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AvatarSection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Typography</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TypographySection />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground px-1">Navigation & Layout</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NavigationSection />
        </div>
      </section>

    </div>
  );
}
