import { useState } from 'react';
import {
  Music, Settings,
  ChevronRight, ChevronLeft, User, TrendingUp,
  Layers, Play, Pause, Square, Volume2, VolumeX, SkipBack, SkipForward,
  ListMusic, ExternalLink, Shuffle, Repeat2,
  Star, MoreHorizontal, LayoutGrid, Library, AudioWaveform, DiscAlbum,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { TrackAnalysisStatusBadge } from '../library/TrackAnalysisStatusBadge';
import { WaveformDisplay } from '../library/WaveformDisplay';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { Stage1Showcase } from './Stage1Showcase';
import { Stage2Showcase } from './Stage2Showcase';

// ── waveform mock states ───────────────────────────────────────────────────────

const SEED = 'dropdex-reusable-demo';

const WF_LOADING: WaveformLoadState    = { status: 'loading',     trackId: 'demo' };
const WF_UNAVAIL: WaveformLoadState    = { status: 'unavailable', trackId: 'demo' };
const WF_ERROR: WaveformLoadState      = { status: 'error',   trackId: 'demo', error: 'Network timeout', retryable: true };
const WF_INVALID: WaveformLoadState    = { status: 'invalid', trackId: 'demo', error: 'Unsupported format', reason: 'unsupported', retryable: false };

// ── cell wrapper ──────────────────────────────────────────────────────────────

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-card)] p-4 min-w-0', className)}>
      <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60 shrink-0">{label}</p>
      <div className="flex flex-col gap-2 min-w-0">{children}</div>
    </div>
  );
}

// ── section header ─────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/50 shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-[var(--color-border-faint)]" />
    </div>
  );
}

// ── STAGE 1 — INPUTS, BUTTONS & FORM CONTROLS ────────────────────────────────

function StageOneSection() {
  return <Stage1Showcase />;
}

// ── STAGE 2 — STATUS, FEEDBACK, PROGRESS, UPLOADS & MODALS ───────────────────

function StageTwoSection() {
  return <Stage2Showcase />;
}

// ── WAVEFORM & TRANSPORT ──────────────────────────────────────────────────────

function WaveformSection() {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cell label="Play / Pause Button">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlaying(!playing)}
              className="w-10 h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-foreground hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <button className="w-10 h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-colors">
              <Square size={14} fill="currentColor" />
            </button>
            <button
              onClick={() => setMuted(!muted)}
              className="w-10 h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </Cell>

        <Cell label="Media Transport Control Group" className="md:col-span-2">
          <div className="flex items-center justify-center gap-2">
            <button className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <SkipBack size={14} fill="currentColor" />
            </button>
            <button className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft size={14} />
            </button>
            <button className="w-12 h-12 rounded-xl bg-foreground flex items-center justify-center text-background hover:opacity-90 transition-opacity shadow-lg">
              <Play size={18} fill="currentColor" />
            </button>
            <button className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight size={14} />
            </button>
            <button className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <SkipForward size={14} fill="currentColor" />
            </button>
          </div>
        </Cell>

        <Cell label="Transport Add-ons">
          <div className="flex gap-2 flex-wrap">
            <button className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors">
              <Shuffle size={11} /> SHUFFLE
            </button>
            <button className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[9px] font-bold text-primary transition-colors">
              <Repeat2 size={11} /> REPEAT
            </button>
            <button className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink size={11} />
            </button>
          </div>
        </Cell>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Cell label="Waveform — Decorative (primary)">
          <div className="h-14 w-full waveform-surface rounded-lg overflow-hidden">
            <WaveformDisplay seed={SEED} barCount={80} color="primary" showFallbackLabel={false} />
          </div>
        </Cell>
        <Cell label="Waveform — Decorative (secondary)">
          <div className="h-14 w-full waveform-surface rounded-lg overflow-hidden">
            <WaveformDisplay seed={`${SEED}-2`} barCount={80} color="secondary" showFallbackLabel={false} />
          </div>
        </Cell>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Cell label="Waveform — With Visualizer Label">
          <div className="h-14 w-full waveform-surface rounded-lg overflow-hidden">
            <WaveformDisplay seed={`${SEED}-3`} barCount={60} showFallbackLabel />
          </div>
        </Cell>
        <Cell label="Interactive / Seekable Waveform">
          <div className="relative h-14 w-full waveform-surface rounded-lg overflow-hidden cursor-pointer group">
            <WaveformDisplay seed={`${SEED}-4`} barCount={100} color="primary" showFallbackLabel={false} />
            <div className="absolute inset-y-0 left-[30%] w-px bg-primary shadow-[0_0_6px_rgba(207,107,101,0.8)]" />
            <div className="absolute bottom-1 left-[28%] text-[9px] font-mono text-primary/80">1:20</div>
            <div className="absolute bottom-1 left-[28%] translate-x-4 text-[9px] font-mono font-bold text-primary">2:00</div>
            <div className="absolute bottom-1 right-2 text-[9px] font-mono text-muted-foreground">3:40</div>
          </div>
        </Cell>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cell label="Rekordbox Waveform — Loading">
          <RekordboxPreviewWaveform state={WF_LOADING} height={40} variant="compact" />
        </Cell>
        <Cell label="Rekordbox Waveform — Unavailable">
          <RekordboxPreviewWaveform state={WF_UNAVAIL} height={40} variant="compact" />
        </Cell>
        <Cell label="Rekordbox Waveform — Error">
          <RekordboxPreviewWaveform state={WF_ERROR} height={40} variant="compact" onRetry={() => {}} />
        </Cell>
        <Cell label="Rekordbox Waveform — Invalid">
          <RekordboxPreviewWaveform state={WF_INVALID} height={40} variant="compact" />
        </Cell>
      </div>
    </>
  );
}

// ── TRACK ROWS & TABLE ────────────────────────────────────────────────────────

function TrackSection() {
  const tracks = [
    { n: 1, title: 'Midnight Roller', artist: 'Camelot',          bpm: 128, key: '8A', time: '06:35', stars: 3 },
    { n: 2, title: 'Innerbloom (Extended Mix)', artist: 'RÜFÜS DU SOL', bpm: 124, key: '7A', time: '07:12', stars: 5 },
    { n: 3, title: 'The Cave',         artist: 'Maya Jane Coles',  bpm: 125, key: '8A', time: '06:57', stars: 3 },
    { n: 4, title: 'Higher Place',     artist: 'Kölsch',           bpm: 126, key: '7A', time: '07:12', stars: 3 },
    { n: 5, title: 'Halcyon',          artist: 'Orbital',          bpm: 128, key: '8A', time: '06:35', stars: 5 },
  ];
  const [active, setActive] = useState<number | null>(2);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Cell label="Hover Track Row">
          <div className="space-y-1">
            {['Midnight Roller — Camelot', 'Higher Place — Kölsch'].map((t) => {
              const [title, artist] = t.split(' — ');
              return (
                <div key={t} className="group flex items-center gap-3 rounded-xl border border-transparent bg-[var(--color-surface)] px-3 py-2.5 hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-all">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/10 flex items-center justify-center text-[9px] font-black text-primary shrink-0">
                    {(artist[0] + (artist[1] || '')).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate">{title}</p>
                    <p className="text-[10px] text-muted-foreground uppercase truncate">{artist}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] font-bold">128</span>
                    <span className="font-mono text-[10px] font-bold text-primary">8A</span>
                    <span className="text-[10px] text-muted-foreground">06:35</span>
                    <div className="h-6 w-12 opacity-0 group-hover:opacity-100 transition-opacity">
                      <WaveformDisplay seed={title} barCount={30} color="primary" showFallbackLabel={false} />
                    </div>
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Cell>

        <Cell label="Active Track Row">
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/6 px-3 py-2.5 cursor-pointer">
            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Play size={14} fill="white" className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground truncate">Midnight Roller</p>
              <p className="text-[10px] text-muted-foreground uppercase truncate">Camelot</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10px] font-bold">128</span>
              <span className="font-mono text-[10px] font-bold text-primary">8A</span>
              <span className="text-[10px] text-muted-foreground">06:35</span>
              <div className="h-6 w-12">
                <WaveformDisplay seed="active" barCount={30} color="primary" showFallbackLabel={false} />
              </div>
              <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal size={13} /></button>
            </div>
          </div>
        </Cell>
      </div>

      <Cell label="Data Table / Track Table">
        <div className="rounded-xl border border-[var(--color-border-subtle)] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                {['#', 'Track Name', 'Artist', 'BPM', 'Key', 'Time', 'Rating', 'Genre', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracks.map((tr) => (
                <tr
                  key={tr.n}
                  onClick={() => setActive(tr.n)}
                  className={cn('border-b border-[var(--color-border-faint)] last:border-0 cursor-pointer transition-colors', active === tr.n ? 'bg-primary/6' : 'hover:bg-[var(--color-surface)]')}
                >
                  <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground">{tr.n}</td>
                  <td className="px-3 py-2 text-xs font-bold truncate max-w-[140px]">{tr.title}</td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground truncate max-w-[120px]">{tr.artist}</td>
                  <td className="px-3 py-2 text-[10px] font-mono font-bold">{tr.bpm}</td>
                  <td className="px-3 py-2 text-[10px] font-mono font-bold text-primary">{tr.key}</td>
                  <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground">{tr.time}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map((s) => (
                        <Star key={s} size={9} className={s <= tr.stars ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30'} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground">Tech House</td>
                  <td className="px-3 py-2 text-muted-foreground hover:text-foreground"><MoreHorizontal size={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cell>

      <Cell label="Sticky Action / Transport Dock">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-card)] px-4 py-3 flex items-center gap-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary shrink-0 flex items-center justify-center">
            <Music size={13} className="text-white" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-[10px] font-black truncate">Midnight Roller</p>
            <p className="text-[9px] text-muted-foreground font-mono">128 BPM · 8A · 06:35</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button className="w-7 h-7 rounded-lg bg-[var(--color-surface)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><SkipBack size={12} fill="currentColor" /></button>
            <button className="w-7 h-7 rounded-lg bg-[var(--color-surface)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft size={12} /></button>
            <button className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center text-background hover:opacity-90 transition-opacity"><Play size={13} fill="currentColor" /></button>
            <button className="w-7 h-7 rounded-lg bg-[var(--color-surface)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronRight size={12} /></button>
            <button className="w-7 h-7 rounded-lg bg-[var(--color-surface)] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><SkipForward size={12} fill="currentColor" /></button>
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-[9px] font-mono text-muted-foreground shrink-0">1:47</span>
            <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface)] overflow-hidden">
              <div className="h-full w-[46%] bg-gradient-to-r from-primary to-secondary rounded-full" />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground shrink-0">3:56</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] font-mono font-bold text-primary">8A</span>
            <button className="text-muted-foreground hover:text-foreground"><Volume2 size={13} /></button>
            <div className="w-12 h-1 rounded-full bg-[var(--color-surface)] overflow-hidden">
              <div className="h-full w-3/4 bg-emerald-400 rounded-full" />
            </div>
            <button className="text-muted-foreground hover:text-foreground"><Settings size={12} /></button>
          </div>
        </div>
      </Cell>
    </>
  );
}

// ── CARDS ─────────────────────────────────────────────────────────────────────

function CardsSection() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Cell label="Glass Card">
        <div className="glass rounded-xl border border-[var(--color-border-subtle)] p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-black">Midnight Drive</p>
                <p className="text-[10px] text-muted-foreground">Arc North</p>
              </div>
              <button className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center text-background">
                <Play size={12} fill="currentColor" />
              </button>
            </div>
            <div className="h-10 w-full mb-2 waveform-surface rounded-lg overflow-hidden">
              <WaveformDisplay seed="glass-card" barCount={60} color="primary" showFallbackLabel={false} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[9px] font-mono font-bold">128 BPM</span>
              <span className="w-2 h-2 rounded-full bg-secondary" />
              <span className="text-[9px] font-mono font-bold text-secondary">8A</span>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground">03:42</span>
            </div>
          </div>
        </div>
      </Cell>

      <Cell label="Surface Card">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-black">Solaris</p>
              <p className="text-[10px] text-muted-foreground">Bicep</p>
            </div>
            <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal size={14} /></button>
          </div>
          <div className="h-8 w-full mb-2 rounded overflow-hidden">
            <WaveformDisplay seed="surface-card" barCount={60} color="secondary" showFallbackLabel={false} />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-[9px] font-mono font-bold">126 BPM</span>
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-[9px] font-mono font-bold text-purple-400">7A</span>
            <span className="ml-auto text-[9px] font-mono text-muted-foreground">05:16</span>
          </div>
        </div>
      </Cell>

      <Cell label="Stat Tile / KPI">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <p className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Total Played</p>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-3xl font-black tabular-nums leading-none">12.4K</span>
            <span className="text-xs font-bold text-emerald-400 mb-1">▲ 12.5%</span>
          </div>
          <div className="flex items-end gap-0.5 h-10">
            {[0.4, 0.6, 0.5, 0.7, 0.8, 0.65, 0.55, 0.75, 0.9, 0.85, 0.7, 1].map((h, i) => (
              <div key={i} className={cn('flex-1 rounded-sm transition-all', i === 11 ? 'bg-primary' : 'bg-[var(--color-surface-hover)]')} style={{ height: `${h * 100}%` }} />
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">vs last 30 days</p>
        </div>
      </Cell>

      <Cell label="Playlist Card">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden">
          <div className="p-4 pb-3">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-black leading-snug">Tech House Grooves</p>
                <p className="text-[10px] text-muted-foreground">by Deep Motion</p>
              </div>
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                <ListMusic size={10} /> 32 TRACKS · 2h 18m
              </div>
            </div>
            {[
              { n: 1, title: 'Innerbloom', artist: 'RÜFÜS DU SOL', key: '7A' },
              { n: 2, title: 'The Cave',   artist: 'Maya Jane Coles', key: '8A' },
              { n: 3, title: 'Higher Place', artist: 'Kölsch',        key: '7A' },
            ].map(({ n, title, artist, key }) => (
              <div key={n} className="flex items-center gap-2 py-1">
                <span className="text-[9px] font-mono text-muted-foreground/50 w-3">{n}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold truncate">{title}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{artist}</p>
                </div>
                <span className="text-[9px] font-mono font-bold text-primary shrink-0">{key}</span>
              </div>
            ))}
          </div>
          <button className="w-full flex items-center justify-center gap-1 py-2.5 border-t border-[var(--color-border-faint)] text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-colors">
            VIEW PLAYLIST <ChevronRight size={11} />
          </button>
        </div>
      </Cell>

      <Cell label="Artwork / Thumbnail">
        <div className="aspect-square w-full max-w-[120px] mx-auto rounded-xl overflow-hidden border border-[var(--color-border-subtle)] bg-gradient-to-br from-primary/20 via-secondary/10 to-purple-500/20 flex items-center justify-center relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 border-2 border-primary/40 rotate-45 rounded-lg flex items-center justify-center">
              <div className="w-8 h-8 border border-secondary/40 rotate-0 rounded-md" />
            </div>
          </div>
          <button className="relative z-10 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors">
            <Play size={14} fill="white" />
          </button>
        </div>
      </Cell>

      <Cell label="Artwork with Fallback">
        <div className="aspect-square w-full max-w-[120px] mx-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] flex flex-col items-center justify-center gap-2">
          <DiscAlbum size={28} className="text-muted-foreground/30" />
          <p className="text-[10px] font-semibold text-muted-foreground">No Artwork</p>
          <p className="text-[9px] text-muted-foreground/60">Track unavailable</p>
        </div>
      </Cell>
    </div>
  );
}

// ── AVATAR ────────────────────────────────────────────────────────────────────

function AvatarSection() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Cell label="Avatar — Initials">
        <div className="flex items-center gap-3">
          {[
            { init: 'DM', size: 'w-10 h-10 text-sm' },
            { init: 'KR', size: 'w-12 h-12 text-base' },
            { init: 'AB', size: 'w-16 h-16 text-lg' },
          ].map(({ init, size }) => (
            <div key={init} className={cn('rounded-full bg-gradient-to-br from-primary/30 to-secondary/20 border-2 border-primary/30 flex items-center justify-center font-black text-primary', size)}>
              {init}
            </div>
          ))}
        </div>
      </Cell>

      <Cell label="Avatar — Icon Fallback">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center">
            <User size={24} className="text-muted-foreground/50" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center">
            <User size={18} className="text-muted-foreground/50" />
          </div>
        </div>
      </Cell>

      <Cell label="Avatar with Ring">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/25 to-secondary/15 border-2 border-primary/30 flex items-center justify-center">
              <AudioWaveform size={22} className="text-primary" />
            </div>
            <div className="absolute inset-[-4px] rounded-full border border-primary/20 pointer-events-none" />
            <div className="absolute inset-[-9px] rounded-full border border-primary/10 pointer-events-none" />
          </div>
          <div className="relative">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500/20 via-orange-500/20 to-yellow-500/20 flex items-center justify-center border-2 border-orange-400/40">
              <AudioWaveform size={22} className="text-orange-400" />
            </div>
            <div className="absolute inset-[-4px] rounded-full border border-orange-400/20 pointer-events-none" />
          </div>
        </div>
      </Cell>

      <Cell label="Image Avatar">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 border-2 border-[var(--color-border-subtle)] overflow-hidden flex items-center justify-center">
            <User size={28} className="text-slate-400" strokeWidth={1.5} />
          </div>
          <div className="space-y-0.5">
            <p className="text-xs font-bold">DJ Kody</p>
            <p className="text-[10px] text-muted-foreground">2,412 tracks</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-bold text-primary">PRO</span>
          </div>
        </div>
      </Cell>
    </div>
  );
}

// ── TYPOGRAPHY ────────────────────────────────────────────────────────────────

function TypographySection() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Cell label="Headings">
        <h1 className="text-3xl font-black leading-tight">H1 Heading</h1>
        <h2 className="text-2xl font-black">H2 Heading</h2>
        <h3 className="text-xl font-bold">H3 Heading</h3>
        <h4 className="text-base font-bold">H4 Heading</h4>
        <h5 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">H5 HEADING</h5>
      </Cell>

      <Cell label="Body & Muted Text">
        <p className="text-sm">This is body text used for descriptions, details, and supporting information in the interface. It should be clear, legible, and easy to scan.</p>
        <p className="text-sm text-muted-foreground">Muted text is used for secondary information, less prominent details, or supporting content that does not require primary attention.</p>
        <p className="text-xs text-muted-foreground/60">Small muted — Timestamps, import dates, file sizes.</p>
      </Cell>

      <Cell label="Mono / Code Text">
        <div className="rounded-lg bg-black/40 border border-[var(--color-border-subtle)] p-3 font-mono text-[10px] space-y-1">
          {[
            { k: 'BPM',           v: '128',   vc: 'text-cyan-400' },
            { k: 'key',           v: '"8A"',  vc: 'text-emerald-400' },
            { k: 'time_signature',v: '"4/4"', vc: 'text-emerald-400' },
            { k: 'energy',        v: '0.78',  vc: 'text-orange-400' },
            { k: 'danceability',  v: '0.85',  vc: 'text-orange-400' },
            { k: 'loudness',      v: '-6.4',  vc: 'text-orange-400' },
          ].map(({ k, v, vc }, i) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground/40 w-4 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <span className="text-purple-300">{k}</span>
              <span className="text-muted-foreground"> = </span>
              <span className={vc}>{v}</span>
            </div>
          ))}
        </div>
      </Cell>

      <Cell label="Brand Text & Dividers">
        <div className="space-y-1">
          <p className="text-sm font-bold text-primary">Primary Accent</p>
          <p className="text-sm font-bold text-secondary">Secondary Accent</p>
          <p className="text-sm font-bold text-emerald-400">Success Accent</p>
          <p className="text-sm font-bold text-amber-400">Warning Accent</p>
          <p className="text-sm font-bold text-red-400">Danger Accent</p>
        </div>
        <div className="mt-2 space-y-2.5">
          <div className="h-px w-full bg-[var(--color-border-subtle)]" />
          <div className="h-px w-full border-t border-dashed border-[var(--color-border-subtle)]" />
          <div className="h-px w-full border-t border-dotted border-[var(--color-border-subtle)]" />
          <div className="h-px w-full bg-gradient-to-r from-primary/60 via-secondary/40 to-transparent" />
        </div>
      </Cell>
    </div>
  );
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────

function NavigationSection() {
  const [navActive, setNavActive] = useState('collection');
  const [tab1, setTab1] = useState('playlists');
  const [tab2, setTab2] = useState('all');
  const [tab3, setTab3] = useState('grid');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Cell label="Sidebar Nav Items">
        <div className="flex flex-col gap-0.5">
          {[
            { id: 'collection', icon: Library,      label: 'Collection' },
            { id: 'playlists',  icon: ListMusic,    label: 'Playlists'  },
            { id: 'tracks',     icon: Music,        label: 'Tracks'     },
            { id: 'analytics',  icon: TrendingUp,   label: 'Analytics'  },
            { id: 'settings',   icon: Settings,     label: 'Settings'   },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setNavActive(id)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left',
                navActive === id
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)]',
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </Cell>

      <Cell label="Tab Navigation">
        <div className="space-y-3">
          <div className="flex gap-px rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] overflow-hidden">
            {['PLAYLISTS', 'TRACKS', 'ALBUMS', 'ARTISTS', 'GENRES'].map((t) => (
              <button
                key={t}
                onClick={() => setTab1(t.toLowerCase())}
                className={cn(
                  'flex-1 py-2 text-[9px] font-bold uppercase tracking-wide transition-all',
                  tab1 === t.toLowerCase() ? 'bg-[var(--color-card)] text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface)]">
            {['All', 'Downloaded', 'Recently Played', 'Favorites', 'Offline'].map((t) => (
              <button
                key={t}
                onClick={() => setTab2(t.toLowerCase())}
                className={cn(
                  'flex-1 py-1.5 px-1 text-[9px] font-bold rounded-md whitespace-nowrap transition-all',
                  tab2 === t.toLowerCase() ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex gap-1 p-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {[
              { id: 'grid',    icon: LayoutGrid,    label: 'Grid'     },
              { id: 'list',    icon: Library,       label: 'List'     },
              { id: 'compact', icon: Layers,        label: 'Compact'  },
              { id: 'cards',   icon: DiscAlbum,     label: 'Cards'    },
              { id: 'wave',    icon: AudioWaveform, label: 'Waveform' },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTab3(id)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md transition-all',
                  tab3 === id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={12} />
                <span className="text-[7px] font-bold">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </Cell>
    </div>
  );
}

// ── main view ─────────────────────────────────────────────────────────────────

export function ReusableComponentsView() {
  return (
    <div className="space-y-8 pt-2 pb-12 md:max-w-[1480px] md:mx-auto">

      <section className="space-y-3">
        <SectionHeader>Inputs, Buttons & Form Controls</SectionHeader>
        <StageOneSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Status, Feedback, Progress, Uploads & Modals</SectionHeader>
        <StageTwoSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Waveform & Transport</SectionHeader>
        <WaveformSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Track Rows & Table</SectionHeader>
        <TrackSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Cards & Data Display</SectionHeader>
        <CardsSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Avatar</SectionHeader>
        <AvatarSection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Typography</SectionHeader>
        <TypographySection />
      </section>

      <section className="space-y-3">
        <SectionHeader>Navigation</SectionHeader>
        <NavigationSection />
      </section>

    </div>
  );
}
