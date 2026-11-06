import { useRef, useState, type CSSProperties, type ElementType } from 'react';
import {
  ArrowRight, ChartBar, Chemistry, CheckmarkFilled, Headphones, Music,
  Pause, Play, Search, Settings, SkipForward, Usb, User, Waveform,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { HeroAurora, HeroGlassDuo, HeroPoster, HeroSplitCover, HeroStudioStrip } from './LayoutLabHeroMockups';
import { HERO } from './layoutLabHeroSample';
import './layout-lab-nav-design.css';

type TornDirection = 'torn-cut' | 'torn-fold' | 'torn-layer';
type Direction = 'contour' | 'pods' | 'inset' | 'spine' | 'glass' | TornDirection;

const NAV = [
  { id: 'library', label: 'Library', icon: Music, color: '#ff754f' },
  { id: 'discovery', label: 'Discovery', icon: ChartBar, color: '#2ce6aa' },
  { id: 'cues', label: 'Cue Points', icon: Waveform, color: '#d4f553' },
  { id: 'audition', label: 'Audition', icon: Headphones, color: '#78adff' },
  { id: 'drop-lab', label: 'Drop Lab', icon: Chemistry, color: '#b59bff' },
  { id: 'usb', label: 'USB Management', icon: Usb, color: '#71ddd6' },
  { id: 'settings', label: 'Settings', icon: Settings, color: '#abb5c4' },
  { id: 'profile', label: 'Profile', icon: User, color: '#ffafa2' },
];

const DIRECTIONS: {
  id: Direction; title: string; description: string; pairing: string; accent: string; hero: ElementType;
}[] = [
  { id: 'contour', title: 'Contour Dock', description: 'An organic black silhouette, open circular accents and a detached settings island.', pairing: 'Aurora Banner', accent: '#ff754f', hero: HeroAurora },
  { id: 'pods', title: 'Floating Pods', description: 'Three independent capsules separate browsing, creative tools and account controls.', pairing: 'Glass Duo', accent: '#2ce6aa', hero: HeroGlassDuo },
  { id: 'inset', title: 'Inset Ribbon', description: 'A labeled rail with a curved active shelf that flows directly into the canvas.', pairing: 'Centered Poster', accent: '#d4f553', hero: HeroPoster },
  { id: 'spine', title: 'Studio Spine', description: 'Machined edges, connected dials and restrained white indicators, like a piece of studio hardware.', pairing: 'Studio Strip', accent: '#c8d2df', hero: HeroStudioStrip },
  { id: 'glass', title: 'Prism Glass', description: 'A translucent shell over soft spectral color, with a suspended black control capsule.', pairing: 'Split Cover', accent: '#b59bff', hero: HeroSplitCover },
  { id: 'torn-cut', title: 'Torn Page · Soft Cut', description: 'The page peels away from the left edge to expose a black navigation recess, with a curled lower tip and a detached settings button.', pairing: 'Aurora Banner', accent: '#ff754f', hero: HeroAurora },
  { id: 'torn-fold', title: 'Torn Page · Folded Edge', description: 'A slanted paper edge, a lifted fold and a deep black cutout. The navigation lives underneath the page.', pairing: 'Centered Poster', accent: '#d4f553', hero: HeroPoster },
  { id: 'torn-layer', title: 'Torn Page · Double Layer', description: 'Two offset sheets reveal a black nav channel, with a soft spectral edge and a separate circular settings cutout.', pairing: 'Glass Duo', accent: '#b59bff', hero: HeroGlassDuo },
];

function isTorn(direction: Direction): direction is TornDirection {
  return direction === 'torn-cut' || direction === 'torn-fold' || direction === 'torn-layer';
}

// The foreground is the page itself, extending across the entire mockup. Its
// left boundary opens onto the black layer underneath, rather than outlining a rail.
const PAGE_EDGES: Record<TornDirection, string> = {
  'torn-cut': 'M0 0 V76 C0 102 18 116 53 111 C112 102 168 127 168 170 V455 C168 491 143 507 112 499 C81 491 57 511 64 535 C73 564 50 578 34 599 C22 616 29 637 0 650',
  'torn-fold': 'M0 0 V70 C0 91 22 105 55 104 C107 102 138 118 149 155 L184 437 C188 474 164 497 132 494 C102 490 82 503 79 526 C76 552 48 561 40 587 C33 611 22 639 0 650',
  'torn-layer': 'M0 0 V67 C0 98 28 118 61 113 C111 105 180 125 180 174 V443 C180 483 154 507 123 501 C93 494 63 511 70 538 C78 568 50 579 42 601 C33 624 19 634 0 650',
};

function TornPage({ direction }: { direction: TornDirection }) {
  const edge = PAGE_EDGES[direction];
  const sheet = `${edge} H1600 V0 Z`;
  return (
    <svg className="nd-torn-page" viewBox="0 0 1440 650" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`nd-paper-${direction}`} x1="0" y1="0" x2="460" y2="170" gradientUnits="userSpaceOnUse">
          <stop stopColor={direction === 'torn-layer' ? '#585264' : direction === 'torn-fold' ? '#363c43' : '#2b3038'} />
          <stop offset=".45" stopColor={direction === 'torn-layer' ? '#222e38' : '#182029'} />
          <stop offset="1" stopColor="#0c1016" />
        </linearGradient>
        <linearGradient id={`nd-fold-${direction}`} x1="72" y1="510" x2="143" y2="552" gradientUnits="userSpaceOnUse">
          <stop stopColor="#77818d" /><stop offset=".35" stopColor="#424a55" /><stop offset="1" stopColor="#131923" />
        </linearGradient>
        <filter id={`nd-paper-shadow-${direction}`} x="-30%" y="-20%" width="160%" height="140%">
          <feDropShadow dx="-8" dy="7" stdDeviation="8" floodColor="#000000" floodOpacity=".8" />
        </filter>
      </defs>
      {direction === 'torn-layer' && <>
        <path d={sheet} transform="translate(-23 -13)" fill="#4f5865" />
        <path d={sheet} transform="translate(-11 -5)" fill="#303f48" stroke="#a2adbc" strokeOpacity=".2" />
      </>}
      <path d={sheet} fill={`url(#nd-paper-${direction})`} filter={`url(#nd-paper-shadow-${direction})`} />
      <path d={edge} fill="none" stroke={direction === 'torn-layer' ? '#c6b4d8' : '#9ca7b6'} strokeOpacity=".28" strokeWidth="1.1" />
      {direction === 'torn-fold' ? <>
        <path d="M160 487 C133 512 105 491 82 516 C78 536 92 548 76 568 C107 557 130 534 140 514 Z" fill={`url(#nd-fold-${direction})`} />
        <path d="M82 516 Q119 517 160 487" fill="none" stroke="#aeb8c8" strokeOpacity=".45" />
      </> : <path d={direction === 'torn-cut' ? 'M70 545 C103 549 111 570 98 589' : 'M83 548 C114 554 119 574 108 590'} fill="none" stroke="#020305" strokeWidth="7" strokeLinecap="round" />}
    </svg>
  );
}

function TornNavRail({ direction, active, onChange }: { direction: TornDirection; active: string; onChange: (id: string) => void }) {
  const button = (item: typeof NAV[number], utility = false) => (
    <button type="button" key={item.id} className={cn('nd-nav-button nd-torn-button', utility && `nd-torn-${item.id}`, active === item.id && 'is-active')}
      aria-label={item.label} aria-pressed={active === item.id} title={item.label} onClick={() => onChange(item.id)}>
      <Ring icon={item.icon} color={item.color} active={active === item.id} variant={direction} />
    </button>
  );
  return (
    <aside className="nd-sidebar nd-torn-sidebar">
      <div className="nd-brand" title="DropDex"><img src="/logos/dropdexlogo.png" alt="DropDex" /></div>
      <nav aria-label={`${DIRECTIONS.find((d) => d.id === direction)?.title} preview navigation`}>
        {NAV.slice(0, 6).map((item) => button(item))}
      </nav>
      {NAV.slice(6).map((item) => button(item, true))}
    </aside>
  );
}

const TRACKS = [
  { title: 'WIde Open (MAVIC FLIP) Final', artist: 'DISCO LINES', bpm: 140, key: '7A', color: '#8c63ff', duration: '2:47' },
  { title: 'Ring The Alarm (HAHNER Edit)', artist: 'DJ Snake & Malaa', bpm: 145, key: '12A', color: '#ee4aa5', duration: '2:27' },
  { title: 'Disappearance w EVOKE45', artist: 'EVOKE45', bpm: 150, key: '10A', color: '#35d7ce', duration: '3:51' },
];

function Ring({ icon: Icon, color, active, variant }: { icon: ElementType; color: string; active: boolean; variant: Direction }) {
  return (
    <span className="nd-ring" style={{ '--nd-ring-color': variant === 'spine' ? '#e5ecf5' : color } as CSSProperties}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="nd-ring-track" cx="24" cy="24" r="21" />
        <circle className="nd-ring-arc" cx="24" cy="24" r="21" strokeDasharray={active ? '108 132' : '29 132'} />
      </svg>
      <Icon size={20} aria-hidden="true" />
    </span>
  );
}

function NavRail({ direction, active, onChange }: { direction: Direction; active: string; onChange: (id: string) => void }) {
  const button = (item: typeof NAV[number]) => (
    <button
      key={item.id}
      type="button"
      className={cn('nd-nav-button', active === item.id && 'is-active')}
      onClick={() => onChange(item.id)}
      aria-label={item.label}
      aria-pressed={active === item.id}
      title={item.label}
      style={{ '--nd-item-color': direction === 'spine' ? '#e5ecf5' : item.color } as CSSProperties}
    >
      <Ring icon={item.icon} color={item.color} active={active === item.id} variant={direction} />
      <span className="nd-nav-label">{item.label}</span>
    </button>
  );

  return (
    <aside className="nd-sidebar">
      {direction === 'contour' && (
        <svg className="nd-contour-shape" viewBox="0 0 100 540" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0 H32 C49 0 51 28 72 28 H76 Q100 28 100 56 V458 Q100 492 72 492 C46 492 53 540 22 540 H0 Z" />
        </svg>
      )}
      <div className="nd-brand" title="DropDex"><img src="/logos/dropdexlogo.png" alt="DropDex" /><span>DropDex<span className="nd-brand-dot">.</span></span></div>
      <nav aria-label={`${DIRECTIONS.find((d) => d.id === direction)?.title} preview navigation`}>
        <div className="nd-nav-cluster nd-nav-browse">{NAV.slice(0, 3).map(button)}</div>
        <div className="nd-nav-cluster nd-nav-create">{NAV.slice(3, 6).map(button)}</div>
      </nav>
      <div className="nd-nav-cluster nd-nav-utilities">{NAV.slice(6).map(button)}</div>
    </aside>
  );
}

function LibraryContent({ view }: { view: 'overview' | 'playlists' }) {
  return view === 'playlists' ? (
    <div className="nd-playlists">
      {['Peak Time', 'Late Night', 'Heavy Rotation'].map((name, i) => (
        <div key={name} className={`nd-playlist nd-art-${i}`}>
          <Music size={24} /><div><strong>{name}</strong><span>{[18, 15, 12][i]} tracks · {HERO.name}</span></div><ArrowRight size={18} />
        </div>
      ))}
    </div>
  ) : (
    <div className="nd-library-body">
      <div className="nd-track-panel">
        <div className="nd-panel-heading"><h4>Recently added</h4><span>{HERO.tracks} tracks in your library</span></div>
        <table className="nd-tracks">
          <thead><tr><th scope="col">Track / Artist</th><th scope="col">BPM</th><th scope="col">Key</th><th scope="col">Time</th></tr></thead>
          <tbody>{TRACKS.map((track, i) => (
            <tr key={track.title}>
              <td><div className="nd-track-name"><div className={`nd-art nd-art-${i}`}><Music size={16} /></div><div><strong>{track.title}</strong><span>{track.artist}</span></div></div></td>
              <td>{track.bpm}</td><td><span className="nd-key" style={{ color: track.color }}>{track.key}</span></td><td>{track.duration}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="nd-collection">
        <span className="nd-eyebrow">In rotation</span>
        <div className="nd-collection-art"><Waveform size={38} /></div>
        <div><h4>{HERO.largestPlaylist}</h4><p>18 tracks · Ready for your next set</p></div>
        <span className="nd-collection-label">FEATURED PLAYLIST <ArrowRight size={12} /></span>
      </div>
    </div>
  );
}

function NavConcept({ concept, index }: { concept: typeof DIRECTIONS[number]; index: number }) {
  const [active, setActive] = useState('library');
  const [view, setView] = useState<'overview' | 'playlists'>('overview');
  const [playing, setPlaying] = useState(false);
  const Hero = concept.hero;
  const activeLabel = NAV.find((item) => item.id === active)?.label;

  return (
    <section className="nd-concept" aria-labelledby={`nd-title-${concept.id}`}>
      <div className="nd-concept-heading">
        <span className="nd-concept-number" style={{ color: concept.accent }}>{String(index + 1).padStart(2, '0')}</span>
        <div><h3 id={`nd-title-${concept.id}`}>{concept.title}</h3><p>{concept.description}</p></div>
        <span className="nd-pairing">Hero / {concept.pairing}</span>
      </div>
      <div className="nd-preview-scroll" role="region" aria-label={`${concept.title} full layout`} tabIndex={0}>
        <div className={cn('nd-preview', `nd-${concept.id}`, isTorn(concept.id) && 'nd-torn-study')} style={{ '--nd-accent': concept.accent } as CSSProperties}>
          {isTorn(concept.id) ? <><TornPage direction={concept.id} /><TornNavRail direction={concept.id} active={active} onChange={setActive} /></> : <NavRail direction={concept.id} active={active} onChange={setActive} />}
          <div className="nd-canvas">
            <header className="nd-page-header">
              <div className="nd-breadcrumb"><span>Workspace</span><span>/</span><strong>{activeLabel}</strong></div>
              <div className="nd-header-right"><span><CheckmarkFilled size={12} /> All changes synced</span><Search size={16} /><span className="nd-user-avatar">{HERO.initials}</span></div>
            </header>
            <Hero />
            <div className="nd-content-tabs" role="group" aria-label="Library preview content">
              <button type="button" aria-pressed={view === 'overview'} onClick={() => setView('overview')} className={view === 'overview' ? 'is-active' : ''}>Overview</button>
              <button type="button" aria-pressed={view === 'playlists'} onClick={() => setView('playlists')} className={view === 'playlists' ? 'is-active' : ''}>Playlists <span>{HERO.playlists}</span></button>
              <span className="nd-content-summary"><Usb size={12} /> {HERO.usb} · {HERO.analyzed}/{HERO.tracks} analyzed</span>
            </div>
            <LibraryContent view={view} />
            <footer className="nd-player">
              <div className="nd-player-track"><div className="nd-art nd-art-0"><Music size={17} /></div><div><strong>{TRACKS[0].title}</strong><span>{TRACKS[0].artist}</span></div></div>
              <div className="nd-transport">
                <button type="button" aria-label={playing ? 'Pause preview animation' : 'Play preview animation'} aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                <SkipForward size={15} className="nd-skip-icon" aria-hidden="true" />
                <span className={cn('nd-player-wave', playing && 'is-playing')} aria-hidden="true">{Array.from({ length: 38 }, (_, i) => <i key={i} style={{ height: `${5 + ((i * 17 + i * i) % 20)}px`, animationDelay: `${i * -0.07}s` }} />)}</span>
                <span className="nd-player-time">0:00 / 2:47</span>
              </div>
              <span className="nd-preview-label">LAYOUT PREVIEW</span>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}

export function NavDesignMockupsContent() {
  const tornStudies = useRef<HTMLDivElement>(null);
  return (
    <div className="nd-lab">
      <div className="nd-intro"><span className="nd-eyebrow">Layout Lab / Navigation</span><h2>Eight ways into your workspace.</h2><p>Each direction pairs a custom left nav with an existing Hero concept, library content and a player. The three new torn-page studies expose navigation beneath the curved edge of the page, following the reference more closely.</p><button type="button" className="nd-jump-to-torn" onClick={() => tornStudies.current?.scrollIntoView({ block: 'start' })}>View torn-page studies · 06–08 <ArrowRight size={13} /></button></div>
      {DIRECTIONS.slice(0, 5).map((concept, index) => <NavConcept key={concept.id} concept={concept} index={index} />)}
      <div ref={tornStudies} className="nd-torn-studies">
        <div className="nd-torn-studies-heading"><span className="nd-eyebrow">New / Torn-page studies</span><h2>Navigation beneath the page.</h2><p>A black layer revealed by a curved, lifted page edge. Colored rings sit inside the opening; settings sit in their own circular cutout.</p></div>
        {DIRECTIONS.slice(5).map((concept, index) => <NavConcept key={concept.id} concept={concept} index={index + 5} />)}
      </div>
    </div>
  );
}
