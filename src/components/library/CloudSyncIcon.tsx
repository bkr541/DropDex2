import { Cloud } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';

/** A cloud that is lit when the track is synced to DropDex Cloud, and the same cloud greyed out when it is not. */
export function CloudSyncIcon({ synced, unknown = false }: { synced: boolean; unknown?: boolean }) {
  const label = unknown ? 'DropDex Cloud status unavailable' : synced ? 'Synced to DropDex Cloud' : 'Not synced to DropDex Cloud';
  return (
    <span className="inline-flex" title={label} role="img" aria-label={label} data-testid="cloud-sync-icon" data-synced={synced ? 'true' : 'false'}>
      <Cloud width={18} height={18} className={cn('shrink-0 transition-colors', synced ? 'text-emerald-400' : 'text-muted-foreground opacity-30')} aria-hidden="true" />
    </span>
  );
}
