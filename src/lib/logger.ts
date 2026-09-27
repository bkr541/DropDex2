export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

// ── In-memory ring buffer ─────────────────────────────────────────────────────

const MAX_ENTRIES = 500;
const _store: LogEntry[] = [];
const _listeners = new Set<() => void>();
let _seq = 0;

function _push(entry: LogEntry): void {
  _store.push(entry);
  if (_store.length > MAX_ENTRIES) _store.shift();
  _listeners.forEach((fn) => fn());
}

export function subscribeToLogs(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getLogEntries(): readonly LogEntry[] {
  return _store;
}

export function clearLogEntries(): void {
  _store.length = 0;
  _listeners.forEach((fn) => fn());
}

// ── Emit + store ──────────────────────────────────────────────────────────────

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const id = `${timestamp}-${++_seq}`;
  _push({ id, timestamp, level, message, context });
  const prefix = `[DropDex:${level.toUpperCase()}] ${timestamp}`;
  const args: unknown[] = context ? [prefix, message, context] : [prefix, message];
  // eslint-disable-next-line no-console
  console[level](...args);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info:  (message: string, context?: LogContext) => emit('info',  message, context),
  warn:  (message: string, context?: LogContext) => emit('warn',  message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};

// ── Supabase helper ───────────────────────────────────────────────────────────

export function logSupabaseError(operation: string, error: unknown, context?: LogContext): void {
  const err = error as { message?: string; code?: string; details?: string } | null;
  logger.error('supabase.error', {
    operation,
    message: err?.message ?? String(error),
    code: err?.code,
    details: err?.details,
    ...context,
  });
}
