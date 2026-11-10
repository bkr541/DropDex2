import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Asterisk, Check, Clock, DotsGrid3x3, FloppyDisk, Magnet, Page, Repeat, Ruler, SoundHigh, SoundOff, WarningTriangle } from 'iconoir-react/regular';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import type { CueGridDisplayMode } from '../../lib/cues/cueTimelineViewport';
import type { CueSnapResolution } from '../../lib/music/cueEditorState';

export type CueDraftState = 'Original' | 'Unsaved' | 'Saved' | 'Needs Verification' | 'Needs Apply' | 'Applied';

const STATE_VISUALS: Record<CueDraftState, { color: string; icon: (size: number) => ReactNode }> = {
  Original: { color: '#8e9aa8', icon: (size) => <Page width={size} height={size} aria-hidden="true" /> },
  Unsaved: { color: '#fbbf24', icon: (size) => <Asterisk width={size} height={size} aria-hidden="true" /> },
  Saved: { color: '#3b91ff', icon: (size) => <FloppyDisk width={size} height={size} aria-hidden="true" /> },
  'Needs Apply': { color: '#38c3dc', icon: (size) => <Clock width={size} height={size} aria-hidden="true" /> },
  Applied: { color: '#34d399', icon: (size) => <Check width={size + 1} height={size + 1} aria-hidden="true" /> },
  'Needs Verification': { color: '#f87171', icon: (size) => <WarningTriangle width={size} height={size} aria-hidden="true" /> },
};

/**
 * Where the track's cues are in the save and apply process, as one icon-only
 * indicator at the left of the icon row. Each state has its own icon and color;
 * hovering names it.
 */
export function CueStateIcon({ state }: { state: CueDraftState }) {
  const { color, icon } = STATE_VISUALS[state];
  return (
    <span
      data-testid="cue-state-icon"
      data-label="State"
      role="img"
      aria-label={`Cue state: ${state}`}
      title={`Cue state: ${state}`}
      className="flex h-9 w-9 items-center justify-center"
      style={{ color }}
    >
      {icon(20)}
    </span>
  );
}

/**
 * Icon-only button that opens a small list of choices. The current choice is
 * marked in the list and named in the tooltip.
 */
export function IconOptionMenu<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  active = false,
  defaultOpen = false,
  keepOpen = false,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** Colors the icon (like a pressed toggle) when the setting is doing something. */
  active?: boolean;
  /** Starts with the list showing (Layout Lab). */
  defaultOpen?: boolean;
  /** The list ignores outside clicks and Escape, so it can be shown in Layout Lab. */
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      (listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? items?.[0])?.focus();
    }, 0);
    const onPointerDown = (event: PointerEvent) => {
      if (!keepOpen && ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !keepOpen) {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [keepOpen, open]);

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
    else next = index < 0 ? items.length - 1 : Math.max(0, index - 1);
    items[next]?.focus();
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="cue-action-icon"
        data-label={label}
        aria-label={`${label}: ${current}`}
        title={`${label}: ${current}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-pressed={active || open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={`${label} options`}
          onKeyDown={onListKeyDown}
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[120px] overflow-hidden dd-popup-surface"
        >
          <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none ${selected ? 'text-primary' : 'text-foreground'}`}
              >
                <span>{option.label}</span>
                {selected && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shared icon controls for the timeline's beat labels and grid visibility. */
export function TimelineGridControls({
  gridDisplayMode,
  onGridDisplayModeChange,
  gridVisible,
  onGridVisibleChange,
}: {
  gridDisplayMode: CueGridDisplayMode;
  onGridDisplayModeChange: (value: CueGridDisplayMode) => void;
  gridVisible: boolean;
  onGridVisibleChange: (visible: boolean) => void;
}) {
  return (
    <>
      <IconOptionMenu
        icon={<Ruler width={18} height={18} aria-hidden="true" />}
        label="Beat Count"
        value={gridDisplayMode}
        onChange={onGridDisplayModeChange}
        options={[
          { value: 'beats', label: 'Beats' },
          { value: 'bars', label: 'Bars' },
          { value: '4-bars', label: '4 Bars' },
          { value: '8-bars', label: '8 Bars' },
          { value: '16-bars', label: '16 Bars' },
        ]}
      />
      <button
        type="button"
        className="cue-action-icon"
        data-label="Grid"
        aria-label={gridVisible ? 'Hide grid' : 'Show grid'}
        title={gridVisible ? 'Hide grid' : 'Show grid'}
        aria-pressed={gridVisible}
        onClick={() => onGridVisibleChange(!gridVisible)}
      >
        <DotsGrid3x3 width={18} height={18} aria-hidden="true" />
      </button>
    </>
  );
}

/** The small slider popover that opens from the toolbar's volume button. */
export function VolumePopover({ volume, muted, silent, onToggleMute, onVolumeChange }: {
  volume: number;
  muted: boolean;
  silent: boolean;
  onToggleMute: () => void;
  onVolumeChange: (value: number) => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Playback volume"
      className="absolute right-0 top-full z-50 mt-1.5 flex items-center gap-2.5 dd-popup-surface px-3 py-2.5"
    >
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
      >
        {silent ? <SoundOff width={16} height={16} aria-hidden="true" /> : <SoundHigh width={16} height={16} aria-hidden="true" />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={muted ? 0 : volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        aria-label="Playback volume"
        className="h-1.5 w-32 cursor-pointer accent-primary"
      />
      <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round((muted ? 0 : volume) * 100)}%</span>
    </div>
  );
}

/**
 * Cue editor controls that sit in the track header's top-right, beside the other
 * icon-only buttons: Snap and Beat Count, the grid toggle, repeat, and a volume
 * button that opens a small slider popover.
 */
export function CueEditorToolbar({
  snapResolution,
  onSnapResolutionChange,
  gridDisplayMode,
  onGridDisplayModeChange,
  gridVisible,
  onGridVisibleChange,
}: {
  snapResolution: CueSnapResolution;
  onSnapResolutionChange: (v: CueSnapResolution) => void;
  gridDisplayMode: CueGridDisplayMode;
  onGridDisplayModeChange: (v: CueGridDisplayMode) => void;
  gridVisible: boolean;
  onGridVisibleChange: (v: boolean) => void;
}) {
  const { activeTrack, status, volume, muted, repeat, setVolume, toggleMute, toggleRepeat } = useAudioPlayer();
  const transportBlocked = status === 'resolving' || status === 'loading' || status === 'error';
  const silent = muted || volume === 0;

  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!volumeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (volumeRef.current && !volumeRef.current.contains(event.target as Node)) setVolumeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVolumeOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [volumeOpen]);

  return (
    <>
      <IconOptionMenu
        icon={<Magnet width={18} height={18} aria-hidden="true" />}
        label="Snap"
        value={snapResolution}
        active={snapResolution !== 'off'}
        onChange={onSnapResolutionChange}
        options={[
          { value: 'off', label: 'Off' },
          { value: '1-beat', label: '1 Beat' },
          { value: '2-beats', label: '2 Beats' },
          { value: '4-beats', label: '4 Beats' },
        ]}
      />
      <TimelineGridControls
        gridDisplayMode={gridDisplayMode}
        onGridDisplayModeChange={onGridDisplayModeChange}
        gridVisible={gridVisible}
        onGridVisibleChange={onGridVisibleChange}
      />
      <button
        type="button"
        className="cue-action-icon"
        data-label="Repeat"
        aria-label={repeat ? 'Disable repeat' : 'Repeat current track'}
        title={repeat ? 'Disable repeat' : 'Repeat current track'}
        aria-pressed={repeat}
        disabled={!activeTrack || transportBlocked}
        onClick={toggleRepeat}
      >
        <Repeat width={20} height={20} aria-hidden="true" />
      </button>
      <div ref={volumeRef} className="relative">
        <button
          type="button"
          className="cue-action-icon"
          data-label="Volume"
          aria-label="Volume"
          title="Volume"
          aria-haspopup="dialog"
          aria-expanded={volumeOpen}
          aria-pressed={volumeOpen}
          onClick={() => setVolumeOpen((open) => !open)}
        >
          {silent ? <SoundOff width={20} height={20} aria-hidden="true" /> : <SoundHigh width={20} height={20} aria-hidden="true" />}
        </button>
        {volumeOpen && (
          <VolumePopover volume={volume} muted={muted} silent={silent} onToggleMute={toggleMute} onVolumeChange={setVolume} />
        )}
      </div>
    </>
  );
}
