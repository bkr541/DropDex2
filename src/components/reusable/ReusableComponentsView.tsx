import { useState } from 'react';
import {
  Search, Music, Settings, Loader2, CheckCircle2, AlertTriangle,
  XCircle, ChevronRight, Database, User, FileUp, Radio, TrendingUp,
  Layers, Zap, Sparkles, ArrowRight, Play, Pause, SkipForward,
  Heart, Share2, MoreHorizontal, Bell, Lock, Eye, EyeOff,
  ChevronDown, Star, Flame, Clock,
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

const WAVEFORM_LOADING: WaveformLoadState = { status: 'loading', trackId: 'demo' };
const WAVEFORM_UNAVAILABLE: WaveformLoadState = { status: 'unavailable', trackId: 'demo' };
const WAVEFORM_ERROR: WaveformLoadState = { status: 'error', trackId: 'demo', error: 'Network timeout', retryable: true };

// ── layout primitives ─────────────────────────────────────────────────────────

function SectionHeader({ index, label, description }: { index: string; label: string; description?: string }) {
  return (
    <div className="flex items-start gap-5 mb-8">
      <span className="mt-1 font-mono text-[10px] font-bold text-muted-foreground/40 w-6 shrink-0 pt-0.5">{index}</span>
      <div className="flex-1 border-t border-[var(--color-border-subtle)] pt-4">
        <h2 className="text-xs font-black uppercase tracking-[0.22em] text-muted-foreground">{label}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground/60">{description}</p>}
      </div>
    </div>
  );
}

function Tile({ label, span, children, className }: { label: string; span?: 'full' | 2; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex flex-col gap-4 rounded-3xl p-6',
      'border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/50 backdrop-blur-sm',
      span === 'full' && 'col-span-3',
      span === 2 && 'col-span-2',
      className,
    )}>
      <p className="text-[9px] font-black uppercase tracking-[0.22em] text-muted-foreground/50">{label}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

// ── 01 · COLOR SYSTEM ────────────────────────────────────────────────────────

const PALETTE = [
  { label: 'Brand Primary', swatch: 'bg-primary', text: 'text-primary', token: '--color-brand-primary' },
  { label: 'Brand Secondary', swatch: 'bg-secondary', text: 'text-secondary', token: '--color-brand-secondary' },
  { label: 'Surface', swatch: 'bg-[var(--color-surface)]', text: 'text-foreground', token: '--color-surface', border: true },
  { label: 'Surface Hover', swatch: 'bg-[var(--color-surface-hover)]', text: 'text-foreground', token: '--color-surface-hover', border: true },
  { label: 'Border Subtle', swatch: 'bg-[var(--color-border-subtle)]', text: 'text-foreground', token: '--color-border-subtle' },
  { label: 'Emerald', swatch: 'bg-emerald-500', text: 'text-emerald-400', token: 'emerald-500' },
  { label: 'Amber', swatch: 'bg-amber-400', text: 'text-amber-400', token: 'amber-400' },
  { label: 'Red', swatch: 'bg-red-500', text: 'text-red-400', token: 'red-500' },
  { label: 'Cyan', swatch: 'bg-cyan-400', text: 'text-cyan-400', token: 'cyan-400' },
];

function ColorSection() {
  return (
    <div className="grid grid-cols-3 md:grid-cols-9 gap-3">
      {PALETTE.map(({ label, swatch, token, border }) => (
        <div key={token} className="flex flex-col gap-2">
          <div className={cn('h-14 rounded-2xl shadow-sm', swatch, border && 'border border-[var(--color-border-subtle)]')} />
          <div>
            <p className="text-[9px] font-bold leading-tight">{label}</p>
            <p className="text-[8px] font-mono text-muted-foreground/60 truncate">{token}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 02 · TYPOGRAPHY ───────────────────────────────────────────────────────────

function TypographySection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Type Scale" span={2}>
        <div className="space-y-1">
          {[
            { size: 'text-4xl', weight: 'font-black', label: '36 / Black', sample: 'Drop Lab' },
            { size: 'text-2xl', weight: 'font-black italic', label: '24 / Black Italic', sample: 'My Library' },
            { size: 'text-xl', weight: 'font-bold', label: '20 / Bold', sample: 'Peak Hour Rollers' },
            { size: 'text-base', weight: 'font-semibold', label: '16 / Semibold', sample: 'Track Intelligence' },
            { size: 'text-sm', weight: 'font-medium', label: '14 / Medium', sample: 'Above & Beyond · Sun & Moon' },
            { size: 'text-xs', weight: 'font-normal text-muted-foreground', label: '12 / Regular Muted', sample: 'Imported from PIONEER USB · 498 tracks' },
            { size: 'text-[10px]', weight: 'font-bold uppercase tracking-[0.18em] text-muted-foreground', label: '10 / Label', sample: 'Analysis Status' },
          ].map(({ size, weight, label, sample }) => (
            <div key={label} className="flex items-baseline gap-4 py-1.5 border-b border-[var(--color-border-faint)] last:border-0">
              <span className="w-28 shrink-0 font-mono text-[8px] text-muted-foreground/50 self-center">{label}</span>
              <span className={cn(size, weight, 'leading-tight truncate')}>{sample}</span>
            </div>
          ))}
        </div>
      </Tile>

      <div className="flex flex-col gap-6">
        <Tile label="Mono / Data">
          <p className="font-mono text-2xl font-black tabular-nums text-primary neon-text-blue">174.2</p>
          <p className="font-mono text-xs text-muted-foreground">BPM · Key · Duration</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-primary/10 text-primary rounded-lg">128 BPM</span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-secondary/10 text-secondary rounded-lg">8A · Dm</span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-[var(--color-surface-hover)] text-muted-foreground rounded-lg">7:32</span>
          </div>
        </Tile>
        <Tile label="Brand Gradient">
          <p className="text-3xl font-black">
            Drop<span className="text-primary neon-text-blue">Dex</span>
          </p>
          <div className="h-px w-full bg-gradient-to-r from-primary via-secondary to-transparent" />
          <p className="text-xs text-muted-foreground">The sonic intelligence layer for DJs who play sets, not just songs.</p>
        </Tile>
      </div>
    </div>
  );
}

// ── 03 · BUTTONS ─────────────────────────────────────────────────────────────

function ButtonsSection() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Primary">
        <button className="group relative overflow-hidden rounded-2xl bg-primary px-5 py-3 text-sm font-black text-white transition-all hover:bg-primary/90 hover:shadow-[0_0_24px_rgba(var(--color-brand-primary-rgb)/0.45)] active:scale-[0.98]">
          <span className="relative z-10 flex items-center justify-center gap-2">
            <Zap size={15} />
            Import Library
          </span>
        </button>
        <button className="rounded-2xl bg-secondary px-5 py-3 text-sm font-black text-white transition-all hover:bg-secondary/90 hover:shadow-[0_0_24px_rgba(var(--color-brand-secondary-rgb)/0.35)] active:scale-[0.98]">
          <span className="flex items-center justify-center gap-2"><Sparkles size={15} /> Open Drop Lab</span>
        </button>
        <button className="brand-gradient rounded-2xl px-5 py-3 text-sm font-black text-white transition-all hover:opacity-90 hover:shadow-lg active:scale-[0.98]">
          <span className="flex items-center justify-center gap-2"><Flame size={15} /> Start Analysis</span>
        </button>
      </Tile>

      <Tile label="Secondary & Ghost">
        <button className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-5 py-3 text-sm font-bold transition-all hover:border-primary/30 hover:bg-[var(--color-surface-hover)] hover:text-primary active:scale-[0.98]">
          <span className="flex items-center justify-center gap-2"><Settings size={15} className="text-muted-foreground" /> Settings</span>
        </button>
        <button className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-5 py-3 text-sm font-bold transition-all hover:border-primary/30 hover:bg-[var(--color-surface-hover)] active:scale-[0.98]">
          <span className="flex items-center justify-center gap-2">Cancel</span>
        </button>
        <button className="rounded-2xl px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/8 active:scale-[0.98] flex items-center justify-center gap-1.5">
          View full report <ArrowRight size={14} />
        </button>
      </Tile>

      <Tile label="Danger & States">
        <button className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-3 text-sm font-bold text-red-400 transition-all hover:bg-red-500/15 hover:border-red-500/40 active:scale-[0.98]">
          <span className="flex items-center justify-center gap-2"><XCircle size={15} /> Delete Library</span>
        </button>
        <button
          onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 2000); }}
          disabled={loading}
          className="rounded-2xl bg-primary/20 border border-primary/25 px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/25 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          <span className="flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin" /> Processing…</> : <><CheckCircle2 size={15} /> Confirm</>}
          </span>
        </button>
        <div className="flex gap-2">
          {[Heart, Share2, MoreHorizontal, Bell].map((Icon, i) => (
            <button key={i} className="flex-1 flex items-center justify-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2.5 text-muted-foreground transition-all hover:text-primary hover:border-primary/30 hover:bg-primary/8 active:scale-95">
              <Icon size={15} />
            </button>
          ))}
        </div>
      </Tile>
    </div>
  );
}

// ── 04 · INPUTS ──────────────────────────────────────────────────────────────

function InputsSection() {
  const [text, setText] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Text Input">
        <div className="relative">
          <User size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Display name"
            className="w-full rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
          />
        </div>
        <div className="relative">
          <Lock size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          <input
            type={showPass ? 'text' : 'password'}
            placeholder="Password"
            className="w-full rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-10 pr-10 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
          />
          <button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div className="rounded-2xl border border-red-500/30 bg-[var(--color-surface)]">
          <input
            type="email"
            defaultValue="invalid-email"
            className="w-full rounded-2xl px-4 py-3 text-sm text-red-400 bg-transparent focus:outline-none"
          />
        </div>
        <p className="text-[10px] text-red-400 -mt-1 px-1">Please enter a valid email address.</p>
      </Tile>

      <Tile label="Search">
        <div className={cn(
          'flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all',
          focused
            ? 'border-primary/50 ring-2 ring-primary/20 bg-[var(--color-surface)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
        )}>
          <Search size={15} className={cn('shrink-0 transition-colors', focused ? 'text-primary' : 'text-muted-foreground/50')} />
          <input
            type="search"
            placeholder="Search tracks, artists, keys…"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border border-[var(--color-border-subtle)] px-1.5 font-mono text-[9px] text-muted-foreground/40">⌘K</kbd>
        </div>
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden">
          {['Strobe — Deadmau5', 'Sun & Moon — Above & Beyond', 'Fractures — Illenium'].map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors border-b border-[var(--color-border-faint)] last:border-0">
              <Music size={12} className="text-muted-foreground/40 shrink-0" />
              <span className="text-sm">{r}</span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile label="Select / Dropdown">
        <div className="relative">
          <select className="w-full appearance-none rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all cursor-pointer">
            <option>DropDex Dark</option>
            <option>DropDex Light</option>
            <option>CDJ Performance</option>
          </select>
          <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
        </div>
        <div className="relative">
          <select className="w-full appearance-none rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 pr-10 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all cursor-pointer">
            <option value="" disabled selected>Select key…</option>
            <option>1A · F♯m</option>
            <option>8A · Dm</option>
            <option>10B · C</option>
          </select>
          <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
        </div>
        <textarea
          placeholder="Add a note about this playlist…"
          rows={3}
          className="w-full rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all resize-none"
        />
      </Tile>
    </div>
  );
}

// ── 05 · BADGES & PILLS ──────────────────────────────────────────────────────

function BadgesSection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Status Pills">
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Active', color: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25' },
            { label: 'Processing', color: 'bg-blue-500/12 text-blue-400 border-blue-500/25' },
            { label: 'Queued', color: 'bg-primary/12 text-primary border-primary/25' },
            { label: 'Warning', color: 'bg-amber-500/12 text-amber-400 border-amber-500/25' },
            { label: 'Failed', color: 'bg-red-500/12 text-red-400 border-red-500/25' },
            { label: 'Paused', color: 'bg-muted/20 text-muted-foreground border-[var(--color-border-subtle)]' },
          ].map(({ label, color }) => (
            <span key={label} className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold', color)}>
              {label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '174.2 BPM', color: 'bg-primary/10 text-primary' },
            { label: '8A · Dm', color: 'bg-secondary/10 text-secondary' },
            { label: 'PRO', color: 'brand-gradient text-white' },
            { label: 'NEW', color: 'bg-emerald-500/15 text-emerald-400' },
          ].map(({ label, color }) => (
            <span key={label} className={cn('font-mono text-[9px] font-black uppercase tracking-widest rounded-lg px-2 py-1', color)}>
              {label}
            </span>
          ))}
        </div>
      </Tile>

      <Tile label="Analysis Status Badge">
        <div className="flex flex-wrap gap-1.5">
          {(['completed', 'parsing', 'failed', 'partial', 'not_requested', 'reused', 'skipped', 'missing_required', 'queued'] as const).map(s => (
            <TrackAnalysisStatusBadge key={s} status={s} />
          ))}
        </div>
      </Tile>

      <Tile label="Status Dot Indicators">
        <div className="space-y-3">
          {[
            { label: 'Connected', dot: 'bg-green-500', extra: 'animate-none' },
            { label: 'Connecting', dot: 'bg-primary animate-pulse' },
            { label: 'Warning', dot: 'bg-amber-400' },
            { label: 'Error', dot: 'bg-red-500' },
            { label: 'Released', dot: 'bg-cyan-400' },
            { label: 'Offline', dot: 'bg-[var(--color-border-subtle)]' },
          ].map(({ label, dot, extra }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={cn('w-2 h-2 rounded-full shrink-0', dot, extra)} />
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-widest">{dot.includes('green') ? 'OK' : dot.includes('amber') ? 'WARN' : dot.includes('red') ? 'ERR' : dot.includes('cyan') ? 'IDLE' : dot.includes('primary') ? 'INIT' : 'OFF'}</span>
            </div>
          ))}
        </div>
      </Tile>
    </div>
  );
}

// ── 06 · FEEDBACK ─────────────────────────────────────────────────────────────

function FeedbackSection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Progress Bar">
        {[
          { label: 'Parsing ANLZ files', pct: 73, color: 'bg-primary', thick: 'h-2.5' },
          { label: 'Uploading library', pct: 42, color: 'bg-secondary', thick: 'h-1.5' },
          { label: 'Analysis complete', pct: 100, color: 'bg-emerald-500', thick: 'h-1.5' },
          { label: 'Indexing metadata', pct: 18, color: 'bg-amber-400', thick: 'h-1' },
        ].map(({ label, pct, color, thick }) => (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{label}</span>
              <span className="font-mono font-bold tabular-nums">{pct}%</span>
            </div>
            <div className={cn('w-full overflow-hidden rounded-full bg-[var(--color-surface)]', thick)}>
              <div
                className={cn('h-full rounded-full transition-[width] duration-700', color)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </Tile>

      <Tile label="Toast Notifications">
        <div className="space-y-2">
          {[
            { icon: CheckCircle2, title: 'Library is ready', body: 'exportLibrary.db finished processing.', border: 'border-emerald-500/20 bg-emerald-950/50', icon_: 'text-emerald-400', title_: 'text-emerald-50' },
            { icon: AlertTriangle, title: 'Analysis incomplete', body: '12 tracks could not be parsed.', border: 'border-amber-500/20 bg-amber-950/50', icon_: 'text-amber-400', title_: 'text-amber-50' },
            { icon: XCircle, title: 'Import failed', body: 'Could not read exportLibrary.db.', border: 'border-red-500/20 bg-red-950/50', icon_: 'text-red-400', title_: 'text-red-50' },
          ].map(({ icon: Icon, title, body, border, icon_, title_ }) => (
            <div key={title} className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', border)}>
              <Icon size={15} className={cn('mt-0.5 shrink-0', icon_)} />
              <div className="min-w-0">
                <p className={cn('text-xs font-bold', title_)}>{title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{body}</p>
              </div>
              <button className="shrink-0 ml-auto text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <XCircle size={13} />
              </button>
            </div>
          ))}
        </div>
      </Tile>

      <Tile label="Loader / Spinner">
        <div className="flex items-end gap-6 justify-center py-2">
          {[14, 20, 28, 36].map(s => (
            <Loader2 key={s} size={s} className="animate-spin text-primary" />
          ))}
        </div>
        <div className="space-y-2">
          {['Connecting to Supabase', 'Loading waveform data', 'Syncing library'].map(label => (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-faint)] bg-[var(--color-surface)] px-4 py-2.5">
              <Loader2 size={13} className="animate-spin text-primary shrink-0" />
              <span className="text-xs text-muted-foreground">{label}…</span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile label="Import Banner — Parsing" span={2}>
        <ImportActivityBanner item={MOCK_IMPORT_PARSING} activeImport={MOCK_IMPORT_PARSING} onViewStatus={() => {}} />
      </Tile>

      <Tile label="Import Banner — Queued">
        <ImportActivityBanner item={MOCK_IMPORT_QUEUED} activeImport={null} onViewStatus={() => {}} />
      </Tile>

      <Tile label="Warning / Alert Banners" span={'full'}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: AlertTriangle, msg: 'Select the USB root folder, not PIONEER or a subfolder.', color: 'border-amber-500/20 bg-amber-500/8 text-amber-400' },
            { icon: XCircle, msg: 'USB access was denied. Re-authorize to continue.', color: 'border-red-500/20 bg-red-500/8 text-red-400' },
            { icon: Bell, msg: 'A new version of DropDex is available. Update now.', color: 'border-primary/20 bg-primary/8 text-primary' },
          ].map(({ icon: Icon, msg, color }) => (
            <div key={msg} className={cn('flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[11px] font-medium leading-relaxed', color)}>
              <Icon size={13} className="mt-0.5 shrink-0" />
              <span>{msg}</span>
            </div>
          ))}
        </div>
      </Tile>
    </div>
  );
}

// ── 07 · WAVEFORM ─────────────────────────────────────────────────────────────

function WaveformSection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Decorative Waveform — Primary">
        <div className="h-14 w-full">
          <WaveformDisplay seed="dropdex-seed-1" barCount={90} color="primary" showFallbackLabel={false} />
        </div>
        <div className="h-8 w-full">
          <WaveformDisplay seed="dropdex-seed-1b" barCount={60} color="primary" showFallbackLabel />
        </div>
      </Tile>

      <Tile label="Decorative Waveform — Secondary">
        <div className="h-14 w-full">
          <WaveformDisplay seed="dropdex-seed-2" barCount={90} color="secondary" showFallbackLabel={false} />
        </div>
        <div className="h-8 w-full">
          <WaveformDisplay seed="dropdex-seed-2b" barCount={60} color="secondary" showFallbackLabel />
        </div>
      </Tile>

      <Tile label="Empty States">
        <RekordboxPreviewWaveform state={WAVEFORM_LOADING} height={44} variant="compact" />
        <RekordboxPreviewWaveform state={WAVEFORM_UNAVAILABLE} height={44} variant="compact" />
        <RekordboxPreviewWaveform state={WAVEFORM_ERROR} height={44} variant="compact" onRetry={() => {}} />
      </Tile>
    </div>
  );
}

// ── 08 · DATA DISPLAY ─────────────────────────────────────────────────────────

const TRACKS = [
  { title: 'Strobe', artist: 'Deadmau5', bpm: '128.0', key: '7B', dur: '10:32', active: true },
  { title: 'Sun & Moon', artist: 'Above & Beyond', bpm: '138.0', key: '8A', dur: '9:47', active: false },
  { title: 'Fractures', artist: 'Illenium', bpm: '150.0', key: '4A', dur: '5:12', active: false },
  { title: 'Lose Yourself', artist: 'Eminem', bpm: '171.0', key: '2B', dur: '5:26', active: false },
];

function DataSection() {
  const [playing, setPlaying] = useState<string | null>('Strobe');

  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Track Row" span={2}>
        <div className="rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          {TRACKS.map(({ title, artist, bpm, key: k, dur, active }, i) => (
            <div
              key={title}
              onClick={() => setPlaying(title)}
              className={cn(
                'group grid items-center gap-3 px-4 py-3 cursor-pointer transition-all border-b border-[var(--color-border-faint)] last:border-0',
                playing === title
                  ? 'bg-primary/8 border-l-2 border-l-primary'
                  : 'hover:bg-[var(--color-surface-hover)]',
              )}
              style={{ gridTemplateColumns: '28px 1fr 60px 44px 44px 36px' }}
            >
              <div className="flex items-center justify-center">
                {playing === title ? (
                  <button onClick={e => { e.stopPropagation(); setPlaying(null); }} className="text-primary">
                    <Pause size={13} />
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground/40 group-hover:hidden">{String(i + 1).padStart(2, '0')}</span>
                )}
                {playing !== title && <button onClick={e => { e.stopPropagation(); setPlaying(title); }} className="hidden group-hover:block text-muted-foreground hover:text-primary transition-colors"><Play size={13} /></button>}
              </div>
              <div className="min-w-0">
                <p className={cn('text-sm font-bold truncate', playing === title && 'text-primary neon-text-blue')}>{title}</p>
                <p className="text-[10px] text-muted-foreground uppercase truncate">{artist}</p>
              </div>
              <span className="font-mono text-xs tabular-nums text-right text-muted-foreground">{bpm}</span>
              <span className="font-mono text-[10px] text-secondary text-center font-bold">{k}</span>
              <span className="font-mono text-xs tabular-nums text-right text-muted-foreground">{dur}</span>
              <button className="flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100">
                <MoreHorizontal size={14} />
              </button>
            </div>
          ))}
        </div>
      </Tile>

      <div className="flex flex-col gap-6">
        <Tile label="KPI Stat Tiles">
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Music, val: '2.4k', sub: 'Tracks', color: 'text-primary', bg: 'bg-primary/10' },
              { icon: TrendingUp, val: '47', sub: 'Playlists', color: 'text-secondary', bg: 'bg-secondary/10' },
              { icon: Radio, val: '174', sub: 'Avg BPM', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              { icon: Star, val: '4.9', sub: 'Mix Score', color: 'text-amber-400', bg: 'bg-amber-500/10' },
            ].map(({ icon: Icon, val, sub, color, bg }) => (
              <div key={sub} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', bg)}>
                  <Icon size={16} className={color} />
                </div>
                <span className={cn('text-2xl font-black tabular-nums leading-none', color)}>{val}</span>
                <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{sub}</span>
              </div>
            ))}
          </div>
        </Tile>

        <Tile label="Empty / Error State">
          <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] flex flex-col items-center gap-3 py-8 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-surface)] flex items-center justify-center">
              <Music size={20} className="text-muted-foreground/30" />
            </div>
            <div>
              <p className="text-sm font-bold">No tracks found</p>
              <p className="text-xs text-muted-foreground mt-0.5">Import a Rekordbox library to get started.</p>
            </div>
            <button className="rounded-xl border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1.5">
              <FileUp size={12} /> Import Library
            </button>
          </div>
        </Tile>
      </div>

      <Tile label="Playlist Cards" span={'full'}>
        <div className="grid grid-cols-4 gap-4">
          <PlaylistOverviewCard playlist={MOCK_PLAYLIST_REGULAR} onClick={() => {}} onEdit={() => {}} />
          <PlaylistOverviewCard playlist={MOCK_PLAYLIST_FOLDER} onClick={() => {}} />
          <PlaylistOverviewCard playlist={{ ...MOCK_PLAYLIST_REGULAR, id: 'p3', name: 'Warm Up Selectors', track_count: 34 }} onClick={() => {}} onEdit={() => {}} />
          <PlaylistOverviewCard playlist={{ ...MOCK_PLAYLIST_FOLDER, id: 'p4', name: 'Hard Techno', track_count: 198 }} onClick={() => {}} />
        </div>
      </Tile>
    </div>
  );
}

// ── 09 · NAVIGATION ───────────────────────────────────────────────────────────

function NavigationSection() {
  const [tab, setTab] = useState('overview');
  const [seg, setSeg] = useState('dropdex');

  const tabs = ['overview', 'playlists', 'tracks', 'genres', 'artists'];
  const navItems = [
    { id: 'home', icon: Music, label: 'My Library' },
    { id: 'review', icon: TrendingUp, label: 'Review' },
    { id: 'discover', icon: Radio, label: 'Discover' },
    { id: 'droplab', icon: Flame, label: 'Drop Lab' },
    { id: 'components', icon: Layers, label: 'Reusable', active: true },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Sidebar Navigation">
        <nav className="space-y-0.5">
          {navItems.map(({ id, icon: Icon, label, active: isActive }) => (
            <button
              key={id}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all border',
                isActive
                  ? 'text-primary neon-text-blue bg-primary/10 border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent',
              )}
            >
              <Icon size={16} />
              {label}
              {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </nav>
      </Tile>

      <div className="flex flex-col gap-6">
        <Tile label="Tab Navigation">
          <div className="flex gap-1 p-1 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-xl py-1.5 text-[10px] font-bold capitalize transition-all',
                  tab === t
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Tile>

        <Tile label="Segmented Control">
          <div className="flex gap-1 p-1 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {['DropDex', 'Rekordbox'].map(s => (
              <button
                key={s}
                onClick={() => setSeg(s.toLowerCase())}
                className={cn(
                  'flex-1 rounded-xl py-2 text-xs font-bold transition-all',
                  seg === s.toLowerCase()
                    ? 'bg-secondary/15 text-secondary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-1 p-1 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {['4 bars', '8 bars', '16 bars'].map((s, i) => (
              <button
                key={s}
                className={cn(
                  'flex-1 rounded-xl py-1.5 text-[10px] font-bold transition-all',
                  i === 1 ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </Tile>

        <Tile label="Settings Row">
          <div className="rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
            {[
              { label: 'Version', value: '2.0.0', mono: true },
              { label: 'Library Source', value: 'Supabase', mono: false },
              { label: 'Import ID', value: '8f591f3e', mono: true },
              { label: 'Tracks', value: '2,412', mono: true },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-faint)] last:border-0 hover:bg-[var(--color-surface-hover)] transition-colors">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className={cn('text-sm font-bold', mono && 'font-mono')}>{value}</span>
              </div>
            ))}
          </div>
        </Tile>
      </div>

      <div className="flex flex-col gap-6">
        <Tile label="USB Connection">
          <UsbConnectionButton />
        </Tile>

        <Tile label="Back / Breadcrumb">
          <div>
            <div className="flex items-center gap-1.5">
              <button className="flex items-center justify-center w-8 h-8 rounded-xl border border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all">
                <ChevronRight size={18} className="rotate-180" />
              </button>
              <h3 className="text-xl font-black">Track Intelligence</h3>
            </div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mt-1.5 pl-1">Deep Scan Results · Strobe by Deadmau5</p>
          </div>
        </Tile>

        <Tile label="Now Playing Mini">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl brand-gradient flex items-center justify-center shrink-0">
                <Music size={16} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate text-primary neon-text-blue">Strobe</p>
                <p className="text-[10px] text-muted-foreground uppercase">Deadmau5</p>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"><SkipForward size={14} className="rotate-180" /></button>
                <button className="p-2 rounded-xl bg-primary/15 text-primary hover:bg-primary/25 transition-colors"><Pause size={14} /></button>
                <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"><SkipForward size={14} /></button>
              </div>
            </div>
            <div className="mt-3 h-1 rounded-full bg-[var(--color-surface)]">
              <div className="h-full w-[38%] rounded-full bg-primary" />
            </div>
            <div className="flex justify-between mt-1 font-mono text-[9px] text-muted-foreground">
              <span>3:58</span><span>10:32</span>
            </div>
          </div>
        </Tile>
      </div>
    </div>
  );
}

// ── 10 · AVATAR ───────────────────────────────────────────────────────────────

function AvatarSection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Avatar Sizes">
        <div className="flex items-end gap-4 py-2">
          {[
            { initials: 'KR', size: 'w-8 h-8 text-xs' },
            { initials: 'AB', size: 'w-10 h-10 text-sm' },
            { initials: 'DV', size: 'w-12 h-12 text-base' },
            { initials: 'MX', size: 'w-16 h-16 text-lg' },
            { initials: 'JD', size: 'w-20 h-20 text-xl' },
          ].map(({ initials, size }) => (
            <div key={initials} className={cn('rounded-full bg-gradient-to-br from-primary/30 to-primary/8 border-2 border-primary/20 flex items-center justify-center font-black text-primary shrink-0', size)}>
              {initials}
            </div>
          ))}
        </div>
      </Tile>

      <Tile label="Avatar with Ring">
        <div className="flex items-center gap-6 justify-center py-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/8 border-2 border-primary/20 flex items-center justify-center">
              <span className="text-2xl font-black text-primary">KR</span>
            </div>
            <div className="absolute inset-[-5px] rounded-full border border-primary/15 pointer-events-none" />
            <div className="absolute inset-[-11px] rounded-full border border-primary/7 pointer-events-none" />
            <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background" />
          </div>
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-secondary/30 to-secondary/8 border-2 border-secondary/20 flex items-center justify-center">
              <User size={28} className="text-secondary/70" />
            </div>
            <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-amber-400 border-2 border-background" />
          </div>
        </div>
      </Tile>

      <Tile label="Profile Card">
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden">
          <div className="h-16 brand-gradient" />
          <div className="px-5 pb-5 -mt-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/30 to-primary/8 border-4 border-[var(--color-surface)] flex items-center justify-center font-black text-primary text-xl mb-3">
              KR
            </div>
            <p className="font-black text-base">Kody Robinson</p>
            <p className="text-xs text-muted-foreground">kodyrobinson02@gmail.com</p>
            <div className="flex gap-4 mt-4">
              {[{ v: '2.4k', l: 'Tracks' }, { v: '47', l: 'Playlists' }, { v: '12', l: 'Imports' }].map(({ v, l }) => (
                <div key={l} className="text-center">
                  <p className="font-black font-mono text-sm">{v}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Tile>
    </div>
  );
}

// ── 11 · GLASS & ELEVATION ────────────────────────────────────────────────────

function ElevationSection() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Tile label="Glass Surfaces">
        <div className="relative rounded-2xl overflow-hidden h-32">
          <div className="absolute inset-0 brand-gradient opacity-30" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="glass rounded-2xl border border-white/10 px-6 py-4 text-center backdrop-blur-xl">
              <p className="font-black text-sm">Glass Surface</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">backdrop-blur · bg/opacity</p>
            </div>
          </div>
        </div>
      </Tile>

      <Tile label="Dividers">
        <div className="space-y-4 py-2">
          <div className="h-px bg-[var(--color-border-subtle)]" />
          <div className="h-px bg-gradient-to-r from-primary/60 via-secondary/30 to-transparent" />
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] to-transparent" />
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">OR</span>
            <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>
        </div>
      </Tile>

      <Tile label="Glow / Neon Effects">
        <div className="space-y-3">
          <p className="text-xl font-black neon-text-blue text-primary">Neon Blue Primary</p>
          <p className="text-xl font-black neon-text-purple text-secondary">Neon Purple Secondary</p>
          <button className="w-full rounded-2xl bg-primary px-4 py-2.5 text-sm font-black text-white shadow-primary-selection hover:shadow-[0_0_32px_rgba(var(--color-brand-primary-rgb)/0.6)] transition-all">
            Primary Glow Button
          </button>
          <div className="rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3 shadow-primary-banner">
            <p className="text-sm font-bold text-primary">Primary Banner Shadow</p>
          </div>
        </div>
      </Tile>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export function ReusableComponentsView() {
  const sections = [
    { index: '01', label: 'Color System', desc: 'Design tokens, palette, and semantic colors', content: <ColorSection /> },
    { index: '02', label: 'Typography', desc: 'Type scale, weights, and text treatments', content: <TypographySection /> },
    { index: '03', label: 'Buttons', desc: 'Primary, secondary, ghost, icon, and state variants', content: <ButtonsSection /> },
    { index: '04', label: 'Inputs & Forms', desc: 'Text, search, select, textarea, and validation states', content: <InputsSection /> },
    { index: '05', label: 'Badges & Indicators', desc: 'Status pills, analysis badges, and dot indicators', content: <BadgesSection /> },
    { index: '06', label: 'Feedback & Status', desc: 'Progress, toasts, loaders, banners, and alerts', content: <FeedbackSection /> },
    { index: '07', label: 'Waveform', desc: 'Decorative and canvas-rendered waveform components', content: <WaveformSection /> },
    { index: '08', label: 'Data Display', desc: 'Track rows, stat tiles, playlist cards, and empty states', content: <DataSection /> },
    { index: '09', label: 'Navigation', desc: 'Sidebar, tabs, segmented controls, and USB connection', content: <NavigationSection /> },
    { index: '10', label: 'Avatar', desc: 'Initials, icons, rings, and profile cards', content: <AvatarSection /> },
    { index: '11', label: 'Glass & Elevation', desc: 'Surfaces, dividers, shadows, and neon effects', content: <ElevationSection /> },
  ];

  return (
    <div className="pb-16 space-y-16">
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden border border-[var(--color-border-subtle)]">
        <div className="absolute inset-0 brand-gradient opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-secondary/10 via-transparent to-transparent" />
        <div className="relative px-8 py-10 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground/60">Design System</span>
              <span className="h-px w-8 bg-[var(--color-border-subtle)]" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-primary/60">v2.0</span>
            </div>
            <h1 className="text-4xl font-black">
              Drop<span className="text-primary neon-text-blue">Dex</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-xs">
              A living reference of every UI component, token, and pattern used across the application.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-1 text-right">
            <p className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest">{sections.length} sections</p>
            <p className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest">Live components</p>
          </div>
        </div>
      </div>

      {/* Sections */}
      {sections.map(({ index, label, desc, content }) => (
        <section key={index}>
          <SectionHeader index={index} label={label} description={desc} />
          {content}
        </section>
      ))}
    </div>
  );
}
