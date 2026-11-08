import { Cloud, Instagram, Spotify } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';

export function Socials({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-muted-foreground', className)}>
      <span title="Spotify" className="hover:text-foreground transition-colors"><Spotify width={size} height={size} aria-hidden="true" /></span>
      <span title="SoundCloud" className="hover:text-foreground transition-colors"><Cloud width={size} height={size} aria-hidden="true" /></span>
      <span title="Instagram" className="hover:text-foreground transition-colors"><Instagram width={size} height={size} aria-hidden="true" /></span>
    </div>
  );
}
