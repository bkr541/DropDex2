import { AreaSearch, NavArrowLeft, Refresh, WarningTriangle } from 'iconoir-react/regular';
import { ControlButton } from './ui/controls';
import { PageSkeleton, type PageSkeletonVariant } from './ui/feedback';

export function RouteLoadingState({ label = 'Loading screen…', variant = 'listing' }: { label?: string; variant?: PageSkeletonVariant }) {
  return <PageSkeleton variant={variant} label={label} />;
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
        <AreaSearch className="mx-auto text-muted-foreground" width={42} height={42} aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-black">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-center">
          <ControlButton type="button" variant="primary" onClick={onReturnToLibrary}>
            <NavArrowLeft width={16} height={16} aria-hidden="true" /> Return to Library
          </ControlButton>
        </div>
      </section>
    </div>
  );
}

export function RouteLoadErrorState({ message, onRetry, onReturnToLibrary }: { message: string; onRetry: () => void; onReturnToLibrary: () => void }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center py-16">
      <section className="max-w-md text-center" role="alert">
        <WarningTriangle className="mx-auto text-red-400" width={42} height={42} aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-black">This screen could not be loaded</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <ControlButton type="button" variant="primary" onClick={onRetry}><Refresh width={16} height={16} aria-hidden="true" /> Retry</ControlButton>
          <ControlButton type="button" variant="neutral" onClick={onReturnToLibrary}><NavArrowLeft width={16} height={16} aria-hidden="true" /> Return to Library</ControlButton>
        </div>
      </section>
    </div>
  );
}
