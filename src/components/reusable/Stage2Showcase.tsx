import { useState, type ReactNode } from 'react';
import {
  AlertBanner,
  AnalysisStatusBadge,
  Dialog,
  EmptyState,
  FileUploadButton,
  FloatingActivityPanel,
  ImportActivityBanner,
  ProgressBar,
  ProgressStatusPanel,
  SelectableOptionCard,
  SkeletonCard,
  SkeletonChip,
  SkeletonRow,
  StatusBadge,
  StatusDot,
  StatusLoader,
  ToastNotification,
  UploadDropzone,
  type SemanticTone,
  type ToastTone,
} from '../ui/DropDexFeedback';
import './stage2-showcase.css';
import { Checkmark, CircleOutline, Close, Dashboard, Radio, RecordingFilled, Repeat, Sprout, Star, Trophy, WarningAlt, Waveform } from '@carbon/icons-react';

function Stage2Card({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <article className={`dd-stage2-card ${className ?? ''}`} data-stage2-card={label}>
      <h3>{label}</h3>
      <div className="dd-stage2-card__content">{children}</div>
    </article>
  );
}

const badgeRows: Array<Array<{ label: string; tone: SemanticTone; icon: ReactNode }>> = [
  [
    { label: 'Active', tone: 'success', icon: <CircleOutline size={8} fill="currentColor" /> },
    { label: 'Online', tone: 'online', icon: <CircleOutline size={8} /> },
    { label: 'Synced', tone: 'active', icon: <Radio size={10} /> },
  ],
  [
    { label: 'Analyzed', tone: 'purple', icon: <Waveform size={11} /> },
    { label: 'Hot Cue', tone: 'pink', icon: <RecordingFilled size={10} /> },
    { label: 'Loop', tone: 'purple', icon: <Repeat size={10} /> },
  ],
  [
    { label: 'Master', tone: 'warning', icon: <Trophy size={11} /> },
    { label: 'Quantized', tone: 'active', icon: <Dashboard size={11} /> },
    { label: 'Rekordbox', tone: 'purple', icon: <RecordingFilled size={10} /> },
  ],
  [
    { label: 'Pending', tone: 'warning', icon: <CircleOutline size={8} /> },
    { label: 'Complete', tone: 'success', icon: <Checkmark size={11} /> },
    { label: 'Disabled', tone: 'disabled', icon: <Close size={10} /> },
  ],
  [
    { label: 'Warning', tone: 'warning', icon: <WarningAlt size={11} /> },
    { label: 'Error', tone: 'error', icon: <Close size={11} /> },
    { label: 'Offline', tone: 'disabled', icon: <CircleOutline size={8} /> },
  ],
];

const toastSeed: Array<{ id: number; tone: ToastTone; title: string; message: string; meta: string }> = [
  { id: 1, tone: 'success', title: 'Track imported successfully', message: 'Halcyon (Original Mix)', meta: '2s' },
  { id: 2, tone: 'info', title: 'Analysis complete', message: '128 tracks analyzed', meta: '3s' },
  { id: 3, tone: 'warning', title: 'Missing artwork', message: '12 tracks are missing artwork', meta: '4s' },
  { id: 4, tone: 'error', title: 'Import failed', message: '3 files could not be read', meta: '5s' },
];

export function Stage2Showcase() {
  const [toasts, setToasts] = useState(toastSeed);
  const [bannerVisible, setBannerVisible] = useState(true);
  const [warningVisible, setWarningVisible] = useState(true);
  const [activityPaused, setActivityPaused] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [showDialog, setShowDialog] = useState(true);
  const [showDestructive, setShowDestructive] = useState(true);
  const [selected, setSelected] = useState('quality');
  const [uploadFiles, setUploadFiles] = useState<string[]>([]);
  const [dropzoneFiles, setDropzoneFiles] = useState<string[]>([]);
  const [activityMessage, setActivityMessage] = useState('');

  return (
    <div className="dd-stage2-board" data-testid="stage2-component-board">
      <div className="dd-stage2-grid dd-stage2-grid--top">
        <Stage2Card label="Status Badge" className="dd-stage2-status-badges">
          <div className="dd-stage2-badge-matrix">
            {badgeRows.flat().map((badge) => <StatusBadge key={badge.label} tone={badge.tone} icon={badge.icon}>{badge.label}</StatusBadge>)}
          </div>
        </Stage2Card>

        <Stage2Card label="Analysis Status Badge">
          <div className="dd-stage2-analysis-list">
            <AnalysisStatusBadge state="not-analyzed" />
            <AnalysisStatusBadge state="analyzing" />
            <AnalysisStatusBadge state="bpm" />
            <AnalysisStatusBadge state="waveform" />
            <AnalysisStatusBadge state="key" />
            <AnalysisStatusBadge state="complete" />
          </div>
        </Stage2Card>

        <Stage2Card label="Status Dot">
          <div className="dd-stage2-dot-list">
            <StatusDot label="Online" tone="success" />
            <StatusDot label="Active" tone="online" />
            <StatusDot label="Processing" tone="purple" pulse />
            <StatusDot label="Pending" tone="amber" />
            <StatusDot label="Warning" tone="warning" />
            <StatusDot label="Error" tone="error" />
            <StatusDot label="Offline" tone="disabled" />
          </div>
        </Stage2Card>

        <Stage2Card label="Progress Bar" className="dd-stage2-progress-card">
          <div className="dd-stage2-progress-list">
            <ProgressBar value={20} tone="active" showValue label="Import progress 20 percent" />
            <ProgressBar value={45} tone="online" showValue label="Sync progress 45 percent" />
            <ProgressBar value={68} tone="purple" showValue label="Analysis progress 68 percent" />
            <ProgressBar value={100} tone="success" showValue label="Completed progress" />
            <ProgressBar value={67} tone="warning" striped showValue label="Warning progress 67 percent" />
            <ProgressBar value={32} tone="error" showValue label="Error progress 32 percent" />
          </div>
        </Stage2Card>

        <Stage2Card label="Spinner / Loader">
          <div className="dd-stage2-loader-list">
            {([
              ['Spinner', 'spinner', 'active'],
              ['Dual Ring', 'dual-ring', 'online'],
              ['Pulse', 'pulse', 'purple'],
              ['Bars', 'bars', 'active'],
              ['Wave', 'wave', 'purple'],
              ['Dots', 'dots', 'success'],
            ] as const).map(([label, variant, tone]) => <div key={label}><span>{label}</span><StatusLoader variant={variant} tone={tone} label={label} /></div>)}
          </div>
        </Stage2Card>

        <Stage2Card label="Toast / Notification" className="dd-stage2-toast-card">
          <div className="dd-stage2-toast-stack">
            {toasts.map((toast) => (
              <ToastNotification key={toast.id} {...toast} onDismiss={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} />
            ))}
            {toasts.length === 0 && <button type="button" className="dd-stage2-restore" onClick={() => setToasts(toastSeed)}>Restore toast examples</button>}
          </div>
        </Stage2Card>
      </div>

      <div className="dd-stage2-grid dd-stage2-grid--middle">
        <Stage2Card label="Import Activity Banner" className="dd-stage2-import-banner">
          {bannerVisible ? (
            <ImportActivityBanner
              title="Importing 128 tracks"
              source="From Tech House Collection"
              detail="93 of 128 imported"
              remaining="2m 15s remaining"
              progress={72}
              onView={() => setActivityMessage('Import status opened')}
              onDismiss={() => setBannerVisible(false)}
            />
          ) : <button type="button" className="dd-stage2-restore" onClick={() => setBannerVisible(true)}>Restore import banner</button>}
        </Stage2Card>

        <Stage2Card label="Warning / Alert Banner" className="dd-stage2-warning-banner">
          {warningVisible ? <AlertBanner title="Storage space running low" message="You have 1.2 GB left on your drive" actionLabel="MANAGE" onAction={() => setActivityMessage('Storage manager opened')} onDismiss={() => setWarningVisible(false)} /> : <button type="button" className="dd-stage2-restore" onClick={() => setWarningVisible(true)}>Restore warning banner</button>}
        </Stage2Card>

        <Stage2Card label="Error / Empty State" className="dd-stage2-empty">
          <EmptyState title="No tracks found" message="Try adjusting your search or import new tracks." actionLabel="IMPORT TRACKS" onAction={() => setActivityMessage('Import tracks selected')} />
        </Stage2Card>

        <Stage2Card label="Background Import Panel / Floating Activity Panel" className="dd-stage2-floating">
          <FloatingActivityPanel
            title="Importing 256 Tracks"
            progress={72}
            rows={[
              { id: 'tech-house', label: 'Tech House Collection', current: 128, total: 128, complete: true },
              { id: 'redrum', label: 'Redrum Essentials', current: 96, total: 128 },
              { id: 'underground', label: 'Underground Grooves', current: 32, total: 64 },
            ]}
            remaining="2m 15s remaining"
            paused={activityPaused}
            onTogglePaused={() => setActivityPaused((value) => !value)}
            collapsed={activityCollapsed}
            onToggleCollapsed={() => setActivityCollapsed((value) => !value)}
          />
        </Stage2Card>
      </div>

      <div className="dd-stage2-grid dd-stage2-grid--lower">
        <Stage2Card label="Progress / Status Modal" className="dd-stage2-progress-modal">
          <ProgressStatusPanel
            title="Analyzing Collection"
            value={68}
            metrics={[
              { label: 'Tracks Analyzed', value: '1,264 / 1,856' },
              { label: 'BPM Detection', value: '1,238' },
              { label: 'Key Detection', value: '1,112' },
              { label: 'Waveforms', value: '1,264' },
            ]}
            remaining="1m 45s"
            onCancel={() => setActivityMessage('Analysis cancel requested')}
          />
        </Stage2Card>

        <Stage2Card label="File Upload Button" className="dd-stage2-upload-buttons">
          <FileUploadButton variant="primary" accept="audio/*" onFiles={(files) => setUploadFiles(files.map((file) => file.name))}>UPLOAD FILES</FileUploadButton>
          <FileUploadButton variant="folder" onClick={() => setActivityMessage('Upload folder selected')}>UPLOAD FOLDER</FileUploadButton>
          <FileUploadButton variant="outline" accept="audio/*" onFiles={(files) => setUploadFiles(files.map((file) => file.name))}>CHOOSE FILES</FileUploadButton>
          <FileUploadButton variant="device" onClick={() => setActivityMessage('Import from device selected')}>IMPORT FROM DEVICE</FileUploadButton>
          {uploadFiles.length > 0 && <span className="dd-stage2-action-result" role="status">Selected: {uploadFiles.join(', ')}</span>}
        </Stage2Card>

        <Stage2Card label="Upload Dropzone" className="dd-stage2-dropzone">
          <UploadDropzone accept="audio/mpeg,audio/wav,audio/aiff,audio/flac,audio/aac,audio/mp4,.mp3,.wav,.aiff,.flac,.aac,.m4a" onFiles={(files) => setDropzoneFiles(files.map((file) => file.name))} />
          {dropzoneFiles.length > 0 && <span className="dd-stage2-action-result" role="status">Selected: {dropzoneFiles.join(', ')}</span>}
        </Stage2Card>

        <Stage2Card label="Modal / Dialog" className="dd-stage2-dialog-card">
          {showDialog ? (
            <Dialog
              inline
              title="Import Playlist"
              onClose={() => setShowDialog(false)}
              actions={[
                { label: 'CANCEL', onClick: () => setShowDialog(false), variant: 'neutral' },
                { label: 'IMPORT', onClick: () => { setActivityMessage('Playlist import confirmed'); setShowDialog(false); }, variant: 'primary' },
              ]}
            >
              <label htmlFor="stage2-playlist">Select the playlist you want to import.</label>
              <select id="stage2-playlist" defaultValue="Tech House Selection"><option>Tech House Selection</option><option>Redrum Essentials</option></select>
              <span>Import Options</span>
              <div className="dd-dialog__checks">
                <label><input type="checkbox" defaultChecked /> Import tracks</label>
                <label><input type="checkbox" defaultChecked /> Import cues and loops</label>
                <label><input type="checkbox" /> Import artwork</label>
              </div>
            </Dialog>
          ) : <button type="button" className="dd-stage2-restore" onClick={() => setShowDialog(true)}>Open dialog preview</button>}
        </Stage2Card>

        <Stage2Card label="Destructive Confirmation Modal" className="dd-stage2-destructive-card">
          {showDestructive ? (
            <Dialog
              inline
              destructive
              title="Delete 128 Tracks?"
              onClose={() => setShowDestructive(false)}
              actions={[
                { label: 'CANCEL', onClick: () => setShowDestructive(false), variant: 'neutral' },
                { label: 'DELETE', onClick: () => { setActivityMessage('Safe demo delete confirmed'); setShowDestructive(false); }, variant: 'danger' },
              ]}
            >
              <p>This action cannot be undone.</p>
              <p>The selected tracks will be permanently removed from your collection.</p>
            </Dialog>
          ) : <button type="button" className="dd-stage2-restore" onClick={() => setShowDestructive(true)}>Open destructive preview</button>}
        </Stage2Card>

        <Stage2Card label="Selectable Option Card" className="dd-stage2-selectable">
          <div className="dd-stage2-option-grid" role="radiogroup" aria-label="Audio quality">
            <SelectableOptionCard selected={selected === 'quality'} onSelect={() => setSelected('quality')} title="High Quality" description="Best audio quality" meta="WAV, AIFF" recommended tone="active" icon={<Waveform size={24} />} />
            <SelectableOptionCard selected={selected === 'balanced'} onSelect={() => setSelected('balanced')} title="Balanced" description="Good quality" meta="MP3 320kbps" tone="online" icon={<Waveform size={24} />} />
            <SelectableOptionCard selected={selected === 'space'} onSelect={() => setSelected('space')} title="Space Saver" description="Smaller file size" meta="MP3 128kbps" tone="success" icon={<Sprout size={24} />} />
            <SelectableOptionCard selected={selected === 'lossless'} onSelect={() => setSelected('lossless')} title="Lossless" description="No quality loss" meta="FLAC" tone="purple" icon={<Star size={24} />} />
          </div>
        </Stage2Card>

        <Stage2Card label="Skeleton Row" className="dd-stage2-skeleton-row">
          <div className="dd-stage2-skeleton-stack">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        </Stage2Card>

        <Stage2Card label="Skeleton Card" className="dd-stage2-skeleton-card">
          <div className="dd-stage2-skeleton-card-grid">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        </Stage2Card>

        <Stage2Card label="Skeleton Chip" className="dd-stage2-skeleton-chip">
          <div className="dd-stage2-chip-grid"><SkeletonChip /><SkeletonChip /><SkeletonChip wide /><SkeletonChip wide /><SkeletonChip /><SkeletonChip /></div>
        </Stage2Card>
      </div>

      <span className="sr-only" role="status">{activityMessage}</span>
    </div>
  );
}
