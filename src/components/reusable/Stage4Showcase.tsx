import {
  AudioWaveform,
  BarChart3,
  Disc3,
  Grid2X2,
  Home,
  List,
  ListMusic,
  Music,
  Play,
  Settings,
  SlidersHorizontal,
  SquareStack,
  UserRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { WaveformDisplay } from '../library/WaveformDisplay';
import {
  Artwork,
  Avatar,
  Divider,
  PlaylistCard,
  SidebarNavItem,
  StatTile,
  SurfaceCard,
  TabNavigation,
  Typography,
  ViewModeNavigation,
} from '../ui/DropDexDisplay';
import './stage4-showcase.css';

function Stage4Specimen({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`dd-stage4-specimen ${className ?? ''}`} data-stage4-card={label}>
      <h3>{label}</h3>
      <div className="dd-stage4-specimen__content">{children}</div>
    </section>
  );
}

function RoundAction({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="dd-stage4-round-action" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

function TrackCard({
  variant,
  title,
  artist,
  bpm,
  musicalKey,
  time,
  seed,
  onPlay,
  onMore,
}: {
  variant: 'glass' | 'surface';
  title: string;
  artist: string;
  bpm: string;
  musicalKey: string;
  time: string;
  seed: string;
  onPlay: () => void;
  onMore: () => void;
}) {
  return (
    <SurfaceCard variant={variant} className="dd-stage4-track-card">
      <div className={`dd-stage4-track-card__top dd-stage4-track-card__top--${variant}`}>
        {variant === 'surface' && (
          <Artwork
            src="/artwork/stage4-orb-artwork.svg"
            alt="Solaris artwork"
            className="dd-stage4-track-card__thumb"
          />
        )}
        <div className="dd-stage4-track-card__copy">
          <strong title={title}>{title}</strong>
          <span title={artist}>{artist}</span>
        </div>
        {variant === 'glass' ? (
          <div className="dd-stage4-track-card__top-meta">
            <b>{bpm.replace(' BPM', '')}</b>
            <b>{musicalKey}</b>
          </div>
        ) : (
          <button type="button" className="dd-stage4-more" aria-label={`More actions for ${title}`} onClick={onMore}>⋮</button>
        )}
      </div>
      <div className={`dd-stage4-wave dd-stage4-wave--${variant}`}>
        <WaveformDisplay seed={seed} barCount={64} color={variant === 'glass' ? 'secondary' : 'primary'} showFallbackLabel={false} />
      </div>
      <div className="dd-stage4-track-card__footer">
        <span className="dd-stage4-meta dd-stage4-meta--bpm"><i />{bpm}</span>
        <span className="dd-stage4-meta dd-stage4-meta--key"><i />{musicalKey}</span>
        <span className="dd-stage4-track-card__time">{time}</span>
        <RoundAction label={`Play ${title}`} onClick={onPlay}><Play size={13} fill="currentColor" /></RoundAction>
      </div>
    </SurfaceCard>
  );
}

const PRIMARY_TABS = [
  { id: 'playlists', label: 'PLAYLISTS' },
  { id: 'tracks', label: 'TRACKS' },
  { id: 'albums', label: 'ALBUMS' },
  { id: 'artists', label: 'ARTISTS' },
  { id: 'genres', label: 'GENRES' },
];

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'recently-played', label: 'Recently Played' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'offline', label: 'Offline' },
];

const VIEW_MODES = [
  { id: 'grid', label: 'Grid', icon: <Grid2X2 /> },
  { id: 'list', label: 'List', icon: <SlidersHorizontal /> },
  { id: 'compact', label: 'Compact', icon: <List /> },
  { id: 'cards', label: 'Cards', icon: <SquareStack /> },
  { id: 'waveform', label: 'Waveform', icon: <AudioWaveform /> },
];

export function Stage4Showcase() {
  const [sidebarValue, setSidebarValue] = useState('collection');
  const [primaryTab, setPrimaryTab] = useState('playlists');
  const [filterTab, setFilterTab] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [activityMessage, setActivityMessage] = useState('');

  return (
    <div className="dd-stage4-board" data-testid="stage4-component-board">
      <div className="dd-stage4-grid dd-stage4-grid--cards">
        <Stage4Specimen label="Glass Card" className="dd-stage4-glass">
          <TrackCard
            variant="glass"
            title="Midnight Drive"
            artist="Arc North"
            bpm="128 BPM"
            musicalKey="8A"
            time="03:42"
            seed="stage4-midnight-drive"
            onPlay={() => setActivityMessage('Play action: Midnight Drive')}
            onMore={() => setActivityMessage('More actions: Midnight Drive')}
          />
        </Stage4Specimen>

        <Stage4Specimen label="Surface Card" className="dd-stage4-surface">
          <TrackCard
            variant="surface"
            title="Solaris"
            artist="Bicep"
            bpm="126 BPM"
            musicalKey="7A"
            time="05:16"
            seed="stage4-solaris"
            onPlay={() => setActivityMessage('Play action: Solaris')}
            onMore={() => setActivityMessage('More actions: Solaris')}
          />
        </Stage4Specimen>

        <Stage4Specimen label="Stat Tile / KPI" className="dd-stage4-stat">
          <StatTile
            label="Total Played"
            value="12.4K"
            trend="▲ 12.5%"
            caption="vs last 30 days"
            chartValues={[38, 55, 33, 47, 67, 42, 73, 50, 78, 61, 71, 68, 84, 53]}
          />
        </Stage4Specimen>

        <Stage4Specimen label="Playlist Card" className="dd-stage4-playlist">
          <PlaylistCard
            title="Tech House Grooves"
            subtitle="by Deep Motion"
            artwork={<Artwork src="/artwork/stage4-playlist-artwork.svg" alt="Tech House Grooves artwork" />}
            metadata={<><ListMusic size={8} /> 32 TRACKS · 2h 18m</>}
            actionLabel="VIEW PLAYLIST"
            items={[
              { id: 1, title: 'Innerbloom', artist: 'RÜFÜS DU SOL', meta: '7A' },
              { id: 2, title: 'The Cave', artist: 'Maya Jane Coles', meta: '8A' },
              { id: 3, title: 'Higher Place', artist: 'Kölsch', meta: '7A' },
            ]}
            onAction={() => setActivityMessage('Playlist action activated')}
          />
        </Stage4Specimen>

        <Stage4Specimen label="Artwork / Thumbnail" className="dd-stage4-artwork">
          <Artwork
            src="/artwork/stage4-demo-artwork.svg"
            alt="Neon mountain artwork"
            overlay={(
              <div className="dd-stage4-artwork-actions">
                <RoundAction label="Play artwork preview" onClick={() => setActivityMessage('Play artwork preview')}><Play size={13} fill="currentColor" /></RoundAction>
                <button type="button" className="dd-stage4-artwork-more" aria-label="Artwork actions" onClick={() => setActivityMessage('Artwork actions opened')}>•••</button>
              </div>
            )}
          />
        </Stage4Specimen>

        <Stage4Specimen label="Artwork With Fallback" className="dd-stage4-artwork-fallback">
          <Artwork
            src="/artwork/__missing-stage4-artwork__.png"
            alt="Artwork unavailable"
            fallbackTitle="No Artwork"
            fallbackDescription="Track unavailable"
            fallbackIcon={<Music size={27} />}
          />
        </Stage4Specimen>
      </div>

      <div className="dd-stage4-grid dd-stage4-grid--middle">
        <Stage4Specimen label="Avatar — Initials" className="dd-stage4-avatar-initials">
          <Avatar initials="DM" alt="Deep Motion" size="lg" ring="blue" />
        </Stage4Specimen>

        <Stage4Specimen label="Avatar — Icon Fallback" className="dd-stage4-avatar-icon">
          <Avatar alt="User profile" size="lg" icon={<UserRound />} />
        </Stage4Specimen>

        <Stage4Specimen label="Avatar With Ring" className="dd-stage4-avatar-ring">
          <Avatar alt="Audio profile" size="lg" ring="spectrum" icon={<AudioWaveform />} />
        </Stage4Specimen>

        <Stage4Specimen label="Image Avatar" className="dd-stage4-avatar-image">
          <Avatar src="/artwork/stage4-avatar.svg" alt="DJ profile avatar" size="lg" ring="blue" icon={<UserRound />} />
        </Stage4Specimen>

        <Stage4Specimen label="Headings" className="dd-stage4-headings">
          <SurfaceCard className="dd-stage4-type-card">
            <Typography variant="h1">H1 Heading</Typography>
            <Typography variant="h2">H2 Heading</Typography>
            <Typography variant="h3">H3 Heading</Typography>
            <Typography variant="h4">H4 Heading</Typography>
            <Typography variant="h5">H5 Heading</Typography>
          </SurfaceCard>
        </Stage4Specimen>

        <Stage4Specimen label="Body & Muted Text" className="dd-stage4-body">
          <SurfaceCard className="dd-stage4-type-card dd-stage4-type-card--body">
            <Typography variant="body">
              This is body text used for descriptions, details, and supporting information in the interface. It should be clear, legible, and easy to scan.
            </Typography>
            <Typography variant="muted">
              Muted text is used for secondary information, less prominent details, or supporting content that doesn&apos;t require primary attention.
            </Typography>
          </SurfaceCard>
        </Stage4Specimen>

        <Stage4Specimen label="Mono / Code Text" className="dd-stage4-mono">
          <SurfaceCard className="dd-stage4-code-card">
            {[
              ['01', 'BPM', '128', 'green'],
              ['02', 'key', '"8A"', 'red'],
              ['03', 'time_signature', '"4/4"', 'red'],
              ['04', 'energy', '0.78', 'red'],
              ['05', 'danceability', '0.85', 'red'],
              ['06', 'loudness', '-6.4', 'red'],
            ].map(([line, keyName, value, tone]) => (
              <div className="dd-stage4-code-line" key={keyName}>
                <span>{line}</span>
                <Typography variant="mono" as="span">{keyName} = </Typography>
                <b data-tone={tone}>{value}</b>
              </div>
            ))}
          </SurfaceCard>
        </Stage4Specimen>
      </div>

      <div className="dd-stage4-grid dd-stage4-grid--lower">
        <Stage4Specimen label="Brand / Accent Text" className="dd-stage4-brand">
          <div className="dd-stage4-brand-list">
            <Typography variant="brand" tone="primary">Primary Accent</Typography>
            <Typography variant="brand" tone="secondary">Secondary Accent</Typography>
            <Typography variant="brand" tone="success">Success Accent</Typography>
            <Typography variant="brand" tone="warning">Warning Accent</Typography>
            <Typography variant="brand" tone="danger">Danger Accent</Typography>
          </div>
        </Stage4Specimen>

        <Stage4Specimen label="Brand Gradient Text" className="dd-stage4-gradient">
          <Typography variant="h1" gradient as="div" className="dd-stage4-gradient-copy">Elevate<br />Your Mix</Typography>
          <p>Seamless. Powerful. Inspiring.</p>
        </Stage4Specimen>

        <Stage4Specimen label="Divider" className="dd-stage4-divider">
          <div className="dd-stage4-divider-list">
            <div><span>Default</span><Divider /></div>
            <div><span>Dotted</span><Divider variant="dotted" /></div>
            <div><span>Dashed</span><Divider variant="dashed" /></div>
            <div><span>Accent</span><Divider variant="accent" /></div>
          </div>
        </Stage4Specimen>

        <Stage4Specimen label="Sidebar Nav Items" className="dd-stage4-sidebar">
          <SurfaceCard className="dd-stage4-sidebar-shell">
            {[
              { id: 'collection', label: 'Collection', icon: <Home /> },
              { id: 'playlists', label: 'Playlists', icon: <Music /> },
              { id: 'tracks', label: 'Tracks', icon: <AudioWaveform /> },
              { id: 'crates', label: 'Crates', icon: <Disc3 /> },
              { id: 'analytics', label: 'Analytics', icon: <BarChart3 /> },
              { id: 'settings', label: 'Settings', icon: <Settings /> },
            ].map((item) => (
              <SidebarNavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                selected={sidebarValue === item.id}
                onClick={() => setSidebarValue(item.id)}
              />
            ))}
          </SurfaceCard>
        </Stage4Specimen>

        <Stage4Specimen label="Tab Navigation" className="dd-stage4-navigation">
          <div className="dd-stage4-nav-stack">
            <TabNavigation
              value={primaryTab}
              options={PRIMARY_TABS}
              onChange={setPrimaryTab}
              ariaLabel="Library sections"
            />
            <TabNavigation
              value={filterTab}
              options={FILTER_TABS}
              onChange={setFilterTab}
              variant="filter"
              ariaLabel="Library filters"
            />
            <ViewModeNavigation
              value={viewMode}
              options={VIEW_MODES}
              onChange={setViewMode}
              ariaLabel="Library view mode"
            />
          </div>
        </Stage4Specimen>
      </div>

      <span className="dd-stage4-live-status" role="status" aria-live="polite">
        {activityMessage}
      </span>
    </div>
  );
}
