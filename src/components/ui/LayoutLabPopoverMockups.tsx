import { useState, type ReactNode } from 'react';
import { Search } from 'iconoir-react/regular';
import { AutocompleteControl, ContextMenu, FilterDropdown } from './controls';
import { Dialog, FloatingActivityPanel, NotificationCard, ToastNotification } from './feedback';
import { ImportProgressModal, type ImportUiStep } from '../ImportProgressModal';
import {
  ImportAbortDialog, ImportAnalysisScreen, ImportCancelledScreen, ImportCompleteScreen, ImportFailedScreen, ImportInterruptedScreen,
  ImportIssuesScreen, ImportPartialSummary, ImportPausedScreen, ImportSourceScreen, ImportStoppingScreen, ImportUploadScreen,
  ImportUsbReleasedScreen, type ImportIssueTrack,
} from '../ImportScreens';
import { ResumeAnalysisView } from '../ResumeAnalysisModal';
import { BackgroundImportPanelView } from '../BackgroundImportPanel';
import { DeleteAllLibrariesModal } from '../DeleteAllLibrariesModal';
import { DeleteLibraryModal } from '../DeleteLibraryModal';
import { DiscoveryScrapeProgressModal } from '../discovery/DiscoveryScrapeProgressModal';
import { DropLabSourcePicker } from '../drop-lab/DropLabSourcePicker';
import { CueApplyMenu } from '../cues/CueApplyMenu';
import { GenreEditSurface, GenreEditorContent } from '../cues/GenreEditPopover';
import { IconOptionMenu, VolumePopover } from '../cues/CueEditorToolbar';
import { Magnet } from 'iconoir-react/regular';
import type { AnalysisStatusResponse, CompleteResponse, ImportResult } from '../../lib/api/rekordboxImport';
import type { DiscoveryScrapeJob, RekordboxImport } from '../../types';
import '../profile/profile.css';
import '../cues/cue-studio.css';
import './layout-lab-popovers.css';

// Layout Lab / Popover: every popover in the app, drawn by the same component the app uses, on sample data. Change a component or
// its stylesheet and it changes here and everywhere it is used. "Shared" popovers are reusable components; "One-off" ones belong to a
// single screen.

const noop = () => {};

function Specimen({ n, name, kind, source, children }: { n: number; name: string; kind: 'Shared' | 'One-off'; source: string; children: ReactNode }) {
  return (
    <section className="pop-specimen">
      <p className="pop-caption"><b>{String(n).padStart(2, '0')}</b> {name}<span className={`pop-kind pop-kind--${kind === 'Shared' ? 'shared' : 'oneoff'}`}>{kind}</span><small>{source}</small></p>
      <div className="pop-stage">{children}</div>
    </section>
  );
}

const SAMPLE_IMPORT = { id: 'imp-1', source_filename: 'exportLibrary.db', device_name: 'REVERIE', delete_active_strategy: null, status: 'completed' } as unknown as RekordboxImport;
const SAMPLE_JOB = { id: 'job-1', artist_name: 'Sidequest', status: 'running', pages_scraped: 3, results_found: 42, total_results_reported: 120, started_at: '2026-11-10T10:00:00Z', error_message: null } as unknown as DiscoveryScrapeJob;
const SAMPLE_JOB_DONE = { ...SAMPLE_JOB, status: 'completed', pages_scraped: 6, results_found: 120 } as unknown as DiscoveryScrapeJob;
const COMPLETE: CompleteResponse = {
  import_id: 'imp-1', analysis_status: 'partial', total_tracks: 359, completed_count: 358, partial_count: 1, failed_count: 0, missing_required_count: 0,
  missing_optional_ext_count: 0, missing_optional_2ex_count: 0, parser_version: 'v12', tracks: [],
};
const LIBRARY_ONLY: ImportResult = { import_id: 'imp-1', status: 'completed', source_filename: 'exportLibrary.db', track_count: 359, playlist_count: 3, playlist_track_count: 410, playlists: [{ name: 'Warm Up', track_count: 42 }, { name: 'Peak Time', track_count: 88 }] };
const ISSUES: ImportIssueTrack[] = [{ id: 't1', title: 'Pop Lock And Drop It', artist: 'Sidequest', analysis_parse_status: 'partial', analysis_failure_reason: null, analysis_parse_warnings: [{ code: 'missing_ext' }] }];
const READINESS = { stage: 'Analysis Processing', tracksReady: 32, tracksRemaining: 327, estimatedSecondsRemaining: 240, rawArchivalStatus: 'Queued', optionalArchivalStatus: 'skipped' };
const PARSE = { percent: 9, currentTrackLabel: 'POP LOCK AND DROP IT - SIDEQUEST', totalTracks: 359, parsedTracks: 32 };
const FOLDER = { dbFile: { name: 'exportLibrary.db', size: 4_400_000 }, anlzFiles: { length: 2100 }, folderName: 'My USB', targetedResolver: null };
const PANEL_STATUS = {
  import_id: 'imp-1', analysis_status: 'running', readiness_stage: 'analysis_running', progress_percent: 9, tracks_ready_count: 32, tracks_remaining_count: 327,
  estimated_seconds_remaining: 240, raw_archival_status: 'queued', optional_archival_status: 'skipped', failed_track_count: 0, parsed_track_count: 32,
} as unknown as AnalysisStatusResponse;
const RESUME_BASE = {
  hasStatus: true, targets: Array.from({ length: 55 }, () => ({ required: true })), matchSummary: null, wrongDrive: false, retryingCount: 0, errorMessage: '', onClose: noop, onDone: noop, onSelectFolder: noop, onRetry: noop,
  statusSummary: { missingRequired: 12, missingOptional: 40, uploadFailed: 3, parseFailed: 0, affectedTracks: 15 },
  progress: { filesUploaded: 22, filesTotal: 55, bytesUploaded: 6_100_000, bytesTotal: 15_300_000 },
  completeResp: { ...COMPLETE, completed_count: 350, partial_count: 2, missing_required_count: 8 } as CompleteResponse | null,
};

/** An import screen inside the real import popover shell. */
function ImportShell({ step, pct, ready = true, status, children, abort }: { step: ImportUiStep; pct: number; ready?: boolean; status?: 'failed'; children: ReactNode; abort?: ReactNode }) {
  return <div className="pop-center"><ImportProgressModal currentStep={step} stagePercent={pct} ready={ready} status={status} onClose={noop} abortOverlay={abort}>{children}</ImportProgressModal></div>;
}

export function PopoverMockupsContent() {
  const [mode, setMode] = useState<'usb_folder' | 'zip_bundle' | 'database_only'>('usb_folder');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autocomplete, setAutocomplete] = useState('ho');
  const [filter, setFilter] = useState('house');
  const [snap, setSnap] = useState('1-beat');
  const [volume, setVolume] = useState(0.7);
  let n = 0;
  const next = () => ++n;
  const importScreens: Array<{ name: string; node: ReactNode }> = [
    { name: 'Import: choose source', node: <ImportShell step="source" pct={0} ready={false}><ImportSourceScreen mode={mode} onModeChange={setMode} isReady={false} scanning={false} folderScan={null} folderAllowsImport={false} selectedFile={null} unexpectedDbName={false} onSelectFolder={noop} onPickFile={noop} onImport={noop} onCancel={noop} /></ImportShell> },
    { name: 'Import: folder chosen', node: <ImportShell step="source" pct={0}><ImportSourceScreen mode="usb_folder" onModeChange={noop} isReady scanning={false} folderScan={FOLDER} folderAllowsImport selectedFile={null} unexpectedDbName={false} onSelectFolder={noop} onPickFile={noop} onImport={noop} onCancel={noop} /></ImportShell> },
    { name: 'Import: database upload', node: <ImportShell step="database" pct={25}><ImportUploadScreen stage="uploading_database" zipBundle={false} progress={{ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0 }} bundleSize={null} rejectedCount={0} retryingCount={0} uploadPct={0} onCancel={noop} /></ImportShell> },
    { name: 'Import: analysis files upload', node: <ImportShell step="analysis-files" pct={57}><ImportUploadScreen stage="uploading_analysis" zipBundle={false} progress={{ filesUploaded: 1204, filesTotal: 2100, bytesUploaded: 318_000_000, bytesTotal: 560_000_000 }} bundleSize={null} rejectedCount={0} retryingCount={3} uploadPct={57} onCancel={noop} onBackground={noop} /></ImportShell> },
    { name: 'Import: USB released', node: <ImportShell step="analysis-files" pct={70}><ImportUsbReleasedScreen /></ImportShell> },
    { name: 'Import: stopping', node: <ImportShell step="analysis-files" pct={60}><ImportStoppingScreen usbReleaseConfirmed={false} cloudStepActive={false} deleting={false} /></ImportShell> },
    { name: 'Import: analysis running', node: <ImportShell step="analyze" pct={9}><ImportAnalysisScreen readiness={READINESS} parse={PARSE} onPause={noop} onBackground={noop} /></ImportShell> },
    { name: 'Import: analysis paused', node: <ImportShell step="analyze" pct={9}><ImportPausedScreen onDone={noop} /></ImportShell> },
    { name: 'Import: analysis interrupted', node: <ImportShell step="analyze" pct={9}><ImportInterruptedScreen message={null} onDone={noop} /></ImportShell> },
    { name: 'Import: complete', node: <ImportShell step="complete" pct={100}><ImportCompleteScreen usbReleaseConfirmed withAnalysis={null} libraryOnly={LIBRARY_ONLY} reuseStats={null} onDone={noop} /></ImportShell> },
    { name: 'Import: complete with issues', node: <ImportShell step="complete" pct={100}><ImportPartialSummary usbReleaseConfirmed withAnalysis={COMPLETE} reconciliation={null} onOpenIssues={noop} onDone={noop} /></ImportShell> },
    { name: 'Import: track issues', node: <ImportShell step="complete" pct={100}><ImportIssuesScreen tracks={ISSUES} loading={false} expandedIds={expanded} onToggle={(id) => setExpanded((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; })} onBack={noop} onDone={noop} /></ImportShell> },
    { name: 'Import: failed', node: <ImportShell step="database" pct={25} ready={false} status="failed"><ImportFailedScreen saveFailed={false} message="The database could not be saved. Check your connection and try again." onRetry={noop} onCancel={noop} /></ImportShell> },
    { name: 'Import: deleted', node: <ImportShell step="analyze" pct={9}><ImportCancelledScreen errorMessage={null} onReset={noop} /></ImportShell> },
    { name: 'Import: confirm delete', node: <ImportShell step="analyze" pct={9} abort={<ImportAbortDialog intent="delete" localUsbAccessActive={false} onConfirm={noop} onKeepGoing={noop} />}><div /></ImportShell> },
  ];
  const resumeScreens: Array<{ name: string; phase: 'scan_prompt' | 'uploading' | 'parsing' | 'done_partial' | 'error' }> = [
    { name: 'Resume: choose USB', phase: 'scan_prompt' }, { name: 'Resume: uploading', phase: 'uploading' }, { name: 'Resume: reprocessing', phase: 'parsing' },
    { name: 'Resume: updated', phase: 'done_partial' }, { name: 'Resume: failed', phase: 'error' },
  ];

  return (
    <div className="pop-lab" data-testid="popover-mockups">
      <div className="pop-intro">
        <span>Layout Lab / Popover</span>
        <h1>Every popover in the app</h1>
        <p>Each popover here is the component the app uses, on sample data. Change the component or its stylesheet and it changes here and everywhere it is used.</p>
      </div>

      <h2 className="pop-group">Popovers and dialogs</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Dialog" kind="Shared" source="ui/feedback/Dialog.tsx">
          <Dialog inline title="Discard changes?" onClose={noop} actions={[{ label: 'Keep editing', onClick: noop, variant: 'secondary' }, { label: 'Discard', onClick: noop, variant: 'primary' }]}>Your unsaved changes to this playlist will be lost.</Dialog>
        </Specimen>
        <Specimen n={next()} name="Dialog: destructive" kind="Shared" source="ui/feedback/Dialog.tsx (destructive)">
          <Dialog inline destructive title="Delete this playlist?" onClose={noop} actions={[{ label: 'Cancel', onClick: noop, variant: 'secondary' }, { label: 'Delete', onClick: noop, variant: 'danger' }]}>This can't be undone.</Dialog>
        </Specimen>
        <Specimen n={next()} name="Dialog: right sheet" kind="Shared" source="ui/feedback/Dialog.tsx (placement right)">
          <Dialog inline placement="right" title="Pending changes" onClose={noop} actions={[{ label: 'Close', onClick: noop, variant: 'secondary' }]}>Review saved metadata changes before they are applied.</Dialog>
        </Specimen>
        <Specimen n={next()} name="Delete All (confirm)" kind="One-off" source="DeleteAllLibrariesModal.tsx"><DeleteAllLibrariesModal open visibleSnapshotCount={2} deleting={false} error={null} onClose={noop} onConfirm={noop} /></Specimen>
        <Specimen n={next()} name="Delete All (deleting)" kind="One-off" source="DeleteAllLibrariesModal.tsx"><DeleteAllLibrariesModal open visibleSnapshotCount={2} deleting initialCount={2} remainingCount={1} error={null} onClose={noop} onConfirm={noop} /></Specimen>
        <Specimen n={next()} name="Delete library" kind="One-off" source="DeleteLibraryModal.tsx"><DeleteLibraryModal target={SAMPLE_IMPORT} isActive nextUsableImport={null} deleting={false} error={null} onClose={noop} onConfirm={noop} /></Specimen>
        <Specimen n={next()} name="Find artist sets (running)" kind="One-off" source="discovery/DiscoveryScrapeProgressModal.tsx"><DiscoveryScrapeProgressModal isOpen onClose={noop} job={SAMPLE_JOB} /></Specimen>
        <Specimen n={next()} name="Find artist sets (done)" kind="One-off" source="discovery/DiscoveryScrapeProgressModal.tsx"><DiscoveryScrapeProgressModal isOpen onClose={noop} job={SAMPLE_JOB_DONE} /></Specimen>
        {importScreens.map((s) => (
          <Specimen key={s.name} n={next()} name={s.name} kind="One-off" source="ImportLibraryModal.tsx → ImportScreens.tsx">{s.node}</Specimen>
        ))}
        {resumeScreens.map((s) => (
          <Specimen key={s.name} n={next()} name={s.name} kind="One-off" source="ResumeAnalysisModal.tsx → ResumeAnalysisView">
            <div className="pop-center"><ResumeAnalysisView {...RESUME_BASE} phase={s.phase} /></div>
          </Specimen>
        ))}
      </div>

      <h2 className="pop-group">Notifications and floating panels</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Notification card" kind="Shared" source="ui/feedback/NotificationCenter.tsx">
          <div className="pop-stack">
            <NotificationCard notification={{ id: 'a', tone: 'error', title: 'Could not save', message: 'The server did not answer. Try again.' }} onDismiss={noop} />
            <NotificationCard notification={{ id: 'b', tone: 'warning', title: 'USB disconnected', message: 'Reconnect your drive to keep playing.' }} onDismiss={noop} />
          </div>
        </Specimen>
        <Specimen n={next()} name="Toast notification" kind="Shared" source="ui/feedback/ToastNotification.tsx">
          <div className="pop-stack">
            {(['success', 'info', 'warning', 'error'] as const).map((tone) => <ToastNotification key={tone} tone={tone} title={`${tone[0].toUpperCase()}${tone.slice(1)} toast`} message="A short message about what happened." meta="now" onDismiss={noop} />)}
          </div>
        </Specimen>
        <Specimen n={next()} name="Floating activity panel" kind="Shared" source="ui/feedback/FloatingActivityPanel.tsx">
          <FloatingActivityPanel title="Uploading" progress={42} remaining="About 3 min left" paused={false} onTogglePaused={noop} rows={[{ id: '1', label: 'Analysis files', current: 840, total: 2100 }, { id: '2', label: 'Database', current: 1, total: 1, complete: true }]} />
        </Specimen>
        <Specimen n={next()} name="Background import panel: USB still reading" kind="One-off" source="BackgroundImportPanel.tsx">
          <BackgroundImportPanelView status={PANEL_STATUS} usbReleased={false} error={null} action={null} deletionPending={false} onClose={noop} onManageLocalUpload={noop} onRequestDelete={noop} onPause={noop} onResume={noop} />
        </Specimen>
        <Specimen n={next()} name="Background import panel: USB released" kind="One-off" source="BackgroundImportPanel.tsx">
          <BackgroundImportPanelView status={PANEL_STATUS} usbReleased error={null} action={null} deletionPending={false} onClose={noop} onManageLocalUpload={noop} onRequestDelete={noop} onPause={noop} onResume={noop} />
        </Specimen>
      </div>

      <h2 className="pop-group">Menus</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Context menu" kind="Shared" source="ui/controls/ContextMenu.tsx">
          <ContextMenu x={24} y={24} ariaLabel="Cue actions" onClose={noop} items={[{ id: 'a', label: 'Add hot cue', hint: 'A', onSelect: noop }, { id: 'b', label: 'Add memory cue', hint: 'M', onSelect: noop }, { id: 'c', label: 'Delete cue', disabled: true, onSelect: noop }]} />
        </Specimen>
        <Specimen n={next()} name="Cue Points apply menu" kind="One-off" source="cues/CueApplyMenu.tsx">
          <div className="pop-menu-anchor" style={{ minHeight: 170, width: 240 }}><CueApplyMenu saving={false} saveDisabled={false} saveTitle="Save cue changes as a draft" applyTrackDisabled={false} applyTrackTitle="Apply only the selected track" applyAllDisabled={false} applyAllCount={3} applyAllTitle="Apply all 3 saved track changes" discardDisabled={false} onSave={noop} onApplyTrack={noop} onApplyAll={noop} onDiscard={noop} /></div>
        </Specimen>
      </div>

      <h2 className="pop-group">Dropdown and search</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Filter dropdown" kind="Shared" source="ui/controls/FilterDropdown.tsx">
          <div className="pop-menu-anchor" style={{ minHeight: 260, width: 240 }}>
            <FilterDropdown label="Genre" value={filter} onChange={setFilter} searchable defaultOpen keepOpen options={[{ value: 'all', label: 'All' }, { value: 'house', label: 'House' }, { value: 'techno', label: 'Techno' }, { value: 'dnb', label: 'Drum & Bass' }]} />
          </div>
        </Specimen>
        <Specimen n={next()} name="Autocomplete" kind="Shared" source="ui/controls/AutocompleteControl.tsx">
          <div style={{ width: 300, minHeight: 220 }}>
            <AutocompleteControl ariaLabel="Genre" value={autocomplete} onChange={setAutocomplete} options={[{ value: 'house', label: 'House' }, { value: 'hard', label: 'Hard house' }, { value: 'hip', label: 'Hip hop' }]} />
          </div>
        </Specimen>
      </div>

      <h2 className="pop-group">Record listing</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Edit genre popover" kind="One-off" source="cues/GenreEditPopover.tsx">
          <GenreEditSurface style={{ position: 'static' }}>
            <GenreEditorContent title="Pop Lock And Drop It" value="Progressive House" dirty saving={false} available error={null} onChange={noop} onSave={noop} onCancel={noop} onReload={noop} />
          </GenreEditSurface>
        </Specimen>
        <Specimen n={next()} name="Drop Lab source picker" kind="One-off" source="drop-lab/DropLabSourcePicker.tsx">
          <div className="pop-relative"><DropLabSourcePicker tracks={[]} loading={false} currentId={null} onPick={noop} onClose={noop} /></div>
        </Specimen>
      </div>

      <h2 className="pop-group">Toolbar popovers</h2>
      <div className="pop-grid">
        <Specimen n={next()} name="Cue toolbar option list" kind="One-off" source="cues/CueEditorToolbar.tsx (IconOptionMenu)">
          <div className="pop-menu-anchor" style={{ minHeight: 220, width: 200 }}>
            <IconOptionMenu icon={<Magnet width={18} height={18} aria-hidden="true" />} label="Snap" value={snap as '1-beat'} defaultOpen keepOpen onChange={(v) => setSnap(v)}
              options={[{ value: 'off', label: 'Off' }, { value: '1-beat', label: '1 Beat' }, { value: '2-beats', label: '2 Beats' }, { value: '4-beats', label: '4 Beats' }] as Array<{ value: '1-beat'; label: string }>} />
          </div>
        </Specimen>
        <Specimen n={next()} name="Cue toolbar volume" kind="One-off" source="cues/CueEditorToolbar.tsx (VolumePopover)">
          <div className="pop-menu-anchor" style={{ minHeight: 90, width: 260 }}>
            <VolumePopover volume={volume} muted={false} silent={false} onToggleMute={noop} onVolumeChange={setVolume} />
          </div>
        </Specimen>
      </div>
      <p className="pop-note"><Search width={12} height={12} aria-hidden="true" /> Not shown: the Cue Points apply-confirmation panel, which needs a live apply plan.</p>
    </div>
  );
}
