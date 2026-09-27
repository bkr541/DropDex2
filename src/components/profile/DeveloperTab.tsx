import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Search, TrashCan } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { getLogEntries, subscribeToLogs, clearLogEntries, type LogEntry, type LogLevel } from '../../lib/logger';
import { RouletteDiagnosticsPanel } from './RouletteDiagnosticsPanel';

// ── Component classification ──────────────────────────────────────────────────

type LogComponent = 'All' | 'Rekordbox' | 'Supabase' | 'React' | 'Browser' | 'App';

const COMPONENTS: LogComponent[] = ['All', 'Rekordbox', 'Supabase', 'React', 'Browser', 'App'];

function classifyComponent(message: string): Exclude<LogComponent, 'All'> {
  if (message.startsWith('api.')) return 'Rekordbox';
  if (message.startsWith('supabase.')) return 'Supabase';
  if (message.startsWith('react.')) return 'React';
  if (message.startsWith('window.')) return 'Browser';
  return 'App';
}

// ── Level badge ───────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'bg-muted text-muted-foreground',
  info:  'bg-blue-500/15 text-blue-400',
  warn:  'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
};

function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0', LEVEL_COLORS[level])}>
      {level}
    </span>
  );
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
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded
            ? <ChevronDown size={11} />
            : <ChevronRight size={11} />}
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
          <div className="glass rounded-xl overflow-hidden divide-y divide-[var(--color-border-faint)]">
            {/* Timestamp & level */}
            <FieldRow label="timestamp" value={entry.timestamp} />
            <FieldRow label="level" value={entry.level} />
            <FieldRow label="message" value={entry.message} />
            {hasContext && Object.entries(entry.context!).map(([k, v]) => (
              <FieldRow key={k} label={k} value={v} />
            ))}
          </div>
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

  useEffect(() => subscribeToLogs(() => forceRender((n) => n + 1)), []);

  const entries = getLogEntries();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries].reverse().filter((e) => {
      if (level !== 'All' && e.level !== level) return false;
      if (component !== 'All' && classifyComponent(e.message) !== component) return false;
      if (q) {
        const haystack = `${e.message} ${JSON.stringify(e.context ?? {})}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [search, component, level, renderCount]);

  const handleClear = useCallback(() => { clearLogEntries(); }, []);

  const selectClass = 'bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg py-1.5 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground transition-all appearance-none cursor-pointer';

  return (
    <section className="space-y-6">
      {/* ── Roulette Diagnostics group ── */}
      <RouletteDiagnosticsPanel />

      {/* ── Logger group ── */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />
          Logger
        </h2>

        <div className="glass rounded-2xl overflow-hidden">
          {/* Filter row */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border-faint)] flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-40">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs…"
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Component dropdown */}
            <div className="relative">
              <select value={component} onChange={(e) => setComponent(e.target.value as LogComponent)} className={selectClass}>
                {COMPONENTS.map((c) => (
                  <option key={c} value={c}>{c === 'All' ? 'All Components' : c}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            {/* Level dropdown */}
            <div className="relative">
              <select value={level} onChange={(e) => setLevel(e.target.value as 'All' | LogLevel)} className={selectClass}>
                {LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            {/* Clear */}
            <button
              type="button"
              onClick={handleClear}
              title="Clear all logs"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-red-400 hover:bg-red-500/10 border border-[var(--color-border-subtle)] transition-colors"
            >
              <TrashCan size={11} />
              Clear
            </button>

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
        </div>
      </div>
    </section>
  );
}
