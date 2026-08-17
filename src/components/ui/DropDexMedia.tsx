import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import './dropdex-media.css';
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from '@carbon/icons-react';

export type TransportButtonTone = 'neutral' | 'play' | 'stop' | 'mute';
export type TransportButtonSize = 'compact' | 'standard' | 'hero';

export interface TransportButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  tone?: TransportButtonTone;
  size?: TransportButtonSize;
  active?: boolean;
  children: ReactNode;
}

export function TransportButton({
  label,
  tone = 'neutral',
  size = 'standard',
  active = false,
  className,
  type = 'button',
  children,
  ...props
}: TransportButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'dd-media-button',
        `dd-media-button--${tone}`,
        `dd-media-button--${size}`,
        className,
      )}
      {...props}
    >
      <span className="dd-media-button__bezel" aria-hidden="true" />
      <span className="dd-media-button__content">{children}</span>
    </button>
  );
}

export interface MediaTransportControlGroupProps {
  playing: boolean;
  onTogglePlay: () => void;
  onPrevious?: () => void;
  onRewind?: () => void;
  onForward?: () => void;
  onNext?: () => void;
  disabled?: boolean;
  compact?: boolean;
  ariaLabel?: string;
}

export function MediaTransportControlGroup({
  playing,
  onTogglePlay,
  onPrevious,
  onRewind,
  onForward,
  onNext,
  disabled = false,
  compact = false,
  ariaLabel = 'Media transport controls',
}: MediaTransportControlGroupProps) {
  const size = compact ? 'compact' : 'standard';
  const iconSize = compact ? 14 : 18;
  return (
    <div className={cn('dd-media-transport-group', compact && 'dd-media-transport-group--compact')} role="group" aria-label={ariaLabel}>
      <TransportButton label="Previous track" size={size} disabled={disabled} onClick={onPrevious}>
        <SkipBack size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton label="Rewind" size={size} disabled={disabled} onClick={onRewind}>
        <SkipBack size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton
        label={playing ? 'Pause' : 'Play'}
        tone="play"
        size={compact ? 'standard' : 'hero'}
        active={playing}
        disabled={disabled}
        onClick={onTogglePlay}
      >
        {playing ? <Pause size={compact ? 17 : 22} fill="currentColor" /> : <Play size={compact ? 17 : 22} fill="currentColor" />}
      </TransportButton>
      <TransportButton label="Fast forward" size={size} disabled={disabled} onClick={onForward}>
        <SkipForward size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton label="Next track" size={size} disabled={disabled} onClick={onNext}>
        <SkipForward size={iconSize} fill="currentColor" />
      </TransportButton>
    </div>
  );
}

export interface SelectableOptionItem {
  value: string;
  label: string;
  meta?: string;
}

export interface SelectableOptionRowProps {
  label: string;
  value: string;
  items: SelectableOptionItem[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function SelectableOptionRow({
  label,
  value,
  items,
  onChange,
  ariaLabel = label,
}: SelectableOptionRowProps) {
  const id = useId();
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = items[selectedIndex] ?? items[0];

  const commit = (index: number) => {
    const item = items[index];
    if (!item) return;
    onChange(item.value);
    setActiveIndex(index);
    setOpen(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const base = open ? activeIndex : selectedIndex;
      const next = (base + delta + items.length) % items.length;
      setActiveIndex(next);
      setOpen(true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) commit(activeIndex);
      else {
        setActiveIndex(selectedIndex);
        setOpen(true);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      setOpen(true);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(items.length - 1);
      setOpen(true);
    }
  };

  return (
    <div className="dd-media-listbox">
      <button
        type="button"
        className="dd-media-listbox__trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && items[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dd-media-listbox__label">{label}</span>
        <span className="dd-media-listbox__selection">
          {selected?.meta && <small>{selected.meta}</small>}
          <strong>{selected?.label ?? '—'}</strong>
          <ChevronDown size={15} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={`${id}-listbox`} role="listbox" aria-label={`${ariaLabel} options`} className="dd-media-listbox__options">
          {items.map((item, index) => (
            <button
              type="button"
              id={`${id}-option-${index}`}
              key={item.value}
              role="option"
              aria-selected={item.value === value}
              data-active={index === activeIndex ? 'true' : 'false'}
              className="dd-media-listbox__option"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              <span>{item.label}</span>
              {item.meta && <small>{item.meta}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
