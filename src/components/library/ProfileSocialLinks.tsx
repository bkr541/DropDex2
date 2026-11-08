import { Cloud, Globe, Instagram, Spotify, Tiktok, Youtube } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../types';

/** The profile's social links, as icons that open each page in a new tab. Nothing is drawn when the profile has none. */
export function ProfileSocialLinks({ profile, size = 16, className }: { profile: UserProfile | null; size?: number; className?: string }) {
  const links = [
    { href: profile?.spotify_url, label: 'Spotify', Icon: Spotify },
    { href: profile?.soundcloud_url, label: 'SoundCloud', Icon: Cloud },
    { href: profile?.instagram_url, label: 'Instagram', Icon: Instagram },
    { href: profile?.tiktok_url, label: 'TikTok', Icon: Tiktok },
    { href: profile?.youtube_url, label: 'YouTube', Icon: Youtube },
    { href: profile?.website_url, label: 'Website', Icon: Globe },
  ].flatMap(({ href, label, Icon }) => href ? [{ href, label, Icon }] : []);
  if (links.length === 0) return null;
  return (
    <div className={cn('flex items-center gap-3', className)} data-testid="profile-socials">
      {links.map(({ href, label, Icon }) => (
        <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="text-muted-foreground transition-colors hover:text-foreground">
          <Icon width={size} height={size} aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}
