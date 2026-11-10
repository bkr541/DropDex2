import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Database, Folder, NavArrowDown, Package, Pause, Refresh, Trash, Upload, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { cn } from '../lib/utils';
import type { CompleteResponse, ImportResult, ReuseStats } from '../lib/api/rekordboxImport';
import type { ManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
import { issueBadgeLabel, trackExpandedDetail, userFriendlyIssueReason } from './ImportProgressModal';
import { ControlButton } from './ui/controls';

// The screens of the Rekordbox import popover that need no import state of their own. The live import popover and Layout Lab's
// Popover tab both render these, so a change here shows in both.

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtEta(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `about ${hours} hr ${remainder} min` : `about ${hours} hr`;
}

export function SafetyStep({ label, complete, active }: { label: string; complete: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-3 text-left">
      {complete ? (
        <CheckCircle width={16} height={16} aria-hidden="true" className="shrink-0 text-[var(--color-control-primary)]" />
      ) : active ? (
        <Refresh width={16} height={16} aria-hidden="true" className="shrink-0 animate-spin text-amber-400" />
      ) : (
        <div className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border-subtle)]" />
      )}
      <span className={cn('text-xs', complete ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

/** The amber notice every USB screen shows while the drive is in use. */
export function KeepUsbNotice() {
  return (
    <div className="flex items-center gap-3 import-group import-group--amber text-left shrink-0">
      <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
      <p className="whitespace-nowrap text-[11px] leading-snug text-amber-100">Keep Rekordbox closed. Do not eject the drive until DropDex confirms.</p>
    </div>
  );
}

export type UploadStage = 'uploading_database' | 'matching_analysis' | 'uploading_analysis' | 'uploading_bundle';

const UPLOAD_TITLE: Record<UploadStage, string> = {
  uploading_database: 'Uploading Rekordbox Database…',
  matching_analysis: 'Matching Analysis Files…',
  uploading_analysis: 'Uploading Analysis Files…',
  uploading_bundle: 'Uploading Bundle…',
};
const UPLOAD_STAGE: Record<UploadStage, string> = {
  uploading_database: 'Uploading database',
  matching_analysis: 'Matching analysis files',
  uploading_analysis: 'Uploading analysis files',
  uploading_bundle: 'Uploading bundle',
};

/** Database and analysis files upload. */
export function ImportUploadScreen({ stage, zipBundle, progress, bundleSize, rejectedCount, retryingCount, uploadPct, onCancel, onBackground }: {
  stage: UploadStage;
  zipBundle: boolean;
  progress: { filesUploaded: number; filesTotal: number; bytesUploaded: number; bytesTotal: number };
  bundleSize: number | null;
  rejectedCount: number;
  retryingCount: number;
  uploadPct: number;
  onCancel: () => void;
  /** Omit when the library is not yet ready to browse. */
  onBackground?: () => void;
}) {
  const sending = stage === 'uploading_analysis' || stage === 'uploading_bundle';
  return (
    <div className="flex flex-col h-full">
      <div className="import-group import-group--accent text-center shrink-0">
        <div className="import-status-icon">
          <Refresh className="animate-spin text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
        </div>
        <h2 className="import-heading">{UPLOAD_TITLE[stage]}</h2>
      </div>

      <div className="mb-3"><KeepUsbNotice /></div>

      <div className="import-group import-stats text-left text-xs mb-3">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Stage</span>
          <span className="font-semibold text-foreground capitalize">{UPLOAD_STAGE[stage]}</span>
        </div>
        {sending && (
          <>
            {!zipBundle && progress.filesTotal > 0 && (
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Files accepted</span>
                <span className="font-semibold text-foreground">{progress.filesUploaded.toLocaleString()} / {progress.filesTotal.toLocaleString()}</span>
              </div>
            )}
            {progress.bytesTotal > 0 && (
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Data uploaded</span>
                <span className="font-semibold text-foreground">{fmtBytes(progress.bytesUploaded)} / {fmtBytes(progress.bytesTotal)}</span>
              </div>
            )}
            {zipBundle && bundleSize != null && (
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Bundle size</span>
                <span className="font-semibold text-foreground">{fmtBytes(bundleSize)}</span>
              </div>
            )}
            {rejectedCount > 0 && (
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Rejected</span>
                <span className="font-semibold text-amber-400">{rejectedCount.toLocaleString()}</span>
              </div>
            )}
            {retryingCount > 0 && (
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Retrying</span>
                <span className="font-semibold text-amber-400">{retryingCount.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
      </div>

      {sending && (
        <div className="shrink-0">
          <div className="w-full h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden mb-1.5">
            <div className="h-full bg-[var(--color-control-primary)] rounded-full transition-all duration-300" style={{ width: `${uploadPct}%` }} />
          </div>
          <p className="text-sm text-center text-muted-foreground">{uploadPct}%</p>
        </div>
      )}

      <div className="mt-auto flex justify-center gap-3 pt-2">
        <ControlButton variant="secondary" onClick={onCancel} className="whitespace-nowrap">
          <Xmark width={16} height={16} aria-hidden="true" /> Cancel import
        </ControlButton>
        {onBackground && (
          <ControlButton type="button" variant="primary" onClick={onBackground} className="whitespace-nowrap">
            <ArrowRight width={16} height={16} aria-hidden="true" />
            Browse in Background
          </ControlButton>
        )}
      </div>
    </div>
  );
}

export function ImportUsbReleasedScreen() {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--accent shrink-0">
        <div className="import-status-icon">
          <CheckCircle className="text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
        </div>
        <h2 className="import-heading">USB Access Released</h2>
      </div>
      <p className="text-sm text-muted-foreground">USB reading is complete. DropDex is continuing from uploaded copies and no longer needs the USB.</p>
    </div>
  );
}

/** Stopping the USB reads (and cloud work) before a pause or delete. */
export function ImportStoppingScreen({ usbReleaseConfirmed, cloudStepActive, deleting }: { usbReleaseConfirmed: boolean; cloudStepActive: boolean; deleting: boolean }) {
  const showSpinner = !usbReleaseConfirmed || cloudStepActive;
  return (
    <div className="flex flex-col h-full">
      <div className="import-group import-group--accent shrink-0 text-center">
        <div className="import-status-icon">
          {showSpinner ? (
            <Refresh className="animate-spin text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
          ) : (
            <CheckCircle className="text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
          )}
        </div>
        <h2 className="import-heading">
          {!usbReleaseConfirmed ? 'Stopping USB Reads…' : cloudStepActive ? 'Stopping Cloud Analysis…' : 'USB Access Released'}
        </h2>
      </div>
      {!usbReleaseConfirmed && <KeepUsbNotice />}
      <div className="space-y-2 import-group text-left">
        <SafetyStep label="Stopping local USB reads" complete={usbReleaseConfirmed} active={!usbReleaseConfirmed} />
        <SafetyStep label="USB access released" complete={usbReleaseConfirmed} active={false} />
        <SafetyStep label={deleting ? 'Stopping worker before delete' : 'Stopping cloud analysis'} complete={false} active={cloudStepActive} />
      </div>
    </div>
  );
}

function StatRow({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="mt-2 flex justify-between gap-4 first:mt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold text-foreground', className)}>{value}</span>
    </div>
  );
}

/** Analysis running. */
export function ImportAnalysisScreen({ readiness, parse, onPause, onBackground }: {
  readiness: { stage: string; tracksReady: number; tracksRemaining: number; estimatedSecondsRemaining: number | null; rawArchivalStatus: string; optionalArchivalStatus: string };
  parse: { percent: number; currentTrackLabel: string | null; totalTracks: number; parsedTracks: number };
  onPause: () => void;
  onBackground: () => void;
}) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--accent shrink-0">
        <div className="import-status-icon">
          <Refresh className="animate-spin text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
        </div>
        <h2 className="import-heading">Analysis Running</h2>
      </div>
      <div className="import-group import-stats text-left text-xs">
        <StatRow label="Current stage" value={readiness.stage} className="capitalize" />
        <StatRow label="Tracks ready" value={readiness.tracksReady.toLocaleString()} />
        <StatRow label="Tracks remaining" value={readiness.tracksRemaining.toLocaleString()} />
        <StatRow label="Estimate" value={readiness.estimatedSecondsRemaining != null ? fmtEta(readiness.estimatedSecondsRemaining) : 'Measuring throughput…'} />
        <StatRow label="Raw DAT/EXT archive" value={readiness.rawArchivalStatus} className="capitalize" />
        {readiness.optionalArchivalStatus !== 'skipped' && readiness.optionalArchivalStatus !== 'not needed' && (
          <StatRow label="Operator-enabled .2EX archive" value={readiness.optionalArchivalStatus} className="capitalize" />
        )}
      </div>
      <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">Processing</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground leading-snug">{parse.currentTrackLabel || 'queued tracks…'}</p>
      <div className="mt-3">
        <div className="w-full h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden mb-1.5">
          <div className="h-full bg-[var(--color-control-primary)] rounded-full transition-all duration-500" style={{ width: `${parse.percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {parse.percent}%
          {parse.totalTracks > 0 && <>{' '}·{' '}{Math.min(parse.parsedTracks, parse.totalTracks).toLocaleString()}{' '} / {parse.totalTracks.toLocaleString()} tracks</>}
        </p>
      </div>
      <div className="mt-auto flex justify-center gap-3 pt-4 flex-nowrap">
        <ControlButton type="button" variant="secondary" onClick={onPause} className="whitespace-nowrap shrink-0">
          <Pause width={16} height={16} aria-hidden="true" /> Pause Import
        </ControlButton>
        <ControlButton type="button" variant="primary" onClick={onBackground} className="whitespace-nowrap shrink-0">
          <ArrowRight width={16} height={16} aria-hidden="true" />
          Continue in Background
        </ControlButton>
      </div>
    </div>
  );
}

function DoneFooter({ onDone }: { onDone: () => void }) {
  return (
    <div className="mt-auto flex justify-center gap-3 pt-4">
      <ControlButton type="button" variant="primary" onClick={onDone}>
        <CheckCircle width={16} height={16} aria-hidden="true" />
        Done
      </ControlButton>
    </div>
  );
}

export function ImportPausedScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--amber shrink-0">
        <div className="import-status-icon"><CheckCircle className="text-amber-300" width={24} height={24} aria-hidden="true" /></div>
        <h2 className="import-heading">Analysis Paused Safely</h2>
      </div>
      <div className="import-group import-group--success flex items-start gap-3 text-left">
        <CheckCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-green-500" />
        <p className="text-xs leading-relaxed text-green-100">Your progress is saved. You can pick up where you left off at any time from Import History.</p>
      </div>
      <DoneFooter onDone={onDone} />
    </div>
  );
}

export function ImportInterruptedScreen({ message, onDone }: { message: string | null; onDone: () => void }) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--amber shrink-0">
        <div className="import-status-icon"><WarningTriangle className="text-amber-400" width={24} height={24} aria-hidden="true" /></div>
        <h2 className="import-heading">Analysis Interrupted</h2>
      </div>
      <div className="import-group text-left">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {message ?? 'Background analysis stopped unexpectedly.'} Open Import History or the background import panel and choose Resume. Completed work will not be repeated.
        </p>
      </div>
      <DoneFooter onDone={onDone} />
    </div>
  );
}

export function ImportFailedScreen({ saveFailed, message, stage, diagnostic, onRetry, onCancel }: {
  saveFailed: boolean;
  message: string | null;
  stage?: string | null;
  diagnostic?: string | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group shrink-0">
        <div className="import-status-icon"><WarningTriangle className="text-red-400" width={24} height={24} aria-hidden="true" /></div>
        <h2 className="import-heading">{saveFailed ? 'Library Parsed, Save Failed' : 'Import Failed'}</h2>
      </div>
      <p className="px-2 text-sm text-muted-foreground leading-relaxed">{message}</p>
      {stage && (
        <div className="mt-3 text-left import-group import-stats text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Stage:</span>
            <code className="font-mono text-amber-300">{stage}</code>
          </div>
          {diagnostic && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground shrink-0">Hint:</span>
              <span className="text-foreground">{diagnostic}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-auto flex justify-center gap-3 pt-4">
        <ControlButton variant="secondary" onClick={onCancel} className="whitespace-nowrap">
          <Xmark width={16} height={16} aria-hidden="true" />
          Cancel
        </ControlButton>
        <ControlButton variant="primary" onClick={onRetry} className="whitespace-nowrap">
          <Refresh width={16} height={16} aria-hidden="true" />
          Retry
        </ControlButton>
      </div>
    </div>
  );
}

export function ImportCancelledScreen({ errorMessage, onReset }: { errorMessage: string | null; onReset: () => void }) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--amber shrink-0">
        <div className="import-status-icon"><WarningTriangle width={24} height={24} aria-hidden="true" className="text-amber-400" /></div>
        <h2 className="import-heading">Import Deleted</h2>
      </div>
      <div>
        <p className="mt-1 text-sm text-muted-foreground">The Rekordbox import and its DropDex cloud data were permanently deleted. USB access is released.</p>
        {errorMessage && <p className="mt-2 text-sm text-destructive">{errorMessage}</p>}
      </div>
      <div className="mt-auto flex justify-center gap-3 pt-4">
        <ControlButton type="button" variant="primary" onClick={onReset} className="whitespace-nowrap">
          <Refresh width={16} height={16} aria-hidden="true" /> Start another import
        </ControlButton>
      </div>
    </div>
  );
}

export type AbortIntent = 'pause' | 'close' | 'delete';

/** The confirmation that covers the whole import popover before a pause or delete. */
export function ImportAbortDialog({ intent, localUsbAccessActive, onConfirm, onKeepGoing }: {
  intent: AbortIntent;
  localUsbAccessActive: boolean;
  onConfirm: () => void;
  onKeepGoing: () => void;
}) {
  return (
    <div className="import-group w-full max-w-sm bg-[var(--color-panel)] text-center">
      <div className="import-status-icon">
        <WarningTriangle className="text-amber-400" width={24} height={24} aria-hidden="true" />
      </div>
      <h2 className="import-heading">
        {intent === 'pause' ? 'Pause analysis?' : intent === 'close' ? 'Close and delete import?' : 'Permanently delete import?'}
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {intent === 'pause'
          ? 'Your progress is saved and the USB is no longer needed. DropDex will stop analysis at a safe point so you can resume later.'
          : localUsbAccessActive
            ? 'DropDex will safely finish reading from the USB, release the drive, then delete this import and all its uploaded data.'
            : 'This permanently deletes this import and all of its uploaded data. This cannot be undone.'}
      </p>
      <div className="flex flex-row-reverse justify-center gap-3">
        <ControlButton onClick={onConfirm} variant={intent === 'pause' ? 'primary' : 'danger'} className="whitespace-nowrap">
          {intent === 'pause' ? (
            <><Pause width={16} height={16} aria-hidden="true" /> Pause</>
          ) : (
            <><Trash width={16} height={16} aria-hidden="true" /> {intent === 'close' ? 'Stop and delete' : 'Delete Import and Data'}</>
          )}
        </ControlButton>
        <ControlButton onClick={onKeepGoing} variant="secondary" className="whitespace-nowrap">
          <ArrowRight width={16} height={16} aria-hidden="true" /> Keep going
        </ControlButton>
      </div>
    </div>
  );
}

export type Mode = 'usb_folder' | 'zip_bundle' | 'database_only';

export const MODE_LABELS: Record<Mode, { label: string; icon: ReactNode; tip: string }> = {
  usb_folder: {
    label: 'USB Folder',
    icon: <Folder width={14} height={14} aria-hidden="true" />,
    tip: 'Select your USB drive root (e.g. "My USB"). DropDex will find exportLibrary.db automatically. Your music files are not uploaded.',
  },
  zip_bundle: {
    label: 'ZIP Bundle',
    icon: <Package width={14} height={14} aria-hidden="true" />,
    tip: 'Upload a ZIP archive containing exportLibrary.db and ANLZ files.',
  },
  database_only: {
    label: 'Database Only',
    icon: <Database width={14} height={14} aria-hidden="true" />,
    tip: 'Upload exportLibrary.db to import playlists and track metadata without analysis data.',
  },
};

export interface ImportFolderScan {
  dbFile: { name: string; size: number } | null;
  anlzFiles: { length: number };
  folderName: string;
  targetedResolver: unknown;
}

const DROP_AREA = 'flex-1 w-full mb-3 px-4 rounded-xl border-2 border-dashed border-[var(--color-border-subtle)] hover:border-[#ffffff33] hover:bg-white/[0.04] transition-all flex flex-col items-center justify-center gap-2 text-muted-foreground';

/** Step one: choose where the Rekordbox library is (USB folder, ZIP bundle or database only). */
export function ImportSourceScreen({
  mode, onModeChange, isReady, scanning, folderScan, folderAllowsImport, selectedFile, unexpectedDbName,
  onSelectFolder, onPickFile, onImport, onCancel, hiddenInputs,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  isReady: boolean;
  scanning: boolean;
  /** The scanned folder, once one has been chosen. */
  folderScan: ImportFolderScan | null;
  folderAllowsImport: boolean;
  selectedFile: { name: string; size: number } | null;
  unexpectedDbName: boolean;
  onSelectFolder: () => void;
  onPickFile: () => void;
  onImport: () => void;
  onCancel: () => void;
  /** The file inputs the screen opens. Layout Lab has none. */
  hiddenInputs?: ReactNode;
}) {
  const footer = (importDisabled: boolean, ready: boolean) => (
    <div className="mt-auto flex justify-center gap-3 pt-4">
      <ControlButton variant="secondary" onClick={onCancel}>
        <Xmark width={16} height={16} aria-hidden="true" /> Cancel
      </ControlButton>
      <ControlButton variant="primary" onClick={onImport} disabled={importDisabled}>
        <span key={ready ? 'ready' : 'idle'} className="dd-icon-pop">
          {ready ? <CheckCircle width={16} height={16} aria-hidden="true" /> : <Upload width={16} height={16} aria-hidden="true" />}
        </span>
        Import
      </ControlButton>
    </div>
  );
  return (
    <div className="flex flex-col h-full">
      <div className={cn(
        'flex gap-1.5 p-1 rounded-xl border border-[var(--color-border-subtle)] mb-4 transition-colors shrink-0',
        isReady ? 'bg-[rgb(var(--color-control-primary-rgb)/0.1)]' : 'bg-[var(--color-surface)]',
      )}>
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all',
              mode === m ? 'bg-[var(--color-control-primary)] text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {MODE_LABELS[m].icon}
            {MODE_LABELS[m].label}
          </button>
        ))}
      </div>

      <div className="mb-3 shrink-0">
        <p className="text-sm text-muted-foreground leading-relaxed">{MODE_LABELS[mode].tip}</p>
      </div>

      {mode === 'usb_folder' && (
        <>
          <button
            onClick={onSelectFolder}
            className={cn('flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2 shrink-0', !folderScan && 'invisible pointer-events-none')}
          >
            <ArrowRight width={10} height={10} aria-hidden="true" className="rotate-180 shrink-0" />
            Choose different folder
          </button>
          {scanning ? (
            <div className="flex-1 mb-3 px-4 rounded-xl border-2 border-dashed border-[var(--color-border-subtle)] flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Refresh width={20} height={20} aria-hidden="true" className="animate-spin text-[var(--color-control-primary)]" />
              <p className="text-sm">Scanning folder…</p>
            </div>
          ) : folderScan ? (
            <div className="import-group import-group--accent flex-1 text-left">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{folderScan.folderName}</p>
              <div className="space-y-2">
                {folderScan.dbFile ? (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle width={14} height={14} aria-hidden="true" className="text-[var(--color-control-primary)] shrink-0" />
                    <span className="font-mono text-xs truncate">{folderScan.dbFile.name}</span>
                    <span className="text-muted-foreground text-xs shrink-0">{fmtBytes(folderScan.dbFile.size)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <WarningTriangle width={14} height={14} aria-hidden="true" className="text-red-400 shrink-0" />
                    <span className="text-red-400 text-xs">exportLibrary.db not found</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  {folderScan.targetedResolver ? (
                    <>
                      <CheckCircle width={14} height={14} aria-hidden="true" className="text-[var(--color-control-primary)] shrink-0" />
                      <span className="text-xs">Analysis files will be opened only when requested by the library manifest</span>
                    </>
                  ) : folderScan.anlzFiles.length > 0 ? (
                    <CheckCircle width={14} height={14} aria-hidden="true" className="text-[var(--color-control-primary)] shrink-0" />
                  ) : (
                    <WarningTriangle width={14} height={14} aria-hidden="true" className="text-amber-400 shrink-0" />
                  )}
                  {!folderScan.targetedResolver && (
                    <span className="text-xs">
                      {folderScan.anlzFiles.length.toLocaleString()} required DAT/EXT analysis file{folderScan.anlzFiles.length !== 1 ? 's' : ''} found
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <button onClick={onSelectFolder} className={DROP_AREA}>
              <Folder width={20} height={20} aria-hidden="true" />
              <p className="text-sm">Click to select USB drive folder</p>
            </button>
          )}
          {footer(!folderAllowsImport, folderAllowsImport)}
        </>
      )}

      {(mode === 'zip_bundle' || mode === 'database_only') && (
        <>
          {selectedFile ? (
            <div
              className="import-group import-group--accent cursor-pointer text-center"
              onClick={onPickFile}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onPickFile()}
            >
              <p className="text-sm font-bold font-mono truncate">{selectedFile.name}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{fmtBytes(selectedFile.size)} · Click to change</p>
            </div>
          ) : (
            <button onClick={onPickFile} className={DROP_AREA}>
              <Upload width={20} height={20} aria-hidden="true" />
              <p className="text-sm">Click to select {mode === 'zip_bundle' ? '.zip bundle' : 'exportLibrary.db'}</p>
            </button>
          )}
          {unexpectedDbName && (
            <div className="import-group import-group--amber flex items-start gap-3 text-left shrink-0">
              <WarningTriangle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-100">
                Unexpected filename. The standard Rekordbox database is named <code className="font-mono">exportLibrary.db</code>. You can still try importing.
              </p>
            </div>
          )}
          <div className="mt-auto flex justify-center gap-3 pt-4">
            <ControlButton variant="secondary" onClick={onCancel}>
              <Xmark width={16} height={16} aria-hidden="true" /> Cancel
            </ControlButton>
            <ControlButton variant="primary" onClick={onImport} disabled={!selectedFile}>
              <Upload width={16} height={16} aria-hidden="true" />
              Import
            </ControlButton>
          </div>
        </>
      )}
      {hiddenInputs}
    </div>
  );
}

/** The finished screen: library imported, with or without analysis. */
export function ImportCompleteScreen({ usbReleaseConfirmed, withAnalysis, libraryOnly, reuseStats, onDone }: {
  usbReleaseConfirmed: boolean;
  withAnalysis: CompleteResponse | null;
  libraryOnly: ImportResult | null;
  reuseStats: ReuseStats | null;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col h-full text-center">
      <div className="import-group import-group--accent shrink-0">
        <div className="import-status-icon">
          <CheckCircle className="text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
        </div>
        <h2 className="import-heading">
          {withAnalysis ? 'Library Imported with Analysis!' : 'Library Imported!'}
        </h2>
      </div>

      {usbReleaseConfirmed && (
        <div className="flex items-start gap-3 import-group import-group--success text-left">
          <CheckCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-green-500" />
          <p className="text-xs leading-relaxed text-green-100">
            USB reading is complete. DropDex no longer needs the USB.
          </p>
        </div>
      )}

      {withAnalysis && (
        <p className="mb-3 text-sm text-muted-foreground">
          {withAnalysis.completed_count.toLocaleString()} tracks fully analysed.
        </p>
      )}
      {libraryOnly && (
        <p className="mb-3 text-sm text-muted-foreground">
          <code className="font-mono text-xs">{libraryOnly.source_filename}</code> imported
          successfully.
        </p>
      )}

      {withAnalysis && (
        <div className="import-group import-stats text-left text-xs">
          {[
            { label: 'Tracks', value: withAnalysis.total_tracks.toLocaleString() },
            { label: 'Analysed', value: withAnalysis.completed_count.toLocaleString() },
            { label: 'Parser', value: withAnalysis.parser_version },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="truncate font-semibold text-foreground" title={String(value)}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {withAnalysis && (withAnalysis.missing_optional_ext_count > 0 || withAnalysis.missing_optional_2ex_count > 0) && (
        <div className="mb-3 import-group import-group--amber text-left">
          <p className="import-group__label">
            Optional Waveforms
          </p>
          <div className="space-y-1">
            {withAnalysis.missing_optional_ext_count > 0 && (
              <SummaryRow label="Missing color waveform (EXT)" value={withAnalysis.missing_optional_ext_count} />
            )}
            {withAnalysis.missing_optional_2ex_count > 0 && (
              <SummaryRow label="Optional .2EX not archived" value={withAnalysis.missing_optional_2ex_count} />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Optional assets do not affect library readiness or track analysis.
          </p>
        </div>
      )}

      {reuseStats && reuseStats.tracksReused > 0 && (
        <div className="mb-4 import-group text-left">
          <p className="import-group__label">
            Reuse Summary
          </p>
          <div className="space-y-1">
            {reuseStats.tracksReused > 0 && (
              <ReuseRow label="Reused unchanged" value={reuseStats.tracksReused} />
            )}
            {reuseStats.tracksNeedingUpload > 0 && (
              <ReuseRow label="Uploaded" value={reuseStats.tracksNeedingUpload} />
            )}
            {reuseStats.tracksReparsedFromRetained > 0 && (
              <ReuseRow label="Reparsed from retained" value={reuseStats.tracksReparsedFromRetained} />
            )}
            {reuseStats.tracksMetadataOnly > 0 && (
              <ReuseRow label="Metadata refreshed" value={reuseStats.tracksMetadataOnly} />
            )}
          </div>
        </div>
      )}

      {libraryOnly && (
        <>
          <div className="import-group import-stats text-left text-xs">
            {[
              { label: 'Tracks', value: libraryOnly.track_count.toLocaleString() },
              { label: 'Playlists', value: libraryOnly.playlist_count },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-semibold text-foreground">{value}</span>
              </div>
            ))}
          </div>

          {libraryOnly.playlists.length > 0 && (
            <div className="mb-3 max-h-36 space-y-1 overflow-y-auto pr-1 text-left">
              {libraryOnly.playlists.map((pl) => (
                <div
                  key={`${pl.name}-${pl.track_count}`}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-surface)]"
                >
                  <span className="text-xs font-medium truncate">{pl.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                    {pl.track_count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-auto flex justify-center gap-3 pt-4">
        <ControlButton variant="primary" onClick={onDone}>
          <CheckCircle width={16} height={16} aria-hidden="true" />
          Done
        </ControlButton>
      </div>
    </div>
  );
}

/** The finished screen when some tracks need attention: counts, file summary and a link to the track issues. */
export function ImportPartialSummary({ usbReleaseConfirmed, withAnalysis, reconciliation, onOpenIssues, onDone }: {
  usbReleaseConfirmed: boolean;
  withAnalysis: CompleteResponse | null;
  reconciliation: ManifestReconciliation | null;
  onOpenIssues: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {usbReleaseConfirmed && (
        <div className="mb-3 flex items-start gap-3 import-group import-group--success">
          <CheckCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-green-500" />
          <p className="text-xs leading-relaxed text-green-100">
            USB reading is complete. DropDex no longer needs the USB.
          </p>
        </div>
      )}

      {withAnalysis && (() => {
        const issueCount = withAnalysis.partial_count + withAnalysis.failed_count + withAnalysis.missing_required_count;
        return (
          <>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm text-muted-foreground">
                {withAnalysis.completed_count.toLocaleString()} tracks fully parsed
              </p>
              {issueCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenIssues}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
                >
                  <span>{issueCount.toLocaleString()} {issueCount === 1 ? 'Issue' : 'Issues'}</span>
                  <ArrowRight width={13} height={13} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="import-group import-stats text-left text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Tracks Ready</span>
                <span className="font-semibold text-foreground">{withAnalysis.completed_count.toLocaleString()}</span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Tracks with Issues</span>
                <span className="font-semibold text-amber-400">{withAnalysis.partial_count.toLocaleString()}</span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Tracks Not Processed</span>
                <span className="font-semibold text-amber-400">{withAnalysis.failed_count.toLocaleString()}</span>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted-foreground">Missing Analysis Files</span>
                <span className="font-semibold text-amber-400">{withAnalysis.missing_required_count.toLocaleString()}</span>
              </div>
            </div>

            {reconciliation && (reconciliation.failedFiles > 0 || reconciliation.missingFiles > 0 || withAnalysis.missing_optional_ext_count > 0 || withAnalysis.missing_optional_2ex_count > 0) && (
              <div className="mb-3 import-group">
                <p className="import-group__label">File Summary</p>
                <div className="space-y-1">
                  <SummaryRow label="Uploaded" value={reconciliation.successfullyUploadedFiles} />
                  {reconciliation.failedFiles > 0 && <SummaryRow label="Failed after retries" value={reconciliation.failedFiles} warn />}
                  {reconciliation.missingFiles > 0 && <SummaryRow label="Not found on USB" value={reconciliation.missingFiles} warn />}
                  {withAnalysis.missing_optional_ext_count > 0 && <SummaryRow label="Missing color waveform (EXT)" value={withAnalysis.missing_optional_ext_count} />}
                  {withAnalysis.missing_optional_2ex_count > 0 && <SummaryRow label="Optional .2EX not archived" value={withAnalysis.missing_optional_2ex_count} />}
                </div>
                {(reconciliation.failedFiles > 0 || reconciliation.missingFiles > 0) && (
                  <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                    Re-import from the same USB to retry — already-uploaded files are skipped.
                  </p>
                )}
              </div>
            )}
          </>
        );
      })()}

      <div className="mt-auto flex justify-center gap-3 pt-4">
        <ControlButton variant="primary" onClick={onDone}>
          <CheckCircle width={16} height={16} aria-hidden="true" />
          Done
        </ControlButton>
      </div>

    </div>
  );
}

export interface ImportIssueTrack {
  id: string;
  title: string;
  artist: string | null;
  analysis_parse_status: string | null;
  analysis_failure_reason: string | null;
  analysis_parse_warnings: { code?: string }[] | null;
}

/** The list of tracks that need attention, each opening to its detail. */
export function ImportIssuesScreen({ tracks, loading, expandedIds, onToggle, onBack, onDone }: {
  tracks: ImportIssueTrack[] | null;
  loading: boolean;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Issues sub-heading with back navigation — not a modal header */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <button
          type="button"
          onClick={() => onBack()}
          className="flex items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[0.06]"
          aria-label="Back to summary"
        >
          <ArrowLeft width={20} height={20} aria-hidden="true" />
        </button>
        <h2 className="import-heading !m-0 text-left">Track Issues</h2>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Refresh className="animate-spin" width={16} height={16} aria-hidden="true" />
          Loading affected tracks…
        </div>
      )}

      {!loading && tracks && tracks.length === 0 && (
        <p className="text-sm text-muted-foreground">No track details available.</p>
      )}

      {!loading && tracks && tracks.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
          {tracks.map((track) => {
            const issueLabel = issueBadgeLabel(track.analysis_parse_status ?? '');
            const isWarning = track.analysis_parse_status === 'partial';
            const reason = userFriendlyIssueReason(
              track.analysis_parse_status ?? '',
              track.analysis_failure_reason,
            );
            const isExpanded = expandedIds.has(track.id);
            const detail = trackExpandedDetail(
              track.analysis_parse_status ?? '',
              track.analysis_failure_reason,
              track.analysis_parse_warnings,
            );
            return (
              <div key={track.id}>
                <button
                  type="button"
                  onClick={() => onToggle(track.id)}
                  className="w-full flex items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                    {track.artist && (
                      <p className="truncate text-[10px] text-muted-foreground">{track.artist}</p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">{reason}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap',
                      isWarning
                        ? 'border border-amber-400/25 bg-amber-400/10 text-amber-300'
                        : 'border border-red-400/25 bg-red-400/10 text-red-300',
                    )}>
                      {issueLabel}
                    </span>
                    <NavArrowDown
                      width={12} height={12} aria-hidden="true"
                      className={cn(
                        'text-muted-foreground transition-transform duration-200',
                        isExpanded && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0">
                    <p className="text-[11px] text-muted-foreground leading-relaxed rounded-lg bg-white/[0.04] px-3 py-2.5">
                      {detail}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto flex justify-center gap-3 pt-4 shrink-0">
        <ControlButton variant="primary" onClick={onDone}>
          <CheckCircle width={16} height={16} aria-hidden="true" />
          Done
        </ControlButton>
      </div>

    </div>
  );
}

export function ReuseRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

export function SummaryRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${warn ? 'text-amber-400' : 'text-foreground'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
