import { ProfileSwitch } from './ProfileSwitch';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { NavArrowDown, NavArrowRight, Trash } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { getLogEntries, subscribeToLogs, clearLogEntries, type LogEntry, type LogLevel } from '../../lib/logger';
import { clearFlipLabStemCache } from '../flip-lab/flipLabSeparation';
import { ControlButton, SearchControl, SelectControl } from '../ui/controls';
import { NoticeCard, StatusBadge } from '../ui/feedback';
import type { SemanticTone } from '../ui/feedback/types';

// ── Flip Lab stem cache ───────────────────────────────────────────────────────

function FlipLabStemCachePanel() {
  const [status, setStatus] = useState<'idle' | 'clearing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const handleEmpty = useCallback(async () => {
    setStatus('clearing');
    setMessage(null);
    const result = await clearFlipLabStemCache();
    setStatus(result.ok ? 'done' : 'error');
    setMessage(result.ok ? 'Stem cache emptied.' : `Couldn't empty the stem cache. ${result.message ?? ''}`.trim());
  }, []);

  return (
    <section className="profile-group">
      <h2 className="profile-heading">
        <span className="w-2 h-2 rounded-full bg-secondary/60 inline-block" />
        Flip Lab
      </h2>
      <SurfaceCard as="div" className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Empty Stem Cache</p>
          <p className="text-xs text-muted-foreground">
            Deletes every vocal and instrumental stem Flip Lab has saved on this computer. Tracks will be separated again the next time you press Flip.
          </p>
        </div>
        <ControlButton
          variant="danger-outline"
          data-testid="empty-stem-cache"
          onClick={() => { void handleEmpty(); }}
          disabled={status === 'clearing'}
        >
          <Trash width={14} height={14} aria-hidden="true" /> {status === 'clearing' ? 'Emptying…' : 'Empty Stem Cache'}
        </ControlButton>
      </SurfaceCard>
      {message && <NoticeCard tone={status === 'error' ? 'error' : 'success'}>{message}</NoticeCard>}
    </section>
  );
}

// ── Import event filter config ────────────────────────────────────────────────

const IMPORT_TRACK_EVENTS: Array<{ key: string; label: string; description: string }> = [
  { key: 'track.start',                label: 'Track Start',         description: 'Emitted when each track begins processing during an import.' },
  { key: 'track.asset_download_failed', label: 'Asset Download Failed', description: 'Emitted when an ANLZ asset (.dat/.ext/.2ex) fails to download for a track.' },
  { key: 'track.parse_failed',          label: 'Parse Failed',        description: 'Emitted when the bundle parser throws an error for a track.' },
  { key: 'track.complete',              label: 'Track Complete',       description: 'Emitted after each track finishes processing, with status and timing.' },
];

const DISABLED_EVENTS_KEY = 'dropdex:dev:disabled-import-events';

function readDisabledEvents(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_EVENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function writeDisabledEvents(disabled: Set<string>): void {
  try {
    localStorage.setItem(DISABLED_EVENTS_KEY, JSON.stringify([...disabled]));
  } catch { /* ignore */ }
}

// ── Component classification ──────────────────────────────────────────────────

type LogComponent = 'All' | 'Rekordbox' | 'Library' | 'Audition' | 'Drop Lab' | 'Flip Lab' | 'Supabase' | 'Discovery' | 'USB' | 'Preview' | 'Auth' | 'React' | 'Browser' | 'App';

const COMPONENTS: LogComponent[] = ['All', 'Rekordbox', 'Library', 'Audition', 'Drop Lab', 'Flip Lab', 'Supabase', 'Discovery', 'USB', 'Preview', 'Auth', 'React', 'Browser', 'App'];

function classifyComponent(message: string): Exclude<LogComponent, 'All'> {
  if (message.startsWith('api.') || message.startsWith('rekordbox.')) return 'Rekordbox';
  if (message.startsWith('library.')) return 'Library';
  if (message.startsWith('audition.')) return 'Audition';
  if (message.startsWith('droplab.')) return 'Drop Lab';
  if (message.startsWith('fliplab.')) return 'Flip Lab';
  if (message.startsWith('supabase.')) return 'Supabase';
  if (message.startsWith('discovery.')) return 'Discovery';
  if (message.startsWith('usb.')) return 'USB';
  if (message.startsWith('preview.')) return 'Preview';
  if (message.startsWith('auth.')) return 'Auth';
  if (message.startsWith('react.')) return 'React';
  if (message.startsWith('window.')) return 'Browser';
  return 'App';
}

// ── Level badge ───────────────────────────────────────────────────────────────

const LEVEL_TONES: Record<LogLevel, SemanticTone> = {
  debug: 'neutral',
  info: 'active',
  warn: 'warning',
  error: 'error',
};

function LevelBadge({ level }: { level: LogLevel }) {
  return <StatusBadge tone={LEVEL_TONES[level]} className="shrink-0">{level}</StatusBadge>;
}

// ── Single log row ────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasContext = entry.context && Object.keys(entry.context).length > 0;
  const time = entry.timestamp.replace('T', ' ').replace('Z', '').slice(0, 23);

  return (
    <div className="border-b border-[var(--color-border-faint)] last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="profile-log-row flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded
            ? <NavArrowDown width={11} height={11} aria-hidden="true" />
            : <NavArrowRight width={11} height={11} aria-hidden="true" />}
        </span>
        <LevelBadge level={entry.level} />
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{time}</span>
        <span className="text-xs font-semibold text-foreground truncate min-w-0">{entry.message}</span>
        {hasContext && !expanded && (
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground font-mono opacity-50">
            {Object.keys(entry.context!).join(', ')}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-8 pb-3 space-y-0.5">
          <SurfaceCard as="div" className="divide-y divide-[var(--color-border-faint)]">
            {/* Timestamp & level */}
            <FieldRow label="timestamp" value={entry.timestamp} />
            <FieldRow label="level" value={entry.level} />
            <FieldRow label="message" value={entry.message} />
            {hasContext && Object.entries(entry.context!).map(([k, v]) => (
              <FieldRow key={k} label={k} value={v} />
            ))}
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  const display = typeof value === 'object' && value !== null
    ? JSON.stringify(value, null, 2)
    : String(value ?? '');
  const multiline = display.includes('\n');

  return (
    <div className={cn('px-3 py-1.5 flex gap-3 min-w-0', multiline ? 'flex-col' : 'items-baseline')}>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 w-28">{label}</span>
      <span className={cn('text-xs font-mono text-foreground break-all', multiline && 'whitespace-pre-wrap')}>
        {display}
      </span>
    </div>
  );
}

// ── Developer tab ─────────────────────────────────────────────────────────────

const LEVEL_OPTIONS: Array<'All' | LogLevel> = ['All', 'error', 'warn', 'info', 'debug'];
const LEVEL_LABELS: Record<'All' | LogLevel, string> = {
  All: 'All Levels', error: 'Error', warn: 'Warning', info: 'Info', debug: 'Debug',
};

export function DeveloperTab() {
  const [renderCount, forceRender] = useState(0);
  const [search, setSearch] = useState('');
  const [component, setComponent] = useState<LogComponent>('All');
  const [level, setLevel] = useState<'All' | LogLevel>('All');
  const [disabledEvents, setDisabledEvents] = useState<Set<string>>(readDisabledEvents);

  useEffect(() => subscribeToLogs(() => forceRender((n) => n + 1)), []);

  const toggleEvent = useCallback((key: string) => {
    setDisabledEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeDisabledEvents(next);
      return next;
    });
  }, []);

  const entries = getLogEntries();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries].reverse().filter((e) => {
      if (disabledEvents.has(e.message)) return false;
      if (level !== 'All' && e.level !== level) return false;
      if (component !== 'All' && classifyComponent(e.message) !== component) return false;
      if (q) {
        const haystack = `${e.message} ${JSON.stringify(e.context ?? {})}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [search, component, level, disabledEvents, renderCount]);

  const handleClear = useCallback(() => { clearLogEntries(); }, []);

  return (
    <div className="profile-stack">
      <FlipLabStemCachePanel />

      {/* ── Import event filters group ── */}
      <section className="profile-group">
        <h2 className="profile-heading">
          <span className="w-2 h-2 rounded-full bg-amber-400/60 inline-block" />
          Import Event Filters
        </h2>
        <SurfaceCard as="div" className="profile-records divide-y divide-[var(--color-border-faint)]">
          {IMPORT_TRACK_EVENTS.map(({ key, label, description }) => {
            const enabled = !disabledEvents.has(key);
            return (
              <div key={key} className="profile-record flex items-center gap-3">
                <ProfileSwitch
                  checked={enabled}
                  aria-label={label}
                  onClick={() => toggleEvent(key)}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs font-semibold leading-tight', enabled ? 'text-foreground' : 'text-muted-foreground')}>
                    {label}
                    <span className="ml-2 text-[9px] font-mono text-muted-foreground/60">{key}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
                </div>
                <span className={cn('text-[9px] font-bold uppercase tracking-wider shrink-0', enabled ? 'text-primary' : 'text-muted-foreground/40')}>
                  {enabled ? 'On' : 'Off'}
                </span>
              </div>
            );
          })}
        </SurfaceCard>
        <p className="text-[10px] text-muted-foreground/60 px-1 leading-relaxed">
          Toggles here filter these event types from the log viewer below. State is saved across reloads.
        </p>
      </section>

      {/* ── Logger group ── */}
      <section className="profile-group">
        <h2 className="profile-heading">
          <span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />
          Logger
        </h2>

        <SurfaceCard as="div" className="profile-records">
          {/* Filter row */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border-faint)] flex-wrap">
            {/* Search */}
            <div className="flex-1 min-w-40">
              <SearchControl
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs…"
                aria-label="Search logs"
              />
            </div>

            {/* Component dropdown */}
            <div className="min-w-36">
              <SelectControl aria-label="Log component" value={component} onChange={(e) => setComponent(e.target.value as LogComponent)}>
                {COMPONENTS.map((c) => (
                  <option key={c} value={c}>{c === 'All' ? 'All Components' : c}</option>
                ))}
              </SelectControl>
            </div>

            {/* Level dropdown */}
            <div className="min-w-28">
              <SelectControl aria-label="Log level" value={level} onChange={(e) => setLevel(e.target.value as 'All' | LogLevel)}>
                {LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </SelectControl>
            </div>

            {/* Clear */}
            <ControlButton
              variant="danger-outline"
              onClick={handleClear}
              title="Clear all logs"
            >
              <Trash width={14} height={14} aria-hidden="true" />
              Clear
            </ControlButton>

            <span className="text-[9px] font-mono text-muted-foreground opacity-60 shrink-0">
              {filtered.length} / {entries.length}
            </span>
          </div>

          {/* Log list */}
          <div className="max-h-[520px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                {entries.length === 0 ? 'No log entries yet.' : 'No entries match the current filters.'}
              </div>
            ) : (
              filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
            )}
          </div>
        </SurfaceCard>
      </section>
    </div>
  );
}
