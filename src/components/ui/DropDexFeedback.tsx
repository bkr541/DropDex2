import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  CloudUpload,
  FileUp,
  FolderOpen,
  Info,
  Loader2,
  Pause,
  Search,
  Smartphone,
  Upload,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import './dropdex-feedback.css';

export type SemanticTone = 'success' | 'online' | 'active' | 'purple' | 'pink' | 'amber' | 'warning' | 'error' | 'disabled' | 'neutral';

const toneClass: Record<SemanticTone, string> = {
  success: 'dd-tone-success',
  online: 'dd-tone-online',
  active: 'dd-tone-active',
  purple: 'dd-tone-purple',
  pink: 'dd-tone-pink',
  amber: 'dd-tone-amber',
  warning: 'dd-tone-warning',
  error: 'dd-tone-error',
  disabled: 'dd-tone-disabled',
  neutral: 'dd-tone-neutral',
};

export function clampProgress(value: number, min = 0, max = 100): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  if (!Number.isFinite(max) || max <= safeMin) return safeMin;
  if (!Number.isFinite(value)) return safeMin;
  return Math.min(max, Math.max(safeMin, value));
}

export function progressPercent(value: number, max = 100): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return clampProgress((value / max) * 100);
}

export function StatusBadge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: SemanticTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('dd-status-badge', toneClass[tone], className)}>
      {icon && <span className="dd-status-badge__icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

export type AnalysisBadgeState = 'not-analyzed' | 'analyzing' | 'bpm' | 'waveform' | 'key' | 'complete' | 'failed' | 'partial' | 'reused';

const ANALYSIS_META: Record<AnalysisBadgeState, { label: string; tone: SemanticTone; icon: ReactNode }> = {
  'not-analyzed': { label: 'Not Analyzed', tone: 'neutral', icon: <Zap size={11} /> },
  analyzing: { label: 'Analyzing', tone: 'active', icon: <Loader2 size={11} className="dd-spin" /> },
  bpm: { label: 'BPM Analyzed', tone: 'online', icon: <CircleDot size={11} /> },
  waveform: { label: 'Waveform Ready', tone: 'purple', icon: <Zap size={11} /> },
  key: { label: 'Key Analyzed', tone: 'amber', icon: <Check size={11} /> },
  complete: { label: 'Fully Analyzed', tone: 'success', icon: <CheckCircle2 size={11} /> },
  failed: { label: 'Analysis Failed', tone: 'error', icon: <XCircle size={11} /> },
  partial: { label: 'Analysis Partial', tone: 'warning', icon: <AlertTriangle size={11} /> },
  reused: { label: 'Analysis Reused', tone: 'success', icon: <CheckCircle2 size={11} /> },
};

export function AnalysisStatusBadge({ state, label, className }: { state: AnalysisBadgeState; label?: string; className?: string }) {
  const meta = ANALYSIS_META[state];
  return <StatusBadge tone={meta.tone} icon={meta.icon} className={className}>{label ?? meta.label}</StatusBadge>;
}

export function StatusDot({
  label,
  tone,
  pulse = false,
  className,
}: {
  label?: string;
  tone: SemanticTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('dd-status-dot-wrap', className)}>
      <span className={cn('dd-status-dot', toneClass[tone], pulse && 'dd-status-dot--pulse')} aria-hidden="true" />
      {label && <span className="dd-status-dot__label">{label}</span>}
      {!label && <span className="sr-only">{tone} status</span>}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'active',
  striped = false,
  showValue = false,
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: SemanticTone;
  striped?: boolean;
  showValue?: boolean;
  label?: string;
  className?: string;
}) {
  const pct = progressPercent(value, max);
  return (
    <div className={cn('dd-progress', className)}>
      <div
        className="dd-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(max) && max > 0 ? max : 100}
        aria-valuenow={Number.isFinite(value) ? clampProgress(value, 0, Number.isFinite(max) && max > 0 ? max : 100) : 0}
      >
        <div
          className={cn('dd-progress__fill', toneClass[tone], striped && 'dd-progress__fill--striped')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue && <span className="dd-progress__value">{Math.round(pct)}%</span>}
    </div>
  );
}

export type LoaderVariant = 'spinner' | 'dual-ring' | 'pulse' | 'bars' | 'wave' | 'dots';

export function StatusLoader({ variant = 'spinner', tone = 'active', label = 'Loading' }: { variant?: LoaderVariant; tone?: SemanticTone; label?: string }) {
  const cls = toneClass[tone];
  return (
    <span className={cn('dd-loader', `dd-loader--${variant}`, cls)} role="status" aria-label={label}>
      {variant === 'spinner' && <span className="dd-loader__ring" />}
      {variant === 'dual-ring' && <><span className="dd-loader__dual-a" /><span className="dd-loader__dual-b" /></>}
      {variant === 'pulse' && <><span className="dd-loader__pulse-ring" /><span className="dd-loader__pulse-core" /></>}
      {variant === 'bars' && Array.from({ length: 4 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
      {variant === 'wave' && Array.from({ length: 5 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
      {variant === 'dots' && Array.from({ length: 4 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
    </span>
  );
}

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
const toastTone: Record<ToastTone, SemanticTone> = {
  success: 'success', info: 'active', warning: 'warning', error: 'error',
};

export function ToastNotification({
  tone,
  title,
  message,
  meta,
  onDismiss,
  className,
}: {
  tone: ToastTone;
  title: string;
  message: string;
  meta?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const icon = tone === 'success'
    ? <CheckCircle2 size={18} />
    : tone === 'warning'
      ? <AlertTriangle size={18} />
      : tone === 'error'
        ? <XCircle size={18} />
        : <Info size={18} />;
  return (
    <div className={cn('dd-toast', `dd-toast--${tone}`, className)} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <span className={cn('dd-toast__icon', toneClass[toastTone[tone]])}>{icon}</span>
      <div className="dd-toast__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {meta && <span className="dd-toast__meta">{meta}</span>}
      {onDismiss && (
        <button type="button" className="dd-toast__close" onClick={onDismiss} aria-label={`Dismiss ${title} notification`}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function CircularProgress({ value, size = 54, strokeWidth = 4, tone = 'active', label }: { value: number; size?: number; strokeWidth?: number; tone?: SemanticTone; label?: string }) {
  const pct = clampProgress(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (pct / 100);
  return (
    <span className={cn('dd-circular-progress', toneClass[tone])} style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="dd-circular-progress__track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} />
        <circle className="dd-circular-progress__value" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} />
      </svg>
      <strong>{Math.round(pct)}%</strong>
    </span>
  );
}

export function ImportActivityBanner({
  title,
  source,
  detail,
  secondaryDetail,
  remaining,
  progress,
  onView,
  onDismiss,
  className,
  viewLabel = 'VIEW',
}: {
  title: string;
  source: string;
  detail: string;
  secondaryDetail?: string;
  remaining?: string;
  progress: number;
  onView?: () => void;
  onDismiss?: () => void;
  className?: string;
  viewLabel?: string;
}) {
  return (
    <section className={cn('dd-activity-banner', className)} aria-live="polite">
      <CircularProgress value={progress} size={52} tone="active" label={`${title} progress`} />
      <div className="dd-activity-banner__copy">
        <strong>{title}</strong>
        <span className="dd-activity-banner__source">{source}</span>
        <span>{detail}</span>
        {secondaryDetail && <small>{secondaryDetail}</small>}
      </div>
      {remaining && <span className="dd-activity-banner__remaining">{remaining}</span>}
      {onView && <button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onView}>{viewLabel}</button>}
      {onDismiss && <button type="button" className="dd-icon-dismiss" onClick={onDismiss} aria-label={`Dismiss ${title}`}><X size={15} /></button>}
    </section>
  );
}

export function AlertBanner({
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <section className="dd-alert-banner" role="alert">
      <AlertTriangle size={25} aria-hidden="true" />
      <div className="dd-alert-banner__copy"><strong>{title}</strong><span>{message}</span></div>
      {actionLabel && onAction && <button type="button" className="dd-feedback-button dd-feedback-button--warning" onClick={onAction}>{actionLabel}</button>}
      {onDismiss && <button type="button" className="dd-icon-dismiss" onClick={onDismiss} aria-label={`Dismiss ${title}`}><X size={15} /></button>}
    </section>
  );
}

export function EmptyState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <section className="dd-empty-state">
      <div className="dd-empty-state__icon" aria-hidden="true"><FolderOpen size={38} /><Search size={22} /></div>
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction && <button type="button" className="dd-feedback-button dd-feedback-button--primary" onClick={onAction}>{actionLabel}</button>}
    </section>
  );
}

export interface ActivityRow {
  id: string;
  label: string;
  current: number;
  total: number;
  complete?: boolean;
}

export function FloatingActivityPanel({
  title,
  progress,
  rows,
  remaining,
  paused,
  onTogglePaused,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  title: string;
  progress: number;
  rows: ActivityRow[];
  remaining?: string;
  paused?: boolean;
  onTogglePaused?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}) {
  return (
    <section className={cn('dd-floating-activity', className)} aria-label={title}>
      <header>
        <div><Upload size={13} aria-hidden="true" /><strong>{title}</strong></div>
        <div><strong>{Math.round(clampProgress(progress))}%</strong>{onToggleCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand activity panel' : 'Collapse activity panel'}><ChevronDown size={14} className={collapsed ? '-rotate-90' : ''} /></button>}</div>
      </header>
      {!collapsed && <>
        <div className="dd-floating-activity__rows">
          {rows.map((row) => (
            <div className="dd-floating-activity__row" key={row.id}>
              <span>{row.label}</span>
              <b>{row.current} / {row.total}</b>
              {row.complete ? <CheckCircle2 size={13} className="dd-complete-icon" aria-label="Complete" /> : <ProgressBar value={row.current} max={row.total} tone="active" label={`${row.label} progress`} />}
            </div>
          ))}
        </div>
        <footer>
          <span>{remaining}</span>
          {onTogglePaused && <button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onTogglePaused}>{paused ? <PlayInline /> : <PauseInline />}{paused ? 'RESUME' : 'PAUSE'}</button>}
        </footer>
      </>}
    </section>
  );
}

function PauseInline() { return <Pause size={11} aria-hidden="true" />; }
function PlayInline() { return <Circle size={10} fill="currentColor" aria-hidden="true" />; }

export interface ProgressMetric {
  label: string;
  value: string | number;
}

export function ProgressStatusPanel({
  title,
  value,
  metrics,
  remaining,
  onCancel,
}: {
  title: string;
  value: number;
  metrics: ProgressMetric[];
  remaining?: string;
  onCancel?: () => void;
}) {
  return (
    <section className="dd-progress-panel" aria-label={title}>
      <header><strong>{title}</strong><X size={14} aria-hidden="true" /></header>
      <div className="dd-progress-panel__body">
        <CircularProgress value={value} size={104} strokeWidth={7} tone="purple" label={`${title} progress`} />
        <dl>
          {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
          {remaining && <div><dt>Estimated Time Remaining</dt><dd>{remaining}</dd></div>}
        </dl>
      </div>
      {onCancel && <footer><button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onCancel}>CANCEL</button></footer>}
    </section>
  );
}

export type UploadButtonVariant = 'primary' | 'folder' | 'outline' | 'device';
export function FileUploadButton({
  variant = 'primary',
  children,
  onClick,
  onFiles,
  accept,
  multiple = true,
}: {
  variant?: UploadButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  onFiles?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const icon = variant === 'primary' ? <Upload size={14} /> : variant === 'folder' ? <FolderOpen size={14} /> : variant === 'device' ? <Smartphone size={14} /> : <CircleDot size={13} />;
  const handleClick = () => {
    if (onFiles) inputRef.current?.click();
    onClick?.();
  };
  return <>
    {onFiles && <input ref={inputRef} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length > 0) onFiles(files);
      event.target.value = '';
    }} />}
    <button type="button" className={cn('dd-upload-button', `dd-upload-button--${variant}`)} onClick={handleClick}>{icon}{children}</button>
  </>;
}

export function UploadDropzone({
  accept,
  multiple = true,
  onFiles,
  label = 'Drag and drop files here',
  helper = 'Supports MP3, WAV, AIFF, FLAC, AAC, M4A',
}: {
  accept?: string;
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
  label?: string;
  helper?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles?.(files);
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    emit(event.target.files);
    event.target.value = '';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    emit(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div
      className={cn('dd-dropzone', dragging && 'dd-dropzone--dragging')}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-describedby={`${inputId}-helper`}
    >
      <input ref={inputRef} id={inputId} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={onChange} onClick={(event) => event.stopPropagation()} tabIndex={-1} />
      <CloudUpload size={42} aria-hidden="true" />
      <strong>{label}</strong>
      <span>or <u>click to browse</u></span>
      <small id={`${inputId}-helper`}>{helper}</small>
      <span className="dd-feedback-button dd-feedback-button--ghost">BROWSE FILES</span>
    </div>
  );
}

export interface DialogAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
}

export function Dialog({
  open = true,
  title,
  children,
  actions,
  onClose,
  destructive = false,
  inline = false,
  closeOnBackdrop = true,
}: {
  open?: boolean;
  title: string;
  children: ReactNode;
  actions?: DialogAction[];
  onClose?: () => void;
  destructive?: boolean;
  inline?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !onClose || inline) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [inline, onClose, open]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surfaceRef.current?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  const surface = (
    <section
      ref={surfaceRef}
      tabIndex={-1}
      className={cn('dd-dialog', destructive && 'dd-dialog--destructive', inline && 'dd-dialog--inline')}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      onKeyDown={inline && onClose ? (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      } : undefined}
    >
      <header>
        {destructive && <AlertTriangle size={29} aria-hidden="true" />}
        <strong id={titleId}>{title}</strong>
        {onClose && <button type="button" className="dd-icon-dismiss" onClick={onClose} aria-label={`Close ${title}`}><X size={15} /></button>}
      </header>
      <div className="dd-dialog__body">{children}</div>
      {actions && actions.length > 0 && <footer>{actions.map((action) => <button key={action.label} type="button" disabled={action.disabled} className={cn('dd-feedback-button', action.variant === 'danger' ? 'dd-feedback-button--danger' : action.variant === 'primary' ? 'dd-feedback-button--primary' : 'dd-feedback-button--ghost')} onClick={action.onClick}>{action.label}</button>)}</footer>}
    </section>
  );
  if (inline) return surface;
  return <div className="dd-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose?.(); }}>{surface}</div>;
}

export function SelectableOptionCard({
  selected,
  title,
  description,
  meta,
  recommended,
  tone = 'active',
  icon,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description?: string;
  meta?: string;
  recommended?: boolean;
  tone?: SemanticTone;
  icon?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={cn('dd-selectable-card', selected && 'dd-selectable-card--selected', selected && toneClass[tone])}>
      <span className="dd-selectable-card__top">
        <span className={cn('dd-selectable-card__icon', toneClass[tone])}>{icon ?? <FileUp size={22} />}</span>
        <span className="dd-selectable-card__radio">{selected && <Check size={11} strokeWidth={3} />}</span>
      </span>
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {meta && <small>{meta}</small>}
      {recommended && <em>RECOMMENDED</em>}
    </button>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <span className={cn('dd-skeleton', className)} aria-hidden="true" />;
}

export function SkeletonRow() {
  return <div className="dd-skeleton-row" role="status" aria-busy="true" aria-label="Loading row"><SkeletonBlock className="dd-skeleton-row__lead" /><div><SkeletonBlock /><SkeletonBlock /></div><SkeletonBlock className="dd-skeleton-row__mini" /><SkeletonBlock className="dd-skeleton-row__mini" /><SkeletonBlock className="dd-skeleton-row__tail" /></div>;
}

export function SkeletonCard() {
  return <div className="dd-skeleton-card" role="status" aria-busy="true" aria-label="Loading card"><SkeletonBlock className="dd-skeleton-card__image" /><SkeletonBlock /><SkeletonBlock className="dd-skeleton-card__short" /><div><SkeletonBlock className="dd-skeleton-card__chip" /><SkeletonBlock className="dd-skeleton-card__dot" /></div></div>;
}

export function SkeletonChip({ wide = false }: { wide?: boolean }) {
  return <span className={cn('dd-skeleton-chip', wide && 'dd-skeleton-chip--wide')} role="status" aria-busy="true" aria-label="Loading chip"><SkeletonBlock /></span>;
}
