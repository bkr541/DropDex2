import { useState, type ReactNode } from 'react';
import { Bell, Download, Folder, Plus, Search, Trash } from 'iconoir-react/regular';
import { CheckboxControl, ContextMenu, ControlButton, DualRangeSlider, FilterDropdown, FormField, IconControlButton, Knob, SearchControl, SelectControl, TextareaControl, TextControl, ToolbarIconButton, ToolbarIconGroup, ToolbarRow } from './controls';
import {
  AnalysisStatusBadge, CircularProgress, Dialog, EmptyState, ImportActivityBanner, NoticeCard, NotificationCard, ProgressBar, QuietProgress, SelectableOptionCard,
  ListingSkeleton, PageSkeleton, SkeletonBlock, TrackPanelSkeleton, SkeletonRow, StatusBadge, StatusDot, StatusLoader, quietOverallPercent,
} from './feedback';
import { RecordTrackListing } from './display/RecordTrackListing';
import type { RekordboxTrack } from '../../types';
import { Artwork, Avatar, Divider, StatTile, SurfaceCard, TabNavigation, TrackIdentity, TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell } from './display';
import {
  AudioDock, MediaTransportControlGroup, PlaybackSeekBar, TimelineBeatLane, TimelineSectionLane, TransportButton, WaveformZoomControls,
} from './media';
import { WaveformCueMarker } from './media/WaveformCueMarker';
import { WaveformSectionRow } from './media/WaveformSectionRow';
import { WaveformTimeRuler } from './media/WaveformTimeRuler';
import type { AnalysisBadgeState } from './feedback/AnalysisStatusBadge';
import type { LoaderVariant } from './feedback/StatusLoader';
import './layout-lab-popovers.css';
import './layout-lab-reusable.css';

// Layout Lab / Reusable: every reusable component in src/components/ui that the app uses, one row each, labelled by the file it is
// imported from. Each row renders the real component on sample data. Nothing here is a copy, so changing a component (or its
// stylesheet) changes this row and every place in the app that uses it.

const noop = () => {};

// The screens that use each component are found by reading the app's own source: every file (outside this component library) that
// renders the component counts, and its path is turned into the name of the screen. It updates itself as the app changes.
const SOURCES = import.meta.glob(['/src/**/*.tsx', '!/src/**/*.test.tsx', '!/src/components/ui/LayoutLab*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const SCREEN_RULES: Array<[RegExp, string]> = [
  [/\/App\.tsx$/, 'App shell (Playlists, Profile frame)'],
  [/library\/(LibraryView|LibraryHero|LibraryGhostHero|HeroActionButton|LibrarySearchResults)\.tsx$/, 'Home'],
  [/library\/ArtistLibraryView\.tsx$/, 'Artist Library'],
  [/library\/TrackDetailView\.tsx$/, 'Track detail'],
  [/library\/PlaylistEditView\.tsx$/, 'Playlist edit'],
  [/library\//, 'Library import preview'],
  [/\/audition\//, 'Audition'],
  [/\/cues\//, 'Cue Points'],
  [/\/discovery\//, 'Discovery'],
  [/\/drop-lab\//, 'Drop Lab'],
  [/set-lab\//, 'Set Lab'],
  [/\/flip-lab\//, 'Flip Lab'],
  [/usb-management\//, 'USB Management'],
  [/\/usb\//, 'USB connection'],
  [/profile\/(DeveloperTab)/, 'Profile › Developer'],
  [/profile\/(SoundCloudTab|ExternalMusicTab|Spotify)/, 'Profile › Music'],
  [/profile\/RekordboxXml/, 'Profile › Rekordbox XML'],
  [/profile\/(UsbLibrarySections|ImportSnapshotRow|UsbStat|StreamingSyncGroup|TrackSyncSelector)/, 'Profile › Library'],
  [/profile\/(EditProfileView|ProfileSwitch)/, 'Profile › Account'],
  [/profile\/DisplayPreferencesGroup|profile\/DashboardWidgetsGroup/, 'Profile › Personalization'],
  [/\/profile\//, 'Profile'],
  [/\/navigation\//, 'Navigation'],
  [/\/player\//, 'Audio dock'],
  [/\/(Import[A-Za-z]*|Resume[A-Za-z]*|BackgroundImportPanel)\.tsx$/, 'Rekordbox import'],
  [/\/(DeleteAllLibrariesModal|DeleteLibraryModal)\.tsx$/, 'Delete popovers'],
  [/\/AuthGate\.tsx$/, 'Sign in'],
  [/\/(RouteStates|StartupConfigurationError)\.tsx$|\/errors\//, 'Error screens'],
];

function screenFor(path: string): string {
  for (const [pattern, label] of SCREEN_RULES) if (pattern.test(path)) return label;
  return path.replace(/^\/src\//, '').replace(/\.tsx$/, '');
}

const NAMES: Record<string, string[]> = {
  'ToolbarIconButton.tsx': ['ToolbarIconButton', 'ToolbarIconGroup'],
  'NotificationCenter.tsx (NotificationCard)': ['NotificationCard', 'NotificationCenter'],
  'TrackTable.tsx': ['TrackTable', 'TrackNameCell', 'TrackTableHead', 'TrackTableHeadCell', 'TrackTableBody'],
  'TimelineLanes.tsx': ['TimelineLane', 'TimelineSectionLane', 'TimelineBeatLane'],
  'WaveformCueMarker.tsx': ['WaveformCueMarker', 'CueFlag'],
};

const exportedNames = (source: string) => [...source.matchAll(/export (?:function|const) ([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1]);

/** Screens that render any of these components. A use inside another reusable component counts as a use on that component's screens. */
function screensForNames(names: string[], seen: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const [path, source] of Object.entries(SOURCES)) {
    const tags = names.flatMap((name) => [name, ...[...source.matchAll(new RegExp(`\\b${name} as ([A-Za-z0-9_]+)`, 'g'))].map((match) => match[1])]);
    if (!tags.some((tag) => new RegExp(`<${tag}[\\s/>]`).test(source))) continue;
    if (path.startsWith('/src/components/ui/')) {
      const consumers = exportedNames(source).filter((name) => !names.includes(name) && !seen.has(name));
      consumers.forEach((name) => seen.add(name));
      if (consumers.length > 0) screensForNames(consumers, seen).forEach((screen) => found.add(screen));
    } else {
      found.add(screenFor(path));
    }
  }
  return found;
}

function screensUsing(file: string): string[] {
  const names = NAMES[file] ?? [file.replace(/\.tsx.*$/, '')];
  return [...screensForNames(names, new Set(names))].sort();
}

function Row({ rowNumber, file, children, overlay = false }: { rowNumber: number; file: string; children: ReactNode; overlay?: boolean }) {
  const screens = screensUsing(file);
  return (
    <section className="rb-row" data-testid="reusable-row">
      <div>
        <p className="rb-file">#{rowNumber} {file}</p>
        <p className="rb-used-label">Used in</p>
        {screens.length > 0 ? (
          <ul className="rb-used">{screens.map((screen) => <li key={screen}>{screen}</li>)}</ul>
        ) : (
          <p className="rb-used rb-used--none">Not used on a screen yet</p>
        )}
      </div>
      <div className={`rb-stage${overlay ? ' pop-stage' : ''}`}>{children}</div>
    </section>
  );
}

const SAMPLE_TRACKS = [
  { id: 'sample-1', import_id: 'sample-import', rekordbox_content_id: '1001', title: 'Pop Lock And Drop It', artist: 'Sidequest', album: 'Warm Up', genre: 'Progressive House', bpm: 128, camelot_key: '8A', musical_key: 'Am', file_format: 'MP3', date_added: '2026-11-09', duration_ms: 372000, file_path: '/Contents/Sidequest/Pop Lock And Drop It.mp3', comments: 'Opener', rating: 4, analysis_parse_status: 'completed', created_at: '2026-11-09T00:00:00Z' },
  { id: 'sample-2', import_id: 'sample-import', rekordbox_content_id: '1002', title: 'Midnight Run', artist: 'Lumen', album: null, genre: 'Techno', bpm: 132, camelot_key: '5A', musical_key: 'Cm', file_format: 'WAV', date_added: '2026-11-08', duration_ms: 410000, file_path: '/Contents/Lumen/Midnight Run.wav', comments: null, rating: 3, analysis_parse_status: 'partial', created_at: '2026-11-08T00:00:00Z' },
] as unknown as RekordboxTrack[];
const SAMPLE_COUNTS = { counts: new Map([['sample-1', 2], ['sample-2', 0]]), loading: false, error: null, retry: noop };

const PHASES = [{ id: 'a', label: 'Source' }, { id: 'b', label: 'Upload' }, { id: 'c', label: 'Analyze' }, { id: 'd', label: 'Complete' }] as const;
const BADGES: AnalysisBadgeState[] = ['not-analyzed', 'analyzing', 'bpm', 'waveform', 'key', 'complete', 'failed', 'partial', 'reused'];
const LOADERS: LoaderVariant[] = ['spinner', 'dual-ring', 'pulse', 'bars', 'wave', 'dots'];
const SECTIONS = [
  { id: '1', label: 'Intro', color: '#5aa9d1', leftPercent: 0, widthPercent: 25 },
  { id: '2', label: 'Build', color: '#a087d8', leftPercent: 25, widthPercent: 30 },
  { id: '3', label: 'Drop', color: '#d86c7d', leftPercent: 55, widthPercent: 30 },
];

export function ReusableMockupsContent() {
  const [checked, setChecked] = useState(true);
  const [range, setRange] = useState<[number, number]>([118, 132]);
  const [knob, setKnob] = useState(0);
  const [tab, setTab] = useState('overview');
  const [option, setOption] = useState('dark');
  const [filter, setFilter] = useState('all');
  const [playing, setPlaying] = useState(false);
  const [seek, setSeek] = useState(42);
  return (
    <div className="rb-lab" data-testid="reusable-mockups">
      <div className="rb-intro">
        <span>Layout Lab / Reusable</span>
        <h1>Reusable components</h1>
        <p>Each row is the real component the app imports, labelled by its file. Change a component or its stylesheet and every place that uses it changes with it.</p>
      </div>

      {/* Keep row numbers fixed so existing references survive reordering. */}
      <h2 className="rb-group">controls</h2>
      <Row rowNumber={1} file="ControlButton.tsx">
        <div className="rb-wrap">
          {(['primary', 'secondary', 'neutral', 'surface', 'danger', 'danger-outline', 'ghost'] as const).map((v) => <ControlButton key={v} variant={v}>{v}</ControlButton>)}
          <ControlButton variant="primary" disabled>disabled</ControlButton>
        </div>
      </Row>
      <Row rowNumber={2} file="CheckboxControl.tsx"><div className="rb-wrap"><CheckboxControl checked={checked} onChange={setChecked} aria-label="Checked" /><CheckboxControl checked={false} onChange={noop} aria-label="Unchecked" /><CheckboxControl checked={false} indeterminate onChange={noop} aria-label="Mixed" /><CheckboxControl checked disabled onChange={noop} aria-label="Disabled" /></div></Row>
      <Row rowNumber={3} file="TextControl.tsx"><div className="rb-field"><TextControl icon={<Search width={18} height={18} />} placeholder="Text control" aria-label="Text control" /></div></Row>
      <Row rowNumber={4} file="SearchControl.tsx"><div className="rb-field"><SearchControl placeholder="Search…" aria-label="Search" /></div></Row>
      <Row rowNumber={5} file="SelectControl.tsx"><div className="rb-field"><SelectControl aria-label="Select" defaultValue="house"><option value="house">House</option><option value="techno">Techno</option></SelectControl></div></Row>
      <Row rowNumber={6} file="TextareaControl.tsx"><div className="rb-field"><TextareaControl icon={<Folder width={18} height={18} />} placeholder="Notes" aria-label="Notes" /></div></Row>
      <Row rowNumber={7} file="FormField.tsx"><div className="rb-field"><FormField label="Playlist name" required helperText="Shown in your library.">{({ id, describedBy, invalid }) => <TextControl id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="Warm Up" />}</FormField></div></Row>
      <Row rowNumber={8} file="IconControlButton.tsx"><div className="rb-wrap"><IconControlButton label="Download"><Download width={18} height={18} /></IconControlButton><IconControlButton label="Add"><Plus width={18} height={18} /></IconControlButton></div></Row>
      <Row rowNumber={9} file="ToolbarIconButton.tsx"><ToolbarIconGroup><ToolbarIconButton label="Add"><Plus width={20} height={20} /></ToolbarIconButton><ToolbarIconButton label="Delete"><Trash width={20} height={20} /></ToolbarIconButton></ToolbarIconGroup></Row>
      <Row rowNumber={10} file="Knob.tsx"><Knob label="Low" value={knob} onChange={setKnob} /></Row>
      <Row rowNumber={11} file="DualRangeSlider.tsx"><div className="rb-field"><DualRangeSlider bounds={[60, 180]} value={range} onChange={setRange} /></div></Row>
      <Row rowNumber={12} file="FilterDropdown.tsx"><div className="rb-open"><FilterDropdown label="Genre" value={filter} onChange={setFilter} searchable defaultOpen keepOpen options={[{ value: 'all', label: 'All' }, { value: 'house', label: 'House' }, { value: 'techno', label: 'Techno' }]} /></div></Row>
      <Row rowNumber={13} file="ContextMenu.tsx" overlay><ContextMenu x={16} y={16} ariaLabel="Cue actions" onClose={noop} items={[{ id: 'a', label: 'Add hot cue', hint: 'A', onSelect: noop }, { id: 'b', label: 'Delete cue', disabled: true, onSelect: noop }]} /></Row>

      <h2 className="rb-group">feedback</h2>
      <Row rowNumber={14} file="NoticeCard.tsx"><div className="rb-stack">{(['error', 'warning', 'info', 'success', 'neutral'] as const).map((t) => <NoticeCard key={t} tone={t} title={`${t[0].toUpperCase()}${t.slice(1)}`}>A short message for the user.</NoticeCard>)}</div></Row>
      <Row rowNumber={15} file="StatusBadge.tsx"><div className="rb-wrap">{(['neutral', 'success', 'warning', 'error', 'active', 'online'] as const).map((t) => <StatusBadge key={t} tone={t}>{t}</StatusBadge>)}</div></Row>
      <Row rowNumber={16} file="AnalysisStatusBadge.tsx"><div className="rb-wrap">{BADGES.map((s) => <AnalysisStatusBadge key={s} state={s} />)}</div></Row>
      <Row rowNumber={17} file="StatusDot.tsx"><div className="rb-wrap">{(['success', 'warning', 'error', 'active'] as const).map((t) => <StatusDot key={t} tone={t} label={t} />)}</div></Row>
      <Row rowNumber={18} file="StatusLoader.tsx"><div className="rb-wrap">{LOADERS.map((v) => <StatusLoader key={v} variant={v} />)}</div></Row>
      <Row rowNumber={19} file="ProgressBar.tsx"><div className="rb-field"><ProgressBar value={62} showValue label="Progress" /></div></Row>
      <Row rowNumber={20} file="CircularProgress.tsx"><CircularProgress value={64} label="Progress" /></Row>
      <Row rowNumber={21} file="QuietProgress.tsx"><div className="rb-field rb-wide"><QuietProgress title="Sample job" phases={PHASES} activeIndex={2} stagePercent={40} percent={quietOverallPercent(2, PHASES.length, 40)} headline="Analysing your tracks." figures={[{ label: 'Ready', value: '32' }, { label: 'Remaining', value: '327' }]} /></div></Row>
      <Row rowNumber={22} file="ImportActivityBanner.tsx"><div className="rb-field rb-wide"><ImportActivityBanner title="Analysis running" source="REVERIE" detail="32 / 359 tracks ready" progress={9} onView={noop} viewLabel="VIEW STATUS" /></div></Row>
      <Row rowNumber={23} file="EmptyState.tsx"><div className="rb-field"><EmptyState title="No USBs yet" message="Import a library from a USB and it appears here." actionLabel="Import" onAction={noop} /></div></Row>
      <Row rowNumber={24} file="SelectableOptionCard.tsx"><div className="rb-wrap"><SelectableOptionCard selected={option === 'dark'} title="Dark" description="The default look" onSelect={() => setOption('dark')} /><SelectableOptionCard selected={option === 'light'} title="Light" description="Higher contrast" onSelect={() => setOption('light')} /></div></Row>
      <Row rowNumber={25} file="SkeletonBlock.tsx"><div className="rb-field"><SkeletonBlock className="h-4 w-48" /></div></Row>
      <Row rowNumber={26} file="SkeletonRow.tsx"><div className="rb-field rb-wide"><SkeletonRow /></div></Row>
      <Row rowNumber={27} file="Dialog.tsx"><div className="rb-field"><Dialog inline title="Discard changes?" onClose={noop} actions={[{ label: 'Keep editing', onClick: noop, variant: 'secondary' }, { label: 'Discard', onClick: noop, variant: 'primary' }]}>Your unsaved changes will be lost.</Dialog></div></Row>
      <Row rowNumber={28} file="NotificationCenter.tsx (NotificationCard)"><div className="rb-stack"><NotificationCard notification={{ id: 'a', tone: 'error', title: 'Could not save', message: 'The server did not answer. Try again.' }} onDismiss={noop} /><NotificationCard notification={{ id: 'b', tone: 'warning', title: 'USB disconnected', message: 'Reconnect your drive.' }} onDismiss={noop} /></div></Row>

      <h2 className="rb-group">display</h2>
      <Row rowNumber={29} file="SurfaceCard.tsx"><div className="rb-wrap"><SurfaceCard variant="surface"><div className="rb-pad">surface</div></SurfaceCard><SurfaceCard variant="glass"><div className="rb-pad">glass</div></SurfaceCard></div></Row>
      <Row rowNumber={30} file="StatTile.tsx"><div className="rb-wrap"><StatTile label="Tracks" value="359" /><StatTile label="Playlists" value="3" caption="Warm Up, Peak" /></div></Row>
      <Row rowNumber={31} file="TabNavigation.tsx"><TabNavigation ariaLabel="Sections" value={tab} onChange={setTab} options={[{ id: 'overview', label: 'Overview' }, { id: 'tracks', label: 'Tracks' }, { id: 'cues', label: 'Cues' }]} /></Row>
      <Row rowNumber={32} file="Avatar.tsx"><div className="rb-wrap"><Avatar initials="DD" size="sm" /><Avatar initials="DD" size="md" ring="blue" /><Avatar initials="DD" size="lg" ring="spectrum" /></div></Row>
      <Row rowNumber={33} file="Artwork.tsx"><div className="rb-wrap" style={{ width: 120 }}><Artwork alt="Sample artwork" fallbackTitle="No artwork" /></div></Row>
      <Row rowNumber={34} file="Divider.tsx"><div className="rb-field">{(['solid', 'dotted', 'dashed', 'accent'] as const).map((v) => <Divider key={v} variant={v} />)}</div></Row>
      <Row rowNumber={35} file="TrackIdentity.tsx"><TrackIdentity title="Pop Lock And Drop It" subtitle="Sidequest" stats={[{ label: 'BPM', value: '128' }, { label: 'Key', value: '8A' }]} /></Row>
      <Row rowNumber={36} file="TrackTable.tsx"><div className="rb-field rb-wide"><TrackTable><TrackTableHead><TrackTableHeadCell label="Track" column="title" sort={null} onSort={noop} /></TrackTableHead><TrackTableBody><tr><td><TrackNameCell title="Pop Lock And Drop It" artist="Sidequest" status="ready" /></td></tr></TrackTableBody></TrackTable></div></Row>

      <h2 className="rb-group">media</h2>
      <Row rowNumber={37} file="TransportButton.tsx"><div className="rb-wrap"><TransportButton label="Play" tone="play">▶</TransportButton><TransportButton label="Stop" tone="stop">■</TransportButton><TransportButton label="Mute" tone="mute">M</TransportButton><TransportButton label="Neutral">•</TransportButton></div></Row>
      <Row rowNumber={38} file="MediaTransportControlGroup.tsx"><MediaTransportControlGroup playing={playing} onTogglePlay={() => setPlaying((p) => !p)} onPrevious={noop} onRewind={noop} onForward={noop} onNext={noop} /></Row>
      <Row rowNumber={39} file="PlaybackSeekBar.tsx"><div className="rb-field rb-wide"><PlaybackSeekBar currentSeconds={seek} durationSeconds={300} seekable onSeek={setSeek} ariaLabel="Seek" /></div></Row>
      <Row rowNumber={40} file="AudioDock.tsx"><AudioDock><span className="rb-pad">AudioDock holds the player controls</span></AudioDock></Row>
      <Row rowNumber={41} file="WaveformCueMarker.tsx"><div className="rb-marker"><WaveformCueMarker label="A" color="#d86c7d" style={{ left: '15%' }} /><WaveformCueMarker label="B" color="#5aa9d1" selected style={{ left: '50%' }} /><WaveformCueMarker label="M" color="#d2a35b" memory style={{ left: '85%' }} /></div></Row>
      <Row rowNumber={42} file="WaveformSectionRow.tsx"><div className="rb-field rb-wide"><WaveformSectionRow sections={SECTIONS} leadIn={false} /></div></Row>
      <Row rowNumber={43} file="WaveformTimeRuler.tsx"><div className="rb-field rb-wide"><WaveformTimeRuler endMs={300000} ticks={[{ ms: 0, label: '0:00' }, { ms: 100000, label: '1:40' }, { ms: 200000, label: '3:20' }, { ms: 300000, label: '5:00' }]} /></div></Row>
      <Row rowNumber={44} file="TimelineLanes.tsx"><div className="rb-field rb-wide"><TimelineSectionLane sections={SECTIONS} leadIn={false} /><TimelineBeatLane ticks={[{ key: '1', leftPercent: 5, downbeat: true }, { key: '2', leftPercent: 10, downbeat: false }, { key: '3', leftPercent: 15, downbeat: false }, { key: '4', leftPercent: 20, downbeat: true }]} labels={[{ key: '1', leftPercent: 5, text: '1' }, { key: '2', leftPercent: 20, text: '5' }]} /></div></Row>
      <Row rowNumber={45} file="WaveformZoomControls.tsx"><div className="group/waveform relative rb-field" style={{ height: 80 }}><WaveformZoomControls onZoomIn={noop} onZoomOut={noop} canZoomIn canZoomOut /><span className="rb-pad">Hover this row to show the zoom controls</span></div></Row>
      <Row rowNumber={46} file="RecordTrackListing.tsx"><div className="rb-listing"><RecordTrackListing tracks={SAMPLE_TRACKS} importId={null} playback={false} playlistCounts={SAMPLE_COUNTS} getCueMarkers={() => []} getWaveformState={(id) => ({ status: 'unavailable', trackId: id })} ariaLabel="Sample tracks" /></div></Row>
      <Row rowNumber={47} file="PageSkeleton.tsx"><div className="rb-stack" style={{ width: '100%' }}>{(['home', 'listing', 'cards', 'workspace'] as const).map((v) => <div key={v} className="rb-skeleton"><p className="rb-used-label">{v}</p><PageSkeleton variant={v} label={`${v} page`} /></div>)}</div></Row>
      <Row rowNumber={48} file="PageSkeleton.tsx (ListingSkeleton)"><div className="rb-field rb-wide"><ListingSkeleton count={4} label="Loading tracks" /></div></Row>
      <Row rowNumber={49} file="ToolbarRow.tsx"><div className="rb-field rb-wide"><ToolbarRow aria-label="Sample toolbar"><ToolbarIconButton label="Keep"><Plus width={20} height={20} /></ToolbarIconButton><ToolbarIconButton label="Maybe"><Search width={20} height={20} /></ToolbarIconButton><ToolbarIconButton label="Remove"><Trash width={20} height={20} /></ToolbarIconButton></ToolbarRow></div></Row>
      <Row rowNumber={50} file="PageSkeleton.tsx (TrackPanelSkeleton)"><div className="rb-field rb-wide"><TrackPanelSkeleton label="Loading track" /></div></Row>
      <p className="rb-note"><Bell width={12} height={12} aria-hidden="true" /> Not shown: TrackListing, TrackTimeline and the waveform components, which need live library data and the audio player. The RecordTrackListing row uses two sample tracks.</p>
    </div>
  );
}
