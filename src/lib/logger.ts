type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const prefix = `[DropDex:${level.toUpperCase()}] ${new Date().toISOString()}`;
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
