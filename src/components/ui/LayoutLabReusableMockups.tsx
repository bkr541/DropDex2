import { useState, type ReactNode } from 'react';
import { Bell, Download, Folder, Plus, Search, Trash } from 'iconoir-react/regular';
import { CheckboxControl, ContextMenu, ControlButton, DualRangeSlider, FilterDropdown, FormField, IconControlButton, Knob, SearchControl, SelectControl, TextareaControl, TextControl, ToolbarIconButton, ToolbarIconGroup } from './controls';
import {
  AnalysisStatusBadge, CircularProgress, Dialog, EmptyState, ImportActivityBanner, NoticeCard, NotificationCard, ProgressBar, QuietProgress, SelectableOptionCard,
  SkeletonBlock, SkeletonRow, StatusBadge, StatusDot, StatusLoader, quietOverallPercent,
} from './feedback';
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

function Row({ file, children, overlay = false }: { file: string; children: ReactNode; overlay?: boolean }) {
  return (
    <section className="rb-row" data-testid="reusable-row">
      <p className="rb-file">{file}</p>
      <div className={`rb-stage${overlay ? ' pop-stage' : ''}`}>{children}</div>
    </section>
  );
}

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

      <h2 className="rb-group">controls</h2>
      <Row file="ControlButton.tsx">
        <div className="rb-wrap">
          {(['primary', 'secondary', 'neutral', 'surface', 'danger', 'danger-outline', 'ghost'] as const).map((v) => <ControlButton key={v} variant={v}>{v}</ControlButton>)}
          <ControlButton variant="primary" disabled>disabled</ControlButton>
        </div>
      </Row>
      <Row file="CheckboxControl.tsx"><div className="rb-wrap"><CheckboxControl checked={checked} onChange={setChecked} aria-label="Checked" /><CheckboxControl checked={false} onChange={noop} aria-label="Unchecked" /><CheckboxControl checked={false} indeterminate onChange={noop} aria-label="Mixed" /><CheckboxControl checked disabled onChange={noop} aria-label="Disabled" /></div></Row>
      <Row file="TextControl.tsx"><div className="rb-field"><TextControl icon={<Search width={18} height={18} />} placeholder="Text control" aria-label="Text control" /></div></Row>
      <Row file="SearchControl.tsx"><div className="rb-field"><SearchControl placeholder="Search…" aria-label="Search" /></div></Row>
      <Row file="SelectControl.tsx"><div className="rb-field"><SelectControl aria-label="Select" defaultValue="house"><option value="house">House</option><option value="techno">Techno</option></SelectControl></div></Row>
      <Row file="TextareaControl.tsx"><div className="rb-field"><TextareaControl icon={<Folder width={18} height={18} />} placeholder="Notes" aria-label="Notes" /></div></Row>
      <Row file="FormField.tsx"><div className="rb-field"><FormField label="Playlist name" required helperText="Shown in your library.">{({ id, describedBy, invalid }) => <TextControl id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="Warm Up" />}</FormField></div></Row>
      <Row file="IconControlButton.tsx"><div className="rb-wrap"><IconControlButton label="Download"><Download width={18} height={18} /></IconControlButton><IconControlButton label="Add"><Plus width={18} height={18} /></IconControlButton></div></Row>
      <Row file="ToolbarIconButton.tsx"><ToolbarIconGroup><ToolbarIconButton label="Add"><Plus width={20} height={20} /></ToolbarIconButton><ToolbarIconButton label="Delete"><Trash width={20} height={20} /></ToolbarIconButton></ToolbarIconGroup></Row>
      <Row file="Knob.tsx"><Knob label="Low" value={knob} onChange={setKnob} /></Row>
      <Row file="DualRangeSlider.tsx"><div className="rb-field"><DualRangeSlider bounds={[60, 180]} value={range} onChange={setRange} /></div></Row>
      <Row file="FilterDropdown.tsx"><div className="rb-open"><FilterDropdown label="Genre" value={filter} onChange={setFilter} searchable defaultOpen keepOpen options={[{ value: 'all', label: 'All' }, { value: 'house', label: 'House' }, { value: 'techno', label: 'Techno' }]} /></div></Row>
      <Row file="ContextMenu.tsx" overlay><ContextMenu x={16} y={16} ariaLabel="Cue actions" onClose={noop} items={[{ id: 'a', label: 'Add hot cue', hint: 'A', onSelect: noop }, { id: 'b', label: 'Delete cue', disabled: true, onSelect: noop }]} /></Row>

      <h2 className="rb-group">feedback</h2>
      <Row file="NoticeCard.tsx"><div className="rb-stack">{(['error', 'warning', 'info', 'success', 'neutral'] as const).map((t) => <NoticeCard key={t} tone={t} title={`${t[0].toUpperCase()}${t.slice(1)}`}>A short message for the user.</NoticeCard>)}</div></Row>
      <Row file="StatusBadge.tsx"><div className="rb-wrap">{(['neutral', 'success', 'warning', 'error', 'active', 'online'] as const).map((t) => <StatusBadge key={t} tone={t}>{t}</StatusBadge>)}</div></Row>
      <Row file="AnalysisStatusBadge.tsx"><div className="rb-wrap">{BADGES.map((s) => <AnalysisStatusBadge key={s} state={s} />)}</div></Row>
      <Row file="StatusDot.tsx"><div className="rb-wrap">{(['success', 'warning', 'error', 'active'] as const).map((t) => <StatusDot key={t} tone={t} label={t} />)}</div></Row>
      <Row file="StatusLoader.tsx"><div className="rb-wrap">{LOADERS.map((v) => <StatusLoader key={v} variant={v} />)}</div></Row>
      <Row file="ProgressBar.tsx"><div className="rb-field"><ProgressBar value={62} showValue label="Progress" /></div></Row>
      <Row file="CircularProgress.tsx"><CircularProgress value={64} label="Progress" /></Row>
      <Row file="QuietProgress.tsx"><div className="rb-field rb-wide"><QuietProgress title="Sample job" phases={PHASES} activeIndex={2} stagePercent={40} percent={quietOverallPercent(2, PHASES.length, 40)} headline="Analysing your tracks." figures={[{ label: 'Ready', value: '32' }, { label: 'Remaining', value: '327' }]} /></div></Row>
      <Row file="ImportActivityBanner.tsx"><div className="rb-field rb-wide"><ImportActivityBanner title="Analysis running" source="REVERIE" detail="32 / 359 tracks ready" progress={9} onView={noop} viewLabel="VIEW STATUS" /></div></Row>
      <Row file="EmptyState.tsx"><div className="rb-field"><EmptyState title="No USBs yet" message="Import a library from a USB and it appears here." actionLabel="Import" onAction={noop} /></div></Row>
      <Row file="SelectableOptionCard.tsx"><div className="rb-wrap"><SelectableOptionCard selected={option === 'dark'} title="Dark" description="The default look" onSelect={() => setOption('dark')} /><SelectableOptionCard selected={option === 'light'} title="Light" description="Higher contrast" onSelect={() => setOption('light')} /></div></Row>
      <Row file="SkeletonBlock.tsx"><div className="rb-field"><SkeletonBlock className="h-4 w-48" /></div></Row>
      <Row file="SkeletonRow.tsx"><div className="rb-field rb-wide"><SkeletonRow /></div></Row>
      <Row file="Dialog.tsx"><div className="rb-field"><Dialog inline title="Discard changes?" onClose={noop} actions={[{ label: 'Keep editing', onClick: noop, variant: 'secondary' }, { label: 'Discard', onClick: noop, variant: 'primary' }]}>Your unsaved changes will be lost.</Dialog></div></Row>
      <Row file="NotificationCenter.tsx (NotificationCard)"><div className="rb-stack"><NotificationCard notification={{ id: 'a', tone: 'error', title: 'Could not save', message: 'The server did not answer. Try again.' }} onDismiss={noop} /><NotificationCard notification={{ id: 'b', tone: 'warning', title: 'USB disconnected', message: 'Reconnect your drive.' }} onDismiss={noop} /></div></Row>

      <h2 className="rb-group">display</h2>
      <Row file="SurfaceCard.tsx"><div className="rb-wrap"><SurfaceCard variant="surface"><div className="rb-pad">surface</div></SurfaceCard><SurfaceCard variant="glass"><div className="rb-pad">glass</div></SurfaceCard></div></Row>
      <Row file="StatTile.tsx"><div className="rb-wrap"><StatTile label="Tracks" value="359" /><StatTile label="Playlists" value="3" caption="Warm Up, Peak" /></div></Row>
      <Row file="TabNavigation.tsx"><TabNavigation ariaLabel="Sections" value={tab} onChange={setTab} options={[{ id: 'overview', label: 'Overview' }, { id: 'tracks', label: 'Tracks' }, { id: 'cues', label: 'Cues' }]} /></Row>
      <Row file="Avatar.tsx"><div className="rb-wrap"><Avatar initials="DD" size="sm" /><Avatar initials="DD" size="md" ring="blue" /><Avatar initials="DD" size="lg" ring="spectrum" /></div></Row>
      <Row file="Artwork.tsx"><div className="rb-wrap" style={{ width: 120 }}><Artwork alt="Sample artwork" fallbackTitle="No artwork" /></div></Row>
      <Row file="Divider.tsx"><div className="rb-field">{(['solid', 'dotted', 'dashed', 'accent'] as const).map((v) => <Divider key={v} variant={v} />)}</div></Row>
      <Row file="TrackIdentity.tsx"><TrackIdentity title="Pop Lock And Drop It" subtitle="Sidequest" stats={[{ label: 'BPM', value: '128' }, { label: 'Key', value: '8A' }]} /></Row>
      <Row file="TrackTable.tsx"><div className="rb-field rb-wide"><TrackTable><TrackTableHead><TrackTableHeadCell label="Track" column="title" sort={null} onSort={noop} /></TrackTableHead><TrackTableBody><tr><td><TrackNameCell title="Pop Lock And Drop It" artist="Sidequest" status="ready" /></td></tr></TrackTableBody></TrackTable></div></Row>

      <h2 className="rb-group">media</h2>
      <Row file="TransportButton.tsx"><div className="rb-wrap"><TransportButton label="Play" tone="play">▶</TransportButton><TransportButton label="Stop" tone="stop">■</TransportButton><TransportButton label="Mute" tone="mute">M</TransportButton><TransportButton label="Neutral">•</TransportButton></div></Row>
      <Row file="MediaTransportControlGroup.tsx"><MediaTransportControlGroup playing={playing} onTogglePlay={() => setPlaying((p) => !p)} onPrevious={noop} onRewind={noop} onForward={noop} onNext={noop} /></Row>
      <Row file="PlaybackSeekBar.tsx"><div className="rb-field rb-wide"><PlaybackSeekBar currentSeconds={seek} durationSeconds={300} seekable onSeek={setSeek} ariaLabel="Seek" /></div></Row>
      <Row file="AudioDock.tsx"><AudioDock><span className="rb-pad">AudioDock holds the player controls</span></AudioDock></Row>
      <Row file="WaveformCueMarker.tsx"><div className="rb-wrap rb-marker"><WaveformCueMarker label="A" color="#d86c7d" /><WaveformCueMarker label="B" color="#5aa9d1" selected /><WaveformCueMarker label="M" color="#d2a35b" memory /></div></Row>
      <Row file="WaveformSectionRow.tsx"><div className="rb-field rb-wide"><WaveformSectionRow sections={SECTIONS} leadIn={false} /></div></Row>
      <Row file="WaveformTimeRuler.tsx"><div className="rb-field rb-wide"><WaveformTimeRuler endMs={300000} ticks={[{ ms: 0, label: '0:00' }, { ms: 100000, label: '1:40' }, { ms: 200000, label: '3:20' }, { ms: 300000, label: '5:00' }]} /></div></Row>
      <Row file="TimelineLanes.tsx"><div className="rb-field rb-wide"><TimelineSectionLane sections={SECTIONS} leadIn={false} /><TimelineBeatLane ticks={[{ key: '1', leftPercent: 5, downbeat: true }, { key: '2', leftPercent: 10, downbeat: false }, { key: '3', leftPercent: 15, downbeat: false }, { key: '4', leftPercent: 20, downbeat: true }]} labels={[{ key: '1', leftPercent: 5, text: '1' }, { key: '2', leftPercent: 20, text: '5' }]} /></div></Row>
      <Row file="WaveformZoomControls.tsx"><div className="group/waveform relative rb-field" style={{ height: 80 }}><WaveformZoomControls onZoomIn={noop} onZoomOut={noop} canZoomIn canZoomOut /><span className="rb-pad">Hover this row to show the zoom controls</span></div></Row>
      <p className="rb-note"><Bell width={12} height={12} aria-hidden="true" /> Not shown: RecordTrackListing, TrackListing, TrackTimeline and the waveform components, which need live library data and the audio player.</p>
    </div>
  );
}
