import { useState, type CSSProperties } from 'react';
import { ArrowRight, CheckmarkFilled, Music, Pause, Play, Search, SkipForward, Usb, Waveform } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { NAV_ICONS } from '../navigation/NavIcons';
import '../navigation/FloatingSidebar.css';
import { HeroAurora, HeroGlassDuo, HeroPoster, HeroSplitCover, HeroStudioStrip } from './LayoutLabHeroMockups';
import { HERO } from './layoutLabHeroSample';
import './layout-lab-nav-design.css';

// Eight left-nav studies. Every one uses the production nav (the floating graphite capsule, middle left) and the same screen
// around it. What changes from one to the next is the active icon, the way the page name appears when you hover an icon, and
// the finish of the graphite behind the page.

const NAV = [
  { id: 'library', label: 'Library', icon: 'home' },
  { id: 'review', label: 'Review', icon: 'review' },
  { id: 'cues', label: 'Cue Points', icon: 'cues' },
  { id: 'audition', label: 'Audition', icon: 'audition' },
  { id: 'discovery', label: 'Discover', icon: 'discovery' },
  { id: 'drop-lab', label: 'Drop Lab', icon: 'drop-lab' },
  { id: 'flip-lab', label: 'Flip Lab', icon: 'flip-lab' },
  { id: 'usb', label: 'USB Management', icon: 'usb' },
] as const;
const PROFILE = { id: 'profile', label: HERO.name } as const;

const STUDIES: {
  id: string; title: string; active: string; hover: string; look: string; accent: string; hero: typeof HeroAurora;
  activeNote: string; hoverNote: string; lookNote: string; pairing: string;
}[] = [
  { id: 'ember', title: 'Ember Disc', active: 'ember', hover: 'pill', look: 'graphite', accent: '#ff4e4f', hero: HeroAurora, pairing: 'Aurora Banner',
    activeNote: 'A red-tinted raised disc with a glow and a tab on the capsule edge (as in production).', hoverNote: 'The name slides open to the right inside a raised graphite pill (as in production).', lookNote: 'The production graphite: soft gradient, hairlines, matte.' },
  { id: 'orbit', title: 'Orbit Ring', active: 'orbit', hover: 'bubble', look: 'slate', accent: '#f78361', hero: HeroGlassDuo, pairing: 'Glass Duo',
    activeNote: 'A thin glowing ring around the icon, with no fill.', hoverNote: 'A tooltip with an arrow floats in beside the icon and settles into place.', lookNote: 'Cool slate graphite with a faint dot grid.' },
  { id: 'well', title: 'Sunken Well', active: 'well', hover: 'reveal', look: 'warm', accent: '#78adff', hero: HeroPoster, pairing: 'Centered Poster',
    activeNote: 'The icon sits in a recessed well, lit from underneath, with a light beam on the edge.', hoverNote: 'Spaced capitals are wiped in from left to right with a short accent line.', lookNote: 'Warm graphite with a fine film grain.' },
  { id: 'gem', title: 'Cut Gem', active: 'gem', hover: 'tag', look: 'deep', accent: '#2ce6aa', hero: HeroStudioStrip, pairing: 'Studio Strip',
    activeNote: 'A rounded tile cut like a gem: lit from above, with a bright icon.', hoverNote: 'A pointed tag springs out from the icon with a slight overshoot.', lookNote: 'Deep graphite with darker corners and stronger shadows.' },
  { id: 'glow', title: 'Underglow', active: 'glow', hover: 'line', look: 'satin', accent: '#b59bff', hero: HeroSplitCover, pairing: 'Split Cover',
    activeNote: 'No disc: the icon glows and a short bar lights up under it.', hoverNote: 'A hairline draws out from the capsule, then the name fades in at its end.', lookNote: 'Satin graphite with a soft diagonal sheen.' },
  { id: 'shelf', title: 'Edge Shelf', active: 'shelf', hover: 'glass', look: 'weave', accent: '#f0b35a', hero: HeroAurora, pairing: 'Aurora Banner',
    activeNote: 'The active button stretches to the capsule edge as a shelf, with an accent bar.', hoverNote: 'A frosted glass flyout with the name and a shortcut slides in and sharpens.', lookNote: 'Graphite with a fine woven hatch.' },
  { id: 'beam', title: 'Beam Dots', active: 'beam', hover: 'spring', look: 'frost', accent: '#ff8fa3', hero: HeroPoster, pairing: 'Centered Poster',
    activeNote: 'A hairline ring with a small dot on each side of the icon.', hoverNote: 'The pill grows with a springy overshoot and shows a shortcut chip.', lookNote: 'Frosted graphite with a soft light in the top left.' },
  { id: 'engraved', title: 'Engraved Dial', active: 'engraved', hover: 'type', look: 'brushed', accent: '#c8d2df', hero: HeroGlassDuo, pairing: 'Glass Duo',
    activeNote: 'A metal dial: a bright conic rim around a dark centre.', hoverNote: 'The name is typed out in a mono font with a blinking caret.', lookNote: 'Brushed graphite with horizontal grain.' },
];

const TRACKS = [
  { title: 'WIde Open (MAVIC FLIP) Final', artist: 'DISCO LINES', bpm: 140, key: '7A', color: '#8c63ff', duration: '2:47' },
  { title: 'Ring The Alarm (HAHNER Edit)', artist: 'DJ Snake & Malaa', bpm: 145, key: '12A', color: '#ee4aa5', duration: '2:27' },
  { title: 'Disappearance w EVOKE45', artist: 'EVOKE45', bpm: 150, key: '10A', color: '#35d7ce', duration: '3:51' },
];

function MockNav({ study, active, onChange }: { study: typeof STUDIES[number]; active: string; onChange: (id: string) => void }) {
  return (
    <aside className="nd-sidebar">
      <nav className="sidebar-capsule nd-capsule" aria-label={`${study.title} navigation`}>
        <div className="nd-logo"><img src="/logos/dropdexlogo.png" alt="DropDex" /></div>
        {NAV.map((item, i) => {
          const Icon = NAV_ICONS[item.icon];
          return (
            <div className="nd-slot" key={item.id}>
              <button
                type="button"
                className="nd-btn"
                data-state={active === item.id ? 'active' : undefined}
                aria-label={item.label}
                aria-pressed={active === item.id}
                onClick={() => onChange(item.id)}
              >
                <span className="nd-ico"><Icon size={24} /></span>
                <span className="nd-lbl" style={{ '--nd-chars': item.label.length } as CSSProperties}><b>{item.label}</b><small>⌘{i + 1}</small></span>
              </button>
            </div>
          );
        })}
        <div className="nd-slot">
          <button type="button" className="nd-btn" data-state={active === PROFILE.id ? 'active' : undefined} aria-label={PROFILE.label} aria-pressed={active === PROFILE.id} onClick={() => onChange(PROFILE.id)}>
            <span className="nd-ico"><span className="nd-avatar">{HERO.initials}</span></span>
            <span className="nd-lbl" style={{ '--nd-chars': PROFILE.label.length } as CSSProperties}><b>{PROFILE.label}</b><small>Profile</small></span>
          </button>
        </div>
      </nav>
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

function NavConcept({ study, index }: { study: typeof STUDIES[number]; index: number }) {
  const [active, setActive] = useState('library');
  const [view, setView] = useState<'overview' | 'playlists'>('overview');
  const [playing, setPlaying] = useState(false);
  const Hero = study.hero;
  const activeLabel = [...NAV, PROFILE].find((item) => item.id === active)?.label;

  return (
    <section className="nd-concept" aria-labelledby={`nd-title-${study.id}`} data-testid="nav-study" data-study={study.id}>
      <div className="nd-concept-heading">
        <span className="nd-concept-number" style={{ color: study.accent }}>{String(index + 1).padStart(2, '0')}</span>
        <div>
          <h3 id={`nd-title-${study.id}`}>{study.title}</h3>
          <p><b>Active:</b> {study.activeNote} <b>Hover:</b> {study.hoverNote} <b>Surface:</b> {study.lookNote}</p>
        </div>
        <span className="nd-pairing">Hero / {study.pairing}</span>
      </div>
      <div className="nd-preview-scroll" role="region" aria-label={`${study.title} full layout`} tabIndex={0}>
        <div className={cn('nd-preview', `nd-look-${study.look}`, `nd-act-${study.active}`, `nd-hov-${study.hover}`)} style={{ '--nd-accent': study.accent } as CSSProperties}>
          <MockNav study={study} active={active} onChange={setActive} />
          <div className="nd-canvas">
            <header className="nd-page-header">
              <div className="nd-breadcrumb"><span>Workspace</span><span>/</span><strong>{activeLabel}</strong></div>
              <div className="nd-header-right"><span><CheckmarkFilled size={12} /> All changes synced</span><Search size={16} /><span className="nd-user-avatar">{HERO.initials}</span></div>
            </header>
            <div className="nd-hero-wrap"><Hero /></div>
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
  return (
    <div className="nd-lab">
      <div className="nd-intro">
        <span className="nd-eyebrow">Layout Lab / Navigation</span>
        <h2>One nav, eight finishes.</h2>
        <p>Every study uses the production left nav: the floating graphite capsule on the middle left. The screen around it keeps the same layout. Each study changes three things: how the active icon looks, how the page name appears when you hover an icon (try it), and the finish of the graphite behind the page. Click an icon to move the active state.</p>
      </div>
      {STUDIES.map((study, index) => <NavConcept key={study.id} study={study} index={index} />)}
    </div>
  );
}
