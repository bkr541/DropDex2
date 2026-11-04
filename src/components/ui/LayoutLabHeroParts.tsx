import { LogoInstagram } from '@carbon/icons-react';
import { cn } from '../../lib/utils';

export function SpotifyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.313a.748.748 0 0 1-1.031.25c-2.822-1.724-6.375-2.114-10.561-1.158a.749.749 0 1 1-.333-1.462c4.579-1.045 8.507-.596 11.675 1.339a.75.75 0 0 1 .25 1.031zm1.472-3.274a.937.937 0 0 1-1.288.308c-3.226-1.983-8.143-2.558-11.963-1.4a.937.937 0 1 1-.544-1.791c4.361-1.323 9.782-.682 13.487 1.596a.937.937 0 0 1 .308 1.287zm.126-3.409c-3.868-2.297-10.249-2.509-13.944-1.388a1.124 1.124 0 1 1-.652-2.15c4.243-1.288 11.298-1.039 15.749 1.607a1.125 1.125 0 0 1-1.153 1.931z" />
    </svg>
  );
}

export function SoundCloudIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M7.5 17h-1V9.6c.3-.1.6-.1 1-.1V17zm-2 0h-1v-6.3c.3-.3.6-.5 1-.7v7zm-2 0h-1v-4.6c.3-.4.6-.7 1-.9V17zm-2-.2c-.6-.4-1-1.1-1-1.9s.4-1.5 1-1.9v3.8zM20.5 11c-.3 0-.6 0-.9.1C19.2 8.2 16.8 6 13.9 6c-1.1 0-2.2.3-3.1.9-.2.1-.3.3-.3.5V17h10c1.9 0 3.5-1.6 3.5-3s-1.6-3-3.5-3zM9.5 17h-1V8.7c.3-.2.6-.4 1-.5V17z" />
    </svg>
  );
}

export function Socials({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-muted-foreground', className)}>
      <span title="Spotify" className="hover:text-foreground transition-colors"><SpotifyIcon size={size} /></span>
      <span title="SoundCloud" className="hover:text-foreground transition-colors"><SoundCloudIcon size={size} /></span>
      <span title="Instagram" className="hover:text-foreground transition-colors"><LogoInstagram size={size} /></span>
    </div>
  );
}

