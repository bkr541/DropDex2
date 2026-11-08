import { ProfileSwitch } from './ProfileSwitch';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { Dashboard } from 'iconoir-react/regular';
import { LIBRARY_OVERVIEW_WIDGETS } from '../../lib/dashboard/libraryOverviewWidgets';
import type { LibraryOverviewWidgets } from '../../hooks/useLibraryOverviewWidgets';
import { ControlButton } from '../ui/controls';
import { NoticeCard } from '../ui/feedback';

/**
 * Personalization: choose which groups show on the Library overview page. Each group has its own switch, and a change shows
 * on the Library page straight away.
 */
export function DashboardWidgetsGroup({ widgets }: { widgets: LibraryOverviewWidgets }) {
  const { hidden, setVisible, showAll, saveFailed } = widgets;
  return (
    <section className="profile-group" data-testid="dashboard-widgets-group">
      <h2 className="profile-heading"><Dashboard width={11} height={11} aria-hidden="true" />Library overview</h2>
      <SurfaceCard as="div">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold">Choose what shows on your Library page</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Turn a group off to hide it. Your choice is saved to your account, so it follows you to your other devices.</p>
          </div>
          {hidden.size > 0 && <ControlButton variant="secondary" onClick={showAll} data-testid="dashboard-widgets-show-all">Show everything</ControlButton>}
        </div>
        {/* Two columns on wider screens; hairlines between the rows and between the columns. */}
        <ul className="profile-records grid grid-cols-1 border-t border-[var(--color-border-faint)] md:grid-cols-2" data-testid="dashboard-widget-list">
          {LIBRARY_OVERVIEW_WIDGETS.map((widget) => {
            const visible = !hidden.has(widget.id);
            const labelId = `dashboard-widget-${widget.id}`;
            return (
              <li key={widget.id} className="profile-record flex items-center justify-between gap-4 border-b border-[var(--color-border-faint)] md:odd:border-r" data-testid="dashboard-widget-row">
                <div className="min-w-0">
                  <p id={labelId} className="text-xs font-medium">{widget.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{widget.description}</p>
                </div>
                <ProfileSwitch
                  checked={visible}
                  aria-labelledby={labelId}
                  data-testid={`dashboard-widget-toggle-${widget.id}`}
                  onClick={() => setVisible(widget.id, !visible)}
                />
              </li>
            );
          })}
        </ul>
        {saveFailed && (
          <div className="p-4">
            <NoticeCard tone="warning">Your choice is applied on this computer, but it couldn&apos;t be saved to your account. It will try again the next time you change something.</NoticeCard>
          </div>
        )}
      </SurfaceCard>
    </section>
  );
}
