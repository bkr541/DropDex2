import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FloppyDisk, Refresh, Xmark } from 'iconoir-react/regular';
import { TextControl } from '../ui/controls';

export function genreEditorPosition(rect: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
  popup: { width: number; height: number }, viewport: { width: number; height: number }) {
  const left = Math.max(12, Math.min(rect.left, viewport.width - popup.width - 12));
  const below = rect.bottom + 6;
  const top = below + popup.height <= viewport.height - 12 ? below : Math.max(12, rect.top - popup.height - 6);
  return { left, top };
}

/** The editor lives outside the table, so neither its width nor its errors resize any column. */
export function GenreEditPopover({ anchor, onClose, children }: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    function update() {
      if (!anchor.isConnected) { onClose(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = surface.current?.offsetWidth ?? 260;
      const height = surface.current?.offsetHeight ?? 56;
      const next = genreEditorPosition(rect, { width, height }, { width: window.innerWidth, height: window.innerHeight });
      setPosition((previous) => previous.left === next.left && previous.top === next.top ? previous : next);
    }
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !surface.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    if (surface.current) observer.observe(surface.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [anchor, onClose, children]);

  return createPortal(
    <GenreEditSurface surfaceRef={surface}
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
      {children}
    </GenreEditSurface>, document.body,
  );
}

/** The surface of the genre editor, without the positioning, so Layout Lab shows the same popover the Cue Points screen opens. */
export function GenreEditSurface({ children, surfaceRef, ...rest }: React.HTMLAttributes<HTMLDivElement> & { surfaceRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={surfaceRef} className="cue-studio cue-genre-popover" role="dialog" aria-label="Edit genre" {...rest}>
      {children}
    </div>
  );
}

/** What sits inside the genre popover: the genre field, save and cancel, and the save error. */
export function GenreEditorContent({ title, value, maxLength, dirty, saving, available, error, onChange, onSave, onCancel, onReload }: {
  title: string;
  value: string;
  maxLength?: number;
  dirty: boolean;
  saving: boolean;
  available: boolean;
  error: { message: string; revisionConflict?: boolean } | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  return (
    <div className="space-y-1.5" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <TextControl
            type="text"
            autoFocus
            maxLength={maxLength}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              } else if (event.key === 'Enter' && !event.repeat && dirty && !saving && available) {
                event.preventDefault();
                onSave();
              }
            }}
            disabled={saving || !available}
            aria-label={`Genre for ${title}`}
            className="cue-genre-input disabled:opacity-60"
            placeholder="Genre…"
          />
        </div>
        {dirty && (
          <button
            type="button"
            className="shrink-0 text-primary hover:text-primary/80 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title="Save pending Genre change"
            aria-label={`Save pending Genre change for ${title}`}
            disabled={saving || !available}
            onClick={(event) => { event.stopPropagation(); onSave(); }}
          >
            {saving ? <Refresh className="animate-spin" width={13} height={13} aria-hidden="true" /> : <FloppyDisk width={13} height={13} aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          title="Cancel genre edit"
          aria-label={`Cancel genre edit for ${title}`}
          disabled={saving}
          onClick={(event) => { event.stopPropagation(); onCancel(); }}
        >
          <Xmark width={13} height={13} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-red-300" role="alert">
          <span>{error.message}</span>
          {error.revisionConflict && (
            <button
              type="button"
              className="shrink-0 font-bold text-red-200 underline underline-offset-2 hover:text-red-100"
              onClick={(event) => { event.stopPropagation(); onReload(); }}
            >
              Reload pending Genre
            </button>
          )}
        </div>
      )}
    </div>
  );
}
