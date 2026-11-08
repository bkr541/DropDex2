import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '../../navigation/lazyWithRecovery';
import { NavArrowLeft, Refresh, WarningTriangle } from 'iconoir-react/regular';
import { ControlButton } from '../ui/controls';
import { logger } from '../../lib/logger';

interface ApplicationErrorBoundaryProps {
  children: ReactNode;
  level?: 'root' | 'feature';
  resetKey?: string;
  onReturnToLibrary?: () => void;
}

interface ApplicationErrorBoundaryState {
  error: Error | null;
}

export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  state: ApplicationErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ApplicationErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('react.error_boundary', {
      errorType: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      level: this.props.level ?? 'feature',
    });
  }

  componentDidUpdate(previousProps: ApplicationErrorBoundaryProps) {
    if (
      this.state.error
      && previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  private handleLibrary = () => {
    if (this.props.onReturnToLibrary) {
      this.props.onReturnToLibrary();
      this.setState({ error: null });
      return;
    }
    window.location.assign('/library');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const root = this.props.level === 'root';
    const chunkFailure = isChunkLoadError(error);
    return (
      <div className={root ? 'min-h-screen flex items-center justify-center bg-background p-6' : 'py-16 px-4'}>
        <section
          className="mx-auto max-w-lg rounded-3xl border border-red-500/20 bg-[var(--color-panel)] p-6 text-center shadow-xl"
          role="alert"
          aria-live="assertive"
        >
          <WarningTriangle className="mx-auto mb-4 text-red-400" width={36} height={36} aria-hidden="true" />
          <h1 className="text-xl font-black">
            {chunkFailure ? 'This screen could not be updated' : 'DropDex hit an unexpected error'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {chunkFailure
              ? 'A newer deployment may have replaced files used by this browser tab. Reload the page to fetch the current screen.'
              : 'Your library data is safe. Return to the library or reload the application.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <ControlButton type="button" variant="neutral" onClick={this.handleLibrary}>
              <NavArrowLeft width={16} height={16} aria-hidden="true" />
              Return to Library
            </ControlButton>
            <ControlButton type="button" variant="primary" onClick={() => window.location.reload()}>
              <Refresh width={16} height={16} aria-hidden="true" />
              Reload
            </ControlButton>
          </div>
        </section>
      </div>
    );
  }
}
