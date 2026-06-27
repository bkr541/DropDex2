import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { isChunkLoadError } from '../../navigation/lazyWithRecovery';

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
    console.error('DropDex application boundary caught an error.', error, info);
  }

  componentDidUpdate(previousProps: ApplicationErrorBoundaryProps) {
    if (
      this.state.error
      && previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  private handleRetry = () => {
    if (this.state.error && isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

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
          <AlertTriangle className="mx-auto mb-4 text-red-400" size={36} />
          <h1 className="text-xl font-black">
            {chunkFailure ? 'This screen could not be updated' : 'DropDex hit an unexpected error'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {chunkFailure
              ? 'A newer deployment may have replaced files used by this browser tab. Reload the page to fetch the current screen.'
              : 'Your library data is safe. Retry this screen, return to the Library, or reload the application.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white"
            >
              <RotateCcw size={15} />
              {chunkFailure ? 'Reload' : 'Retry'}
            </button>
            <button
              type="button"
              onClick={this.handleLibrary}
              className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-bold"
            >
              Return to Library
            </button>
            {!chunkFailure && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
              >
                Reload
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }
}
