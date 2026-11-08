import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
    <div ref={surface} className="cue-studio cue-genre-popover" role="dialog" aria-label="Edit genre"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
      {children}
    </div>, document.body,
  );
}
