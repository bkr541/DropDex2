import { useState } from 'react';
import { ArrowLeft, Cloud, NavArrowRight, Spotify } from 'iconoir-react/regular';
import { ControlButton } from '../ui/controls';
import { SoundCloudTab } from './SoundCloudTab';
import { SpotifyExternalAccount } from './SpotifyExternalAccount';
import { SpotifyMetadataBrowser } from './SpotifyMetadataBrowser';

function BackToServices({ onBack }: { onBack: () => void }) {
  return <ControlButton variant="ghost" onClick={onBack} aria-label="Back to External Music">
    <ArrowLeft width={16} height={16} aria-hidden="true" /> Back to External Music
  </ControlButton>;
}

function SpotifyMusicPanel({ accessToken, onBack }: { accessToken: string | null; onBack: () => void }) {
  const [available, setAvailable] = useState(false);
  return <div className="profile-stack" aria-label="Spotify metadata">
    <section className="profile-group">
      <BackToServices onBack={onBack} />
      <h2 className="profile-heading"><Spotify width={16} height={16} className="text-[#1ed760]" aria-hidden="true" /> Spotify</h2>
      <p className="text-xs text-muted-foreground">Your connected account, playlists, and track metadata.</p>
      <SpotifyExternalAccount accessToken={accessToken} onAvailabilityChange={setAvailable} />
    </section>
    {available && accessToken && <div className="profile-group"><SpotifyMetadataBrowser accessToken={accessToken} /></div>}
  </div>;
}

export function ExternalMusicTab({ accessToken }: { accessToken: string | null }) {
  const [service, setService] = useState<'soundcloud' | 'spotify' | null>(null);
  const back = () => setService(null);

  if (service === 'soundcloud') return <div className="profile-stack"><SoundCloudTab accessToken={accessToken} onBackToServices={back} /></div>;
  if (service === 'spotify') return <SpotifyMusicPanel accessToken={accessToken} onBack={back} />;

  return <section className="profile-group" aria-label="External Music services">
    <h2 className="profile-heading">External Music</h2>
    <p className="text-xs text-muted-foreground">Choose a service to view its music information.</p>
    <div className="profile-external-services">
      <button type="button" className="profile-external-service" onClick={() => setService('soundcloud')} aria-label="View SoundCloud information">
        <Cloud width={30} height={30} className="text-[#ff5500]" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm font-medium">SoundCloud</span>
          <span className="mt-1 block text-xs text-muted-foreground">Browse SoundCloud track information.</span></span>
        <NavArrowRight width={16} height={16} aria-hidden="true" />
      </button>
      <button type="button" className="profile-external-service" onClick={() => setService('spotify')} aria-label="View Spotify information">
        <Spotify width={30} height={30} className="text-[#1ed760]" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm font-medium">Spotify</span>
          <span className="mt-1 block text-xs text-muted-foreground">Account, playlists, and track metadata.</span></span>
        <NavArrowRight width={16} height={16} aria-hidden="true" />
      </button>
    </div>
  </section>;
}
