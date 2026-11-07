import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Add, Checkmark, ChevronRight, Close, Play, Search, Shuffle } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import { CARD_KINDS, COMPATIBLE_KEYS, GENRES, RECENT_SEARCHES, SAMPLE, SEARCH_SCOPES, WEEK_DAYS, WEEK_SETS, type CardKind } from './layoutLabDiscoveryData';
import './layout-lab-discovery.css';

// Three groups of mockups for the Discovery page, all in the premium graphite look: genre filter rows, rows of five cards
// (artist, genre, DJ set, artist count, genre count) and hero sections for the top of the page.

const hue = (pair: readonly [string, string]) => ({ '--ld-h1': pair[0], '--ld-h2': pair[1] }) as CSSProperties;

function RowHeading({ n, title, concept }: { n: number; title: string; concept: string }) {
  return (
    <div className="ld-row-heading">
      <span className="ld-row-number">{n}</span>
      <strong>{title}</strong>
      <span>{concept}</span>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="ld-section">
      <div className="ld-section-heading"><h2>{title}</h2><p>{note}</p></div>
      {children}
    </section>
  );
}

// ── 1 · Genre filter rows ────────────────────────────────────────────────────

/** Underlined tabs, like production: All first, a coral underline on the picked genre, a Clear button. */
function GenreTabs() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="ld-genres ld-g-tabs">
      <span className="ld-label">Genre</span>
      <div className="ld-g-scroll">
        <button type="button" aria-pressed={picked === null} onClick={() => setPicked(null)}>All</button>
        {GENRES.map((g) => <button key={g.name} type="button" aria-pressed={picked === g.name} onClick={() => setPicked(g.name)}>{g.name}<small>{g.count}</small></button>)}
      </div>
      {picked && <button type="button" className="ld-g-clear" onClick={() => setPicked(null)}><Close size={12} /> Clear</button>}
    </div>
  );
}

/** Raised chips: each genre is a small raised pill; the picked one glows coral. */
function GenreChips() {
  const [picked, setPicked] = useState('Future Bass');
  return (
    <div className="ld-genres ld-g-chips">
      <span className="ld-label">Genre</span>
      <div className="ld-g-scroll">
        {GENRES.map((g) => <button key={g.name} type="button" aria-pressed={picked === g.name} onClick={() => setPicked(g.name)}>{g.name}<small>{g.count}</small></button>)}
      </div>
    </div>
  );
}

/** Segmented rail: one sunken track, a lit thumb that slides to the picked genre. */
function GenreRail() {
  const options = ['All', ...GENRES.slice(0, 5).map((g) => g.name)];
  const [index, setIndex] = useState(0);
  return (
    <div className="ld-genres ld-g-rail">
      <span className="ld-label">Genre</span>
      <div className="ld-g-track" style={{ '--ld-idx': index, '--ld-n': options.length } as CSSProperties} role="group" aria-label="Genre">
        <span className="ld-g-thumb" aria-hidden="true" />
        {options.map((name, i) => <button key={name} type="button" aria-pressed={index === i} onClick={() => setIndex(i)}>{name}</button>)}
      </div>
      <button type="button" className="ld-g-more">More genres <ChevronRight size={12} /></button>
    </div>
  );
}

/** Search and multi-select: a filter box, then tags you can tick several of, with a running count. */
function GenreMulti() {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(['Melodic Dubstep', 'Riddim']);
  const shown = GENRES.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  return (
    <div className="ld-genres ld-g-multi">
      <label className="ld-g-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter genres…" aria-label="Filter genres" /></label>
      <div className="ld-g-scroll">
        {shown.map((g, i) => (
          <button key={g.name} type="button" aria-pressed={picked.includes(g.name)} onClick={() => toggle(g.name)}>
            <i style={{ background: ['#8c63ff', '#35d7ce', '#ee4aa5', '#f0b35a', '#78adff'][i % 5] }} />
            {g.name}
            {picked.includes(g.name) && <Checkmark size={12} />}
          </button>
        ))}
      </div>
      <span className="ld-g-count">{picked.length} selected{picked.length > 0 && <button type="button" onClick={() => setPicked([])}>Clear</button>}</span>
    </div>
  );
}

// ── 2 · Cards ────────────────────────────────────────────────────────────────

const A = SAMPLE.artist;
const S = SAMPLE.set;

/** Style A, Studio: the production layout. Content stacked from the top, a hairline, then a footer line with an arrow. */
function CardStudio({ kind }: { kind: CardKind }) {
  const foot = (text: ReactNode) => <span className="ld-a-foot">{text}<ChevronRight size={16} /></span>;
  switch (kind) {
    case 'artist': return <div className="ld-a-card"><span className="ld-avatar" style={hue(A.hue)}>{A.initials}</span><span><b className="ld-a-name">{A.name}</b><span className="ld-a-sub">{A.genres}</span></span>{foot(<span><em>{A.sets}</em><small>Sets</small></span>)}</div>;
    case 'genre': return <div className="ld-a-card"><span><em className="ld-a-figure">{SAMPLE.genre.artists}</em><small className="ld-a-label">Artists</small></span><span className="ld-a-spacer" />{foot(<b className="ld-a-name">{SAMPLE.genre.name}</b>)}</div>;
    case 'set': return <div className="ld-a-card ld-a-set"><span className="ld-a-art" style={hue(S.hue)}><Play size={22} /></span><span><b className="ld-a-title">{S.title}</b><span className="ld-a-sub">{S.date} · {S.identified}% identified</span></span></div>;
    case 'artists': return <div className="ld-a-card"><span><em className="ld-a-figure">{SAMPLE.artists.value}</em><small className="ld-a-label">{SAMPLE.artists.label}</small></span><span className="ld-a-spacer" />{foot(<span className="ld-a-sub">{SAMPLE.artists.note}</span>)}</div>;
    case 'genres': return <div className="ld-a-card"><span><em className="ld-a-figure">{SAMPLE.genres.value}</em><small className="ld-a-label">{SAMPLE.genres.label}</small></span><span className="ld-a-spacer" />{foot(<span className="ld-a-sub">{SAMPLE.genres.note}</span>)}</div>;
  }
}

/** Style B, Raised: everything centred on raised cards with a lit rim and fine grain; the figures sit inside rings. */
function Ring({ value, label }: { value: ReactNode; label: string }) {
  return <span className="ld-b-ring"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" /><circle cx="40" cy="40" r="34" className="ld-b-arc" /></svg><span><em>{value}</em><small>{label}</small></span></span>;
}
function CardRaised({ kind }: { kind: CardKind }) {
  switch (kind) {
    case 'artist': return <div className="ld-b-card"><span className="ld-avatar ld-b-avatar" style={hue(A.hue)}>{A.initials}</span><b>{A.name}</b><span className="ld-b-sub">{A.genres}</span><span className="ld-b-chip">{A.sets} sets</span></div>;
    case 'genre': return <div className="ld-b-card"><Ring value={SAMPLE.genre.artists} label="Artists" /><b>{SAMPLE.genre.name}</b><span className="ld-b-chip">Open genre <ArrowRight size={12} /></span></div>;
    case 'set': return <div className="ld-b-card"><span className="ld-b-disc" style={hue(S.hue)}><Play size={18} /></span><b>{S.title}</b><span className="ld-b-sub">{S.artist} · {S.date}</span><span className="ld-b-chip">{S.identified}% identified</span></div>;
    case 'artists': return <div className="ld-b-card"><Ring value={SAMPLE.artists.value} label={SAMPLE.artists.label} /><span className="ld-b-sub">{SAMPLE.artists.note}</span></div>;
    case 'genres': return <div className="ld-b-card"><Ring value={SAMPLE.genres.value} label={SAMPLE.genres.label} /><span className="ld-b-sub">{SAMPLE.genres.note}</span></div>;
  }
}

/** Style C, Wells: compact horizontal wells, sunk into a brushed surface. The figure or picture is on the left, the words and a chevron on the right. */
function CardWell({ kind }: { kind: CardKind }) {
  switch (kind) {
    case 'artist': return <div className="ld-c-card"><span className="ld-avatar ld-c-avatar" style={hue(A.hue)}>{A.initials}</span><span className="ld-c-copy"><b>{A.name}</b><span>{A.genres}</span><small>{A.sets} sets</small></span><ChevronRight size={16} /></div>;
    case 'genre': return <div className="ld-c-card"><em className="ld-c-figure">{SAMPLE.genre.artists}</em><span className="ld-c-copy"><b>{SAMPLE.genre.name}</b><small>Artists</small></span><ChevronRight size={16} /></div>;
    case 'set': return <div className="ld-c-card"><span className="ld-c-art" style={hue(S.hue)}><Play size={16} /></span><span className="ld-c-copy"><b>{S.title}</b><span>{S.date}</span><small>{S.identified}% identified</small></span><ChevronRight size={16} /></div>;
    case 'artists': return <div className="ld-c-card ld-c-count"><em className="ld-c-figure">{SAMPLE.artists.value}</em><span className="ld-c-copy"><b>{SAMPLE.artists.label}</b><small>{SAMPLE.artists.note}</small></span></div>;
    case 'genres': return <div className="ld-c-card ld-c-count"><em className="ld-c-figure">{SAMPLE.genres.value}</em><span className="ld-c-copy"><b>{SAMPLE.genres.label}</b><small>{SAMPLE.genres.note}</small></span></div>;
  }
}

/** Style D, Poster: tall cards with a coloured picture filling the top and a frosted plate across the bottom holding the words. */
function CardPoster({ kind }: { kind: CardKind }) {
  const poster = (art: ReactNode, pair: readonly [string, string], plate: ReactNode) => (
    <div className="ld-d-card" style={hue(pair)}><span className="ld-d-art">{art}</span><span className="ld-d-plate">{plate}</span></div>
  );
  switch (kind) {
    case 'artist': return poster(<span className="ld-d-mark">{A.initials}</span>, A.hue, <><b>{A.name}</b><span>{A.genres}</span><small>{A.sets} sets</small></>);
    case 'genre': return poster(<span className="ld-d-big">{SAMPLE.genre.artists}</span>, SAMPLE.genre.hue, <><b>{SAMPLE.genre.name}</b><small>Artists</small></>);
    case 'set': return poster(<span className="ld-d-play"><Play size={20} /></span>, S.hue, <><b>{S.title}</b><span>{S.artist} · {S.date}</span><small>{S.identified}% identified</small></>);
    case 'artists': return poster(<span className="ld-d-big">{SAMPLE.artists.value}</span>, ['#5fd0b8', '#1e3a3c'], <><b>{SAMPLE.artists.label}</b><small>{SAMPLE.artists.note}</small></>);
    case 'genres': return poster(<span className="ld-d-big">{SAMPLE.genres.value}</span>, ['#b59bff', '#2b2552'], <><b>{SAMPLE.genres.label}</b><small>{SAMPLE.genres.note}</small></>);
  }
}

// ── 3 · Hero sections ────────────────────────────────────────────────────────

/** Set Builder: what a DJ asks first, "what fits next?". The track now playing sets the tempo and key; chips narrow it. */
function HeroSetBuilder() {
  const [key, setKey] = useState('7A');
  const [bpm, setBpm] = useState(4);
  return (
    <div className="ld-hero ld-h-builder">
      <div className="ld-h-main">
        <span className="ld-label">Building your set · 140 BPM · 7A</span>
        <h3>What do you need next?</h3>
        <label className="ld-h-search"><Search size={16} /><input placeholder="Search artists, sets or genres that fit…" aria-label="Search" /></label>
        <div className="ld-h-filters">
          <span className="ld-h-group"><small>Tempo</small>
            <button type="button" aria-label="Narrower" onClick={() => setBpm(Math.max(1, bpm - 1))}>−</button><b>{140 - bpm}–{140 + bpm}</b><button type="button" aria-label="Wider" onClick={() => setBpm(Math.min(10, bpm + 1))}>+</button>
          </span>
          <span className="ld-h-group"><small>Key</small>
            {COMPATIBLE_KEYS.map((k) => <button key={k.key} type="button" aria-pressed={key === k.key} title={k.note} onClick={() => setKey(k.key)}><i style={{ background: k.color }} />{k.key}</button>)}
          </span>
          <span className="ld-h-group"><small>Genre</small><button type="button" aria-pressed>Melodic Dubstep</button></span>
        </div>
      </div>
      <div className="ld-h-side">
        <em>312</em><small>Compatible sets</small>
        <ControlButton variant="primary"><ArrowRight size={14} /> Show matches</ControlButton>
      </div>
    </div>
  );
}

/** Fresh This Week: what changed since the DJ last looked, as three figures and a week of activity. */
function HeroFresh() {
  const max = Math.max(...WEEK_SETS);
  return (
    <div className="ld-hero ld-h-fresh">
      <div className="ld-h-main">
        <span className="ld-label">Since your last visit</span>
        <h3>Fresh this week</h3>
        <div className="ld-h-figures">
          <span><em>47</em><small>New sets</small></span>
          <span><em>12</em><small>New artists</small></span>
          <span><em>Riddim</em><small>Trending genre · +18%</small></span>
        </div>
        <div className="ld-h-actions">
          <ControlButton variant="primary"><ArrowRight size={14} /> See what’s new</ControlButton>
          <ControlButton variant="secondary"><Shuffle size={14} /> Surprise me</ControlButton>
        </div>
      </div>
      <div className="ld-h-week" aria-label="Sets added each day this week">
        <small>Sets added per day</small>
        <div>{WEEK_SETS.map((n, i) => <span key={i} style={{ '--ld-bar': `${(n / max) * 100}%` } as CSSProperties}><i /><b>{WEEK_DAYS[i]}</b></span>)}</div>
      </div>
    </div>
  );
}

/** Crate Digger: one big search with what you are searching for, your recent searches, and picks from your genres. */
function HeroDigger() {
  const [scope, setScope] = useState<string>(SEARCH_SCOPES[0]);
  return (
    <div className="ld-hero ld-h-digger">
      <div className="ld-h-tabs" role="tablist" aria-label="Search for">
        {SEARCH_SCOPES.map((s) => <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)}>{s}</button>)}
      </div>
      <label className="ld-h-search ld-h-search-big"><Search size={20} /><input placeholder={`Search ${scope.toLowerCase()}…`} aria-label="Search" /></label>
      <div className="ld-h-recent"><small>Recent</small>{RECENT_SEARCHES.map((r) => <button key={r} type="button">{r}</button>)}</div>
      <div className="ld-h-picks">
        <small>Because you play Melodic Dubstep</small>
        {[['Au5', '18 sets fit your tempo'], ['Dubloadz', 'New set this week'], ['Seven Lions', 'Shares 4 genres with ILLENIUM']].map(([name, why], i) => (
          <button key={name} type="button"><span className="ld-avatar ld-h-mini" style={hue([['#5fd0b8', '#1e3a3c'], ['#f0b35a', '#4a2a2a'], ['#8c63ff', '#2b2552']][i] as [string, string])}>{name.slice(0, 2).toUpperCase()}</span><span><b>{name}</b><small>{why}</small></span><ChevronRight size={14} /></button>
        ))}
      </div>
    </div>
  );
}

/** Spotlight: one artist picked for you, with the reasons, the set to start with and a way to keep it for later. */
function HeroSpotlight() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="ld-hero ld-h-spot">
      <span className="ld-avatar ld-h-big-avatar" style={hue(['#5fd0b8', '#1e3a3c'])}>AU</span>
      <div className="ld-h-main">
        <span className="ld-label">Picked for you today</span>
        <h3>Au5</h3>
        <ul>
          <li><Checkmark size={13} /> Shares Melodic Dubstep and Future Bass with your favorite ILLENIUM</li>
          <li><Checkmark size={13} /> 18 of 63 sets sit in your 136–144 BPM range</li>
          <li><Checkmark size={13} /> Often plays 7A and 8A, keys that mix with your set</li>
        </ul>
        <div className="ld-h-actions">
          <ControlButton variant="primary"><ArrowRight size={14} /> Open artist</ControlButton>
          <ControlButton variant="secondary" onClick={() => setSaved(!saved)}>{saved ? <Checkmark size={14} /> : <Add size={14} />} {saved ? 'In your crate' : 'Add to crate'}</ControlButton>
        </div>
      </div>
      <div className="ld-h-set">
        <small>Start with this set</small>
        <span className="ld-h-set-art" style={hue(['#f0b35a', '#4a2a2a'])}><Play size={20} /></span>
        <b>Ultra Miami 2025 · Live</b>
        <span>2025-03-28 · 91% identified</span>
        <span className="ld-h-wave" aria-hidden="true">{Array.from({ length: 30 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 11 + i * i) % 18)}px` }} />)}</span>
      </div>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

const CARD_STYLES = [
  { id: 'studio', title: 'Studio', concept: 'The production layout: stacked from the top, a hairline, a footer with an arrow. Flat graphite with a hairline edge.', Card: CardStudio },
  { id: 'raised', title: 'Raised', concept: 'Everything centred on raised cards with a lit rim and fine grain; the figures sit inside rings.', Card: CardRaised },
  { id: 'wells', title: 'Wells', concept: 'Compact horizontal wells sunk into a brushed surface: the figure or picture left, the words right.', Card: CardWell },
  { id: 'poster', title: 'Poster', concept: 'Tall posters: a coloured picture over a dotted grid, and a frosted plate holding the words.', Card: CardPoster },
];

const GENRE_ROWS = [
  { id: 'tabs', title: 'Underlined Tabs', concept: 'The production row: plain words, a coral underline on the picked genre, a Clear button.', Row: GenreTabs },
  { id: 'chips', title: 'Raised Chips', concept: 'Each genre is a small raised pill; the picked one glows coral.', Row: GenreChips },
  { id: 'rail', title: 'Sliding Rail', concept: 'One sunken track with a lit thumb that slides to the picked genre.', Row: GenreRail },
  { id: 'multi', title: 'Search and Multi-select', concept: 'A filter box, then tags you can tick several of, with a running count.', Row: GenreMulti },
];

const HEROES = [
  { id: 'builder', title: 'Set Builder', concept: 'For the DJ in the middle of a set: what fits next, by tempo, key and genre.', Hero: HeroSetBuilder },
  { id: 'fresh', title: 'Fresh This Week', concept: 'What is new since the last visit: new sets, new artists, the trending genre.', Hero: HeroFresh },
  { id: 'digger', title: 'Crate Digger', concept: 'One big search, recent searches, and picks from the genres you play.', Hero: HeroDigger },
  { id: 'spotlight', title: 'Spotlight', concept: 'One artist picked for you, with the reasons and a set to start with.', Hero: HeroSpotlight },
];

export function DiscoveryMockupsContent() {
  return (
    <div className="ld-lab" data-testid="discovery-mockups">
      <div className="ld-intro">
        <span className="ld-label">Layout Lab / Discovery</span>
        <h1>Discovery, in graphite.</h1>
        <p>Twelve mockups for the Discovery page in the premium graphite look: four genre filter rows, four rows of five cards, and four hero sections for the top of the page. The filters, tabs and chips are live.</p>
      </div>

      <Section title="Genre filter rows" note="Four ways to filter by genre. Click to pick.">
        {GENRE_ROWS.map(({ id, title, concept, Row }, i) => (
          <div key={id} className="ld-row" data-testid="genre-row" data-style={id}><RowHeading n={i + 1} title={title} concept={concept} /><div className="ld-stage"><Row /></div></div>
        ))}
      </Section>

      <Section title="Cards" note="Each row, left to right: an artist, a genre, a DJ set, the artist count and the genre count.">
        {CARD_STYLES.map(({ id, title, concept, Card }, i) => (
          <div key={id} className="ld-row" data-testid="card-row" data-style={id}>
            <RowHeading n={i + 1} title={title} concept={concept} />
            <div className={cn('ld-stage ld-cards', `ld-cards-${id}`)}>{CARD_KINDS.map((kind) => <Card key={kind} kind={kind} />)}</div>
          </div>
        ))}
      </Section>

      <Section title="Hero sections" note="Four headers for the top of Discovery, written for a DJ looking for something to play.">
        {HEROES.map(({ id, title, concept, Hero }, i) => (
          <div key={id} className="ld-row" data-testid="hero-row" data-style={id}><RowHeading n={i + 1} title={title} concept={concept} /><div className="ld-stage"><Hero /></div></div>
        ))}
      </Section>
    </div>
  );
}
