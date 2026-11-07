import type { ReactNode } from 'react';
import { Globe, LogoInstagram, LogoYoutube } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../types';

function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.2 3.5v10.1a4.7 4.7 0 1 1-4-4.65v2.8a2 2 0 1 0 1.2 1.85V3.5h2.8Z" fill="currentColor" />
      <path d="M14.2 3.5c.45 2.35 1.8 3.75 4.3 4.1v2.75c-1.75-.05-3.15-.55-4.3-1.5V3.5Z" fill="currentColor" />
    </svg>
  );
}

/** The profile's social links, as icons that open each page in a new tab. Nothing is drawn when the profile has none. */
export function ProfileSocialLinks({ profile, size = 16, className }: { profile: UserProfile | null; size?: number; className?: string }) {
  const links = [
          profile?.spotify_url ? { href: profile.spotify_url, label: 'Spotify', icon: <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.313a.748.748 0 0 1-1.031.25c-2.822-1.724-6.375-2.114-10.561-1.158a.749.749 0 1 1-.333-1.462c4.579-1.045 8.507-.596 11.675 1.339a.75.75 0 0 1 .25 1.031zm1.472-3.274a.937.937 0 0 1-1.288.308c-3.226-1.983-8.143-2.558-11.963-1.4a.937.937 0 1 1-.544-1.791c4.361-1.323 9.782-.682 13.487 1.596a.937.937 0 0 1 .308 1.287zm.126-3.409c-3.868-2.297-10.249-2.509-13.944-1.388a1.124 1.124 0 1 1-.652-2.15c4.243-1.288 11.298-1.039 15.749 1.607a1.125 1.125 0 0 1-1.153 1.931z"/></svg> } : null,
          profile?.soundcloud_url ? { href: profile.soundcloud_url, label: 'SoundCloud', icon: <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><path d="M1.175 12.225c-.015.132-.024.265-.024.4 0 .135.009.268.024.4l-.024-.4.024.4c.133 1.162 1.11 2.063 2.3 2.063 1.276 0 2.312-1.036 2.312-2.312V8.1a.387.387 0 0 0-.387-.387.387.387 0 0 0-.387.387v4.275a1.538 1.538 0 0 1-1.538 1.538 1.538 1.538 0 0 1-1.538-1.538 1.538 1.538 0 0 1 1.538-1.538c.283 0 .549.077.775.213V8.1A2.887 2.887 0 0 0 1.364 9.9c-.13.382-.189.78-.189 1.187v1.138zm5.1 2.463V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.926a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.387V8.475a.387.387 0 0 1 .387-.388.387.387 0 0 1 .388.388v6.6a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55 0V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.225V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v7.538a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55-.225V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm2.1-.3c0 .98.795 1.775 1.775 1.775a1.776 1.776 0 0 0 1.725-1.375 3.526 3.526 0 0 0 .3.013 3.525 3.525 0 0 0 3.525-3.525A3.525 3.525 0 0 0 18.375 8.1a3.51 3.51 0 0 0-1.85.525 5.026 5.026 0 0 0-4.6-3.05 5.025 5.025 0 0 0-4.3 2.437v6.763c0 .98.795 1.775 1.775 1.775s1.775-.795 1.775-1.775V8.1a.387.387 0 0 1 .775 0v6.675z"/></svg> } : null,
          profile?.instagram_url ? { href: profile.instagram_url, label: 'Instagram', icon: <LogoInstagram size={size} /> } : null,
          profile?.tiktok_url ? { href: profile.tiktok_url, label: 'TikTok', icon: <TikTokIcon size={size} /> } : null,
          profile?.youtube_url ? { href: profile.youtube_url, label: 'YouTube', icon: <LogoYoutube size={size} /> } : null,
          profile?.website_url ? { href: profile.website_url, label: 'Website', icon: <Globe size={size} /> } : null,
        ].filter(Boolean) as { href: string; label: string; icon: ReactNode }[];
  if (links.length === 0) return null;
  return (
    <div className={cn('flex items-center gap-3', className)} data-testid="profile-socials">
      {links.map(({ href, label, icon }) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="text-muted-foreground transition-colors hover:text-foreground">
          {icon}
        </a>
      ))}
    </div>
  );
}
