import { Dashboard } from '@carbon/icons-react';
import { LIBRARY_OVERVIEW_WIDGETS } from '../../lib/dashboard/libraryOverviewWidgets';
import type { LibraryOverviewWidgets } from '../../hooks/useLibraryOverviewWidgets';
import { cn } from '../../lib/utils';
import { ControlButton } from '../ui/controls';

/**
 * Personalization: choose which groups show on the Library overview page. Each group has its own switch, and a change shows
 * on the Library page straight away.
 */
export function DashboardWidgetsGroup({ widgets }: { widgets: LibraryOverviewWidgets }) {
  const { hidden, setVisible, showAll, saveFailed } = widgets;
  return (
    <section className="space-y-3" data-testid="dashboard-widgets-group">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground"><Dashboard size={11} />Library overview</h2>
      <div className="glass divide-y divide-[var(--color-border-faint)] rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-bold">Choose what shows on your Library page</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Turn a group off to hide it. Your choice is saved to your account, so it follows you to your other devices.</p>
          </div>
          {hidden.size > 0 && <ControlButton variant="neutral" onClick={showAll} data-testid="dashboard-widgets-show-all">Show everything</ControlButton>}
        </div>
        <ul>
          {LIBRARY_OVERVIEW_WIDGETS.map((widget) => {
            const visible = !hidden.has(widget.id);
            const labelId = `dashboard-widget-${widget.id}`;
            return (
              <li key={widget.id} className="flex items-start justify-between gap-4 px-4 py-3" data-testid="dashboard-widget-row">
                <div className="min-w-0">
                  <p id={labelId} className="text-sm font-bold">{widget.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{widget.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visible}
                  aria-labelledby={labelId}
                  data-testid={`dashboard-widget-toggle-${widget.id}`}
                  onClick={() => setVisible(widget.id, !visible)}
                  className={cn(
                    'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                    visible ? 'border-primary bg-primary' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
                  )}
                >
                  <span className={cn('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all', visible ? 'left-[22px]' : 'left-0.5')} />
                </button>
              </li>
            );
          })}
        </ul>
        {saveFailed && (
          <p className="p-4 text-xs text-amber-400" role="alert">Your choice is applied on this computer, but it couldn&apos;t be saved to your account. It will try again the next time you change something.</p>
        )}
      </div>
    </section>
  );
}
