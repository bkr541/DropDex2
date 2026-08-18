import { CircleDash, Renew, SearchLocate, WarningAlt } from '@carbon/icons-react';
import { ControlButton } from './ui/controls';

export function RouteLoadingState({ label = 'Loading screen…' }: { label?: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center py-16" role="status" aria-live="polite">
      <div className="text-center">
        <CircleDash className="mx-auto animate-spin text-primary" size={30} />
        <p className="mt-3 text-sm font-bold text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function RouteNotFoundState({
  title,
  message,
  onReturnToLibrary,
}: {
  title: string;
  message: string;
  onReturnToLibrary: () => void;
}) {
  return (
    <div className="flex min-h-[320px] items-center justify-center py-16">
      <section className="max-w-md text-center" role="alert">
        <SearchLocate className="mx-auto text-muted-foreground" size={42} />
        <h2 className="mt-4 text-2xl font-black">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onReturnToLibrary}
          className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white"
        >
          Return to Book
        </button>
      </section>
    </div>
  );
}

export function RouteLoadErrorState({ message, onRetry, onReturnToLibrary }: { message: string; onRetry: () => void; onReturnToLibrary: () => void }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center py-16">
      <section className="max-w-md text-center" role="alert">
        <WarningAlt className="mx-auto text-red-400" size={42} />
        <h2 className="mt-4 text-2xl font-black">This screen could not be loaded</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <ControlButton type="button" variant="primary" onClick={onRetry} className="w-auto px-4 py-2 text-sm min-h-0"><Renew size={14} /> Retry</ControlButton>
          <button type="button" onClick={onReturnToLibrary} className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-bold">Return to Book</button>
        </div>
      </section>
    </div>
  );
}
