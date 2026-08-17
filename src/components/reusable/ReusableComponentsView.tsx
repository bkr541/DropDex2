import { useState } from 'react';
import {
  Search, Music, Settings, Loader2, CheckCircle2, AlertTriangle,
  XCircle, ChevronRight, User, FileUp, TrendingUp, Layers,
  Zap, Play, Pause, SkipForward, Heart, MoreHorizontal,
  Eye, EyeOff, Lock, ChevronDown, Bell, Star, Radio, Flame,
  FolderOpen,
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

const MOCK_IMPORT: RekordboxImport = {
  id: 'demo',
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

const PLAYLISTS: PlaylistWithCount[] = [
  { id: 'p1', import_id: 'x', rekordbox_playlist_id: 'rp1', name: 'Peak Hour Rollers', parent_playlist_id: null, sort_order: 0, is_folder: false, created_at: '', track_count: 84 },
  { id: 'p2', import_id: 'x', rekordbox_playlist_id: 'rp2', name: 'DNB Collection', parent_playlist_id: null, sort_order: 1, is_folder: true, created_at: '', track_count: 312 },
  { id: 'p3', import_id: 'x', rekordbox_playlist_id: 'rp3', name: 'Warm Up Selects', parent_playlist_id: null, sort_order: 2, is_folder: false, created_at: '', track_count: 34 },
  { id: 'p4', import_id: 'x', rekordbox_playlist_id: 'rp4', name: 'Hard Techno', parent_playlist_id: null, sort_order: 3, is_folder: true, created_at: '', track_count: 198 },
];

const WAVEFORM_LOADING: WaveformLoadState = { status: 'loading', trackId: 'demo' };
const WAVEFORM_UNAVAILABLE: WaveformLoadState = { status: 'unavailable', trackId: 'demo' };
const WAVEFORM_ERROR: WaveformLoadState = { status: 'error', trackId: 'demo', error: 'Network timeout', retryable: true };

// ── section header ────────────────────────────────────────────────────────────

function Divider({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-5 select-none">
      <span className="font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground/30">{n}</span>
      <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
      <span className="font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground/30 uppercase">{title}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 01 · FOUNDATIONS
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = [
  { name: 'Brand Primary', cls: 'bg-primary', hex: '#cf6b65' },
  { name: 'Brand Secondary', cls: 'bg-secondary', hex: '#e8937e' },
  { name: 'Emerald', cls: 'bg-emerald-500', hex: '#10b981' },
  { name: 'Amber', cls: 'bg-amber-400', hex: '#fbbf24' },
  { name: 'Red', cls: 'bg-red-500', hex: '#ef4444' },
  { name: 'Cyan', cls: 'bg-cyan-400', hex: '#22d3ee' },
];

function FoundationsSection() {
  return (
    <div className="flex gap-0 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)]">
      {/* Color bars */}
      {COLORS.map(({ name, cls, hex }) => (
        <div key={name} className={cn('group relative flex-1 h-52 flex flex-col justify-end p-4', cls)}>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 space-y-0.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/90">{name}</p>
            <p className="font-mono text-[9px] text-white/60">{hex}</p>
          </div>
        </div>
      ))}
      {/* Type specimen */}
      <div className="flex-[2.5] bg-[var(--color-surface)]/60 p-8 flex flex-col justify-between border-l border-[var(--color-border-subtle)]">
        <div className="space-y-1">
          <p className="text-[48px] font-black leading-none tracking-tight">Strobe</p>
          <p className="text-2xl font-black italic text-muted-foreground">Deadmau5</p>
          <p className="text-base font-semibold text-muted-foreground/70">Progressive House · 2011</p>
          <p className="text-sm text-muted-foreground/50">128.0 BPM · 10A · 10:35 · exportLibrary.db</p>
          <p className="text-xs text-muted-foreground/30 uppercase tracking-[0.2em]">Analysis Status · Completed</p>
          <p className="font-mono text-[9px] text-muted-foreground/20 tracking-wider">8f591f3e-4c2d-4b7a-9c3d-1a2b3c4d5e6f</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-black tabular-nums text-primary neon-text-blue">174.2</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">BPM</span>
          <div className="h-8 w-px bg-[var(--color-border-subtle)] mx-2" />
          <span className="font-mono text-3xl font-black tabular-nums text-secondary">8A</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">Key</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 02 · BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

function ButtonsSection() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-3">
      {/* Hero row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-10 flex items-center justify-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(var(--color-brand-primary-rgb)/0.15)_0%,_transparent_70%)]" />
          <button className="relative z-10 rounded-2xl bg-primary px-8 py-4 text-base font-black text-white shadow-primary-selection transition-all hover:bg-primary/90 hover:shadow-[0_0_40px_rgba(var(--color-brand-primary-rgb)/0.6)] active:scale-[0.97]">
            <span className="flex items-center gap-2.5"><Zap size={16} />Import Library</span>
          </button>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 p-10 flex items-center justify-center">
          <button className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-8 py-4 text-base font-bold transition-all hover:border-primary/30 hover:bg-[var(--color-surface-hover)] active:scale-[0.97]">
            Cancel
          </button>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-red-500/15 bg-red-500/5 p-10 flex items-center justify-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(239,68,68,0.1)_0%,_transparent_70%)]" />
          <button className="relative z-10 rounded-2xl border border-red-500/30 bg-red-500/10 px-8 py-4 text-base font-bold text-red-400 transition-all hover:bg-red-500/15 hover:border-red-500/50 active:scale-[0.97]">
            <span className="flex items-center gap-2.5"><XCircle size={16} />Delete Library</span>
          </button>
        </div>
      </div>

      {/* Utility row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center justify-between rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-6 py-5">
          <div className="flex gap-2">
            {[Heart, Star, Flame, Bell, MoreHorizontal].map((Icon, i) => (
              <button key={i} className="w-10 h-10 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] flex items-center justify-center text-muted-foreground/50 hover:text-primary hover:border-primary/30 hover:bg-primary/8 transition-all active:scale-90">
                <Icon size={15} />
              </button>
            ))}
          </div>
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground/30 uppercase">Icon Buttons</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-6 py-5">
          <button
            onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 2000); }}
            disabled={loading}
            className="rounded-2xl bg-primary/15 border border-primary/25 px-6 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
          >
            <span className="flex items-center gap-2">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Processing…</> : <><CheckCircle2 size={14} /> Confirm</>}
            </span>
          </button>
          <button className="rounded-2xl px-6 py-3 text-sm font-bold text-primary hover:bg-primary/8 transition-all flex items-center gap-1.5 active:scale-[0.97]">
            View full report <ChevronRight size={14} />
          </button>
          <button className="brand-gradient rounded-2xl px-6 py-3 text-sm font-black text-white hover:opacity-90 transition-all active:scale-[0.97]">
            <span className="flex items-center gap-2"><Flame size={14} />Start Analysis</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 03 · INPUTS
// ─────────────────────────────────────────────────────────────────────────────

function InputsSection() {
  const [showPass, setShowPass] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const SUGGESTIONS = ['Strobe — Deadmau5', 'Sun & Moon — Above & Beyond', 'Fractures — Illenium'];

  return (
    <div className="grid grid-cols-5 gap-3">
      {/* Search — large left column */}
      <div className="col-span-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 p-8 space-y-3">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Search</p>
        <div className={cn(
          'flex items-center gap-3 rounded-2xl border px-5 py-4 transition-all duration-200',
          searchFocused ? 'border-primary/50 ring-2 ring-primary/15 bg-[var(--color-surface)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60',
        )}>
          <Search size={16} className={cn('shrink-0 transition-colors', searchFocused ? 'text-primary' : 'text-muted-foreground/40')} />
          <input
            type="search"
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            placeholder="Search tracks, artists, keys…"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/30 focus:outline-none"
          />
          <kbd className="hidden sm:flex h-5 items-center gap-0.5 rounded border border-[var(--color-border-subtle)] px-1.5 font-mono text-[9px] text-muted-foreground/30 shrink-0">⌘K</kbd>
        </div>
        <div className={cn(
          'rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden transition-all duration-200',
          searchFocused ? 'opacity-100' : 'opacity-40',
        )}>
          {SUGGESTIONS.map((r, i) => (
            <div
              key={i}
              onMouseDown={() => setSearchVal(r)}
              className="flex items-center gap-3 px-5 py-3.5 cursor-pointer border-b border-[var(--color-border-faint)] last:border-0 hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <Music size={12} className="text-muted-foreground/30 shrink-0" />
              <span className="text-sm">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form inputs — right column */}
      <div className="col-span-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 p-8 space-y-3">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Form Inputs</p>
        <div className="relative">
          <User size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/30 pointer-events-none" />
          <input type="text" placeholder="Display name" className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all" />
        </div>
        <div className="relative">
          <Lock size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/30 pointer-events-none" />
          <input type={showPass ? 'text' : 'password'} placeholder="Password" className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-10 pr-10 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all" />
          <button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
            {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <div className="relative">
          <select className="w-full appearance-none rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 pr-9 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all cursor-pointer">
            <option>DropDex Dark</option>
            <option>DropDex Light</option>
            <option>CDJ Performance</option>
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/30 pointer-events-none" />
        </div>
        <div className="space-y-1">
          <input type="email" defaultValue="invalid@" className="w-full rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-400 focus:outline-none transition-all" />
          <p className="text-[10px] text-red-400/80 pl-1">Please enter a valid email address.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 04 · STATUS & BADGES
// ─────────────────────────────────────────────────────────────────────────────

function StatusSection() {
  const ANALYSIS_STATUSES = ['completed', 'parsing', 'queued', 'failed', 'partial', 'not_requested', 'reused', 'skipped', 'missing_required'] as const;
  const STATUS_DOTS = [
    { label: 'Connected', dot: 'bg-green-500', note: 'USB active' },
    { label: 'Connecting', dot: 'bg-primary animate-pulse', note: 'Handshake' },
    { label: 'Permission Required', dot: 'bg-amber-400', note: 'Re-authorize' },
    { label: 'Error', dot: 'bg-red-500', note: 'Retry' },
    { label: 'Released', dot: 'bg-cyan-400', note: 'Idle' },
    { label: 'Unavailable', dot: 'bg-[var(--color-border-subtle)]', note: 'No drive' },
  ];

  return (
    <div className="space-y-3">
      {/* Analysis badges — full width strip */}
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-6">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Analysis Status Badge · All States</p>
        <div className="flex flex-wrap gap-2">
          {ANALYSIS_STATUSES.map(s => <TrackAnalysisStatusBadge key={s} status={s} />)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Pills */}
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-6">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Status Pills</p>
          <div className="flex flex-wrap gap-2">
            {[
              { l: 'Active', c: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
              { l: 'Processing', c: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
              { l: 'Queued', c: 'bg-primary/10 text-primary border-primary/20' },
              { l: 'Warning', c: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
              { l: 'Failed', c: 'bg-red-500/10 text-red-400 border-red-500/20' },
              { l: 'Paused', c: 'bg-[var(--color-surface-hover)] text-muted-foreground border-[var(--color-border-subtle)]' },
              { l: '174.2 BPM', c: 'bg-primary/10 text-primary border-primary/20 font-mono' },
              { l: '8A · Dm', c: 'bg-secondary/10 text-secondary border-secondary/20 font-mono' },
              { l: 'PRO', c: 'brand-gradient text-white border-transparent' },
            ].map(({ l, c }) => (
              <span key={l} className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold', c)}>{l}</span>
            ))}
          </div>
        </div>

        {/* Status dots */}
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-6">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Status Dot Indicators</p>
          <div className="space-y-3">
            {STATUS_DOTS.map(({ label, dot, note }) => (
              <div key={label} className="flex items-center gap-3">
                <span className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
                <span className="text-sm flex-1">{label}</span>
                <span className="font-mono text-[9px] text-muted-foreground/35 uppercase tracking-widest">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 05 · FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

function FeedbackSection() {
  const BARS = [
    { label: 'Parsing ANLZ files', pct: 73, color: 'bg-primary', h: 'h-2.5' },
    { label: 'Uploading library', pct: 42, color: 'bg-secondary', h: 'h-2' },
    { label: 'Indexing complete', pct: 100, color: 'bg-emerald-500', h: 'h-1.5' },
    { label: 'Queued', pct: 18, color: 'bg-amber-400', h: 'h-1' },
  ];

  return (
    <div className="space-y-3">
      {/* Import banner + progress — top row */}
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-8 space-y-5">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">Progress</p>
          {BARS.map(({ label, pct, color, h }) => (
            <div key={label} className="space-y-2">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{label}</span>
                <span className="font-mono font-bold tabular-nums">{pct}%</span>
              </div>
              <div className={cn('w-full overflow-hidden rounded-full bg-[var(--color-surface)]', h)}>
                <div className={cn('h-full rounded-full transition-[width] duration-700', color)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="col-span-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-8 space-y-3">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Toast Notifications</p>
          {[
            { Icon: CheckCircle2, title: 'Library is ready', body: 'exportLibrary.db finished processing.', wrap: 'border-emerald-500/20 bg-emerald-950/40', ic: 'text-emerald-400', tc: 'text-emerald-100' },
            { Icon: AlertTriangle, title: 'Analysis incomplete', body: '12 tracks could not be parsed.', wrap: 'border-amber-500/20 bg-amber-950/40', ic: 'text-amber-400', tc: 'text-amber-100' },
            { Icon: XCircle, title: 'Import failed', body: 'Could not read exportLibrary.db.', wrap: 'border-red-500/20 bg-red-950/40', ic: 'text-red-400', tc: 'text-red-100' },
          ].map(({ Icon, title, body, wrap, ic, tc }) => (
            <div key={title} className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', wrap)}>
              <Icon size={15} className={cn('mt-0.5 shrink-0', ic)} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs font-bold', tc)}>{title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{body}</p>
              </div>
              <button className="text-muted-foreground/30 hover:text-muted-foreground transition-colors shrink-0"><XCircle size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Import banner — full width */}
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-8 space-y-4">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">Import Activity Banner</p>
        <ImportActivityBanner item={MOCK_IMPORT} activeImport={MOCK_IMPORT} onViewStatus={() => {}} />
      </div>

      {/* Warning banners + loaders */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-6 space-y-3">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-3">Alert Banners</p>
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[11px] text-amber-400 font-medium">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Select the USB root folder, not PIONEER or a subfolder.
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-[11px] text-red-400 font-medium">
            <XCircle size={13} className="mt-0.5 shrink-0" />
            USB access was denied. Re-authorize to continue.
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-[11px] text-primary font-medium">
            <Bell size={13} className="mt-0.5 shrink-0" />
            A new version of DropDex is available.
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-6">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Loaders</p>
          <div className="flex items-end gap-8 mb-6">
            {[14, 20, 28, 40].map(s => <Loader2 key={s} size={s} className="animate-spin text-primary" />)}
          </div>
          <div className="space-y-2">
            {['Loading waveform data', 'Syncing library', 'Connecting to Supabase'].map(l => (
              <div key={l} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-faint)] bg-[var(--color-surface)] px-4 py-2.5">
                <Loader2 size={12} className="animate-spin text-primary shrink-0" />
                <span className="text-xs text-muted-foreground">{l}…</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 06 · WAVEFORM
// ─────────────────────────────────────────────────────────────────────────────

function WaveformSection() {
  return (
    <div className="space-y-3">
      {/* Full-width waveform */}
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-8 space-y-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="font-black">Strobe</p>
            <p className="text-xs text-muted-foreground uppercase">Deadmau5</p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span className="text-primary neon-text-blue font-bold">3:58</span>
            <span>/</span>
            <span>10:32</span>
          </div>
        </div>
        <div className="h-16">
          <WaveformDisplay seed="dropdex-primary-demo" barCount={120} color="primary" showFallbackLabel={false} />
        </div>
        <div className="h-10">
          <WaveformDisplay seed="dropdex-secondary-demo" barCount={120} color="secondary" showFallbackLabel />
        </div>
      </div>

      {/* Empty states */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Loading', state: WAVEFORM_LOADING },
          { label: 'Unavailable', state: WAVEFORM_UNAVAILABLE },
          { label: 'Error', state: WAVEFORM_ERROR },
        ].map(({ label, state }) => (
          <div key={label} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-6 py-6 space-y-3">
            <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">{label}</p>
            <RekordboxPreviewWaveform state={state} height={48} variant="compact" onRetry={state.status === 'error' ? () => {} : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 07 · LIBRARY / DATA
// ─────────────────────────────────────────────────────────────────────────────

const TRACKS = [
  { title: 'Strobe', artist: 'Deadmau5', bpm: '128.0', key: '7B', dur: '10:32' },
  { title: 'Sun & Moon', artist: 'Above & Beyond', bpm: '138.0', key: '8A', dur: '9:47' },
  { title: 'Fractures', artist: 'Illenium', bpm: '150.0', key: '4A', dur: '5:12' },
  { title: 'Lose Yourself (To Dance)', artist: 'Daft Punk', bpm: '100.5', key: '2B', dur: '5:53' },
  { title: 'Coming Home', artist: 'Sigma', bpm: '174.0', key: '9A', dur: '4:11' },
];

function LibrarySection() {
  const [playing, setPlaying] = useState<string | null>('Strobe');

  return (
    <div className="space-y-3">
      {/* Track table */}
      <div className="rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
        <div className="grid px-6 py-3 border-b border-[var(--color-border-faint)]" style={{ gridTemplateColumns: '32px 1fr 80px 56px 60px 36px' }}>
          {['#', 'Track', 'BPM', 'Key', 'Time', ''].map((h, i) => (
            <span key={i} className="font-mono text-[9px] font-bold tracking-[0.2em] text-muted-foreground/30 uppercase">{h}</span>
          ))}
        </div>
        {TRACKS.map(({ title, artist, bpm, key: k, dur }, i) => (
          <div
            key={title}
            onClick={() => setPlaying(title)}
            className={cn(
              'group grid items-center gap-0 px-6 py-3.5 cursor-pointer transition-all border-b border-[var(--color-border-faint)] last:border-0',
              playing === title ? 'bg-primary/8' : 'hover:bg-[var(--color-surface-hover)]',
            )}
            style={{ gridTemplateColumns: '32px 1fr 80px 56px 60px 36px' }}
          >
            <div className="flex items-center justify-center w-6">
              {playing === title
                ? <button onClick={e => { e.stopPropagation(); setPlaying(null); }} className="text-primary"><Pause size={12} /></button>
                : <><span className="text-[10px] font-mono text-muted-foreground/30 group-hover:hidden">{String(i + 1).padStart(2, '0')}</span><button onClick={() => setPlaying(title)} className="hidden group-hover:block text-muted-foreground hover:text-primary transition-colors"><Play size={12} /></button></>
              }
            </div>
            <div className="min-w-0 pr-4">
              <p className={cn('text-sm font-bold truncate', playing === title && 'text-primary neon-text-blue')}>{title}</p>
              <p className="text-[10px] text-muted-foreground uppercase truncate">{artist}</p>
            </div>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{bpm}</span>
            <span className={cn('font-mono text-xs font-bold', playing === title ? 'text-secondary' : 'text-muted-foreground/60')}>{k}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{dur}</span>
            <button className="text-muted-foreground/20 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"><MoreHorizontal size={14} /></button>
          </div>
        ))}
      </div>

      {/* KPIs + playlist cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Music, val: '2.4k', sub: 'Tracks', color: 'text-primary', bg: 'bg-primary/10' },
          { icon: TrendingUp, val: '47', sub: 'Playlists', color: 'text-secondary', bg: 'bg-secondary/10' },
          { icon: Radio, val: '174', sub: 'Avg BPM', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { icon: Star, val: '4.9', sub: 'Mix Score', color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(({ icon: Icon, val, sub, color, bg }) => (
          <div key={sub} className="flex items-center gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-6 py-5">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', bg)}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className={cn('text-2xl font-black tabular-nums leading-none', color)}>{val}</p>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Playlist cards */}
      <div className="grid grid-cols-4 gap-3">
        {PLAYLISTS.map(p => (
          <PlaylistOverviewCard key={p.id} playlist={p} onClick={() => {}} onEdit={p.is_folder ? undefined : () => {}} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 08 · NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

function NavigationSection() {
  const [tab, setTab] = useState('overview');
  const [seg, setSeg] = useState('dropdex');

  const NAV = [
    { id: 'home', Icon: Music, label: 'My Library' },
    { id: 'review', Icon: TrendingUp, label: 'Review' },
    { id: 'discover', Icon: Radio, label: 'Discover' },
    { id: 'droplab', Icon: Flame, label: 'Drop Lab' },
    { id: 'components', Icon: Layers, label: 'Reusable', active: true },
    { id: 'settings', Icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Sidebar */}
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-6">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-5">Sidebar Navigation</p>
        <nav className="space-y-0.5">
          {NAV.map(({ id, Icon, label, active }) => (
            <button key={id} className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all border',
              active ? 'text-primary neon-text-blue bg-primary/10 border-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] border-transparent',
            )}>
              <Icon size={15} />
              {label}
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </nav>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-6 space-y-3">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">Tabs</p>
          <div className="flex gap-1 p-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {['overview', 'playlists', 'tracks', 'artists'].map(t => (
              <button key={t} onClick={() => setTab(t)} className={cn('flex-1 rounded-lg py-1.5 text-[9px] font-bold capitalize transition-all', tab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                {t}
              </button>
            ))}
          </div>
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">Segmented Control</p>
          <div className="flex gap-1 p-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {['DropDex', 'Rekordbox'].map(s => (
              <button key={s} onClick={() => setSeg(s.toLowerCase())} className={cn('flex-1 rounded-lg py-2 text-xs font-bold transition-all', seg === s.toLowerCase() ? 'bg-secondary/15 text-secondary' : 'text-muted-foreground hover:text-foreground')}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-6 space-y-2 flex-1">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-3">Settings Row</p>
          {[['Version', '2.0.0'], ['Source', 'Supabase'], ['Tracks', '2,412'], ['Import ID', '8f591f3e']].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-xl border border-[var(--color-border-faint)] bg-[var(--color-surface)] px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="font-mono text-xs font-bold">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* USB + player */}
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 p-6 space-y-3">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase">USB Connection</p>
          <UsbConnectionButton />
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 flex-1">
          <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-4">Now Playing</p>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl brand-gradient flex items-center justify-center shrink-0"><Music size={16} className="text-white" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate text-primary neon-text-blue">Strobe</p>
              <p className="text-[10px] text-muted-foreground uppercase">Deadmau5</p>
            </div>
            <Heart size={14} className="text-muted-foreground/30 shrink-0" />
          </div>
          <div className="flex items-center justify-center gap-4 mb-4">
            <button className="text-muted-foreground/40 hover:text-foreground transition-colors"><SkipForward size={14} className="rotate-180" /></button>
            <button className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/25 transition-colors"><Pause size={14} /></button>
            <button className="text-muted-foreground/40 hover:text-foreground transition-colors"><SkipForward size={14} /></button>
          </div>
          <div className="h-1 rounded-full bg-[var(--color-surface)] mb-1">
            <div className="h-full w-[38%] rounded-full bg-primary" />
          </div>
          <div className="flex justify-between font-mono text-[9px] text-muted-foreground/40"><span>3:58</span><span>10:32</span></div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 09 · IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

function IdentitySection() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/30 px-8 py-8">
        <p className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground/35 uppercase mb-8">Avatar Scale</p>
        <div className="flex items-end gap-5">
          {[
            { i: 'KR', s: 'w-8 h-8 text-xs border' },
            { i: 'KR', s: 'w-10 h-10 text-sm border' },
            { i: 'KR', s: 'w-12 h-12 text-base border-2' },
            { i: 'KR', s: 'w-16 h-16 text-lg border-2' },
            { i: 'KR', s: 'w-20 h-20 text-xl border-2' },
          ].map(({ i, s }, idx) => (
            <div key={idx} className={cn('rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-primary/20 flex items-center justify-center font-black text-primary shrink-0', s)}>{i}</div>
          ))}
        </div>
      </div>

      <div className="col-span-2 rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden bg-[var(--color-surface)]/30">
        <div className="h-24 brand-gradient relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.1),_transparent)]" />
        </div>
        <div className="px-8 pb-8 -mt-10">
          <div className="relative w-20 h-20 mb-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/8 border-4 border-background flex items-center justify-center font-black text-primary text-xl">KR</div>
            <div className="absolute inset-[-5px] rounded-full border border-primary/15 pointer-events-none" />
            <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background" />
          </div>
          <p className="text-xl font-black">Kody Robinson</p>
          <p className="text-sm text-muted-foreground">kodyrobinson02@gmail.com</p>
          <div className="flex gap-8 mt-5 pt-5 border-t border-[var(--color-border-subtle)]">
            {[['2.4k', 'Tracks'], ['47', 'Playlists'], ['12', 'Imports']].map(([v, l]) => (
              <div key={l}>
                <p className="font-black font-mono text-base">{v}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// page
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { n: '01', title: 'Foundations', content: <FoundationsSection /> },
  { n: '02', title: 'Buttons', content: <ButtonsSection /> },
  { n: '03', title: 'Inputs', content: <InputsSection /> },
  { n: '04', title: 'Status & Badges', content: <StatusSection /> },
  { n: '05', title: 'Feedback', content: <FeedbackSection /> },
  { n: '06', title: 'Waveform', content: <WaveformSection /> },
  { n: '07', title: 'Library & Data', content: <LibrarySection /> },
  { n: '08', title: 'Navigation', content: <NavigationSection /> },
  { n: '09', title: 'Identity', content: <IdentitySection /> },
];

export function ReusableComponentsView() {
  return (
    <div className="pb-20 space-y-16">
      {SECTIONS.map(({ n, title, content }) => (
        <section key={n} className="space-y-6">
          <Divider n={n} title={title} />
          {content}
        </section>
      ))}
    </div>
  );
}
