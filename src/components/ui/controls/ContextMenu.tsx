import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  /** Small right-aligned hint, e.g. a shortcut or the side it affects. */
  hint?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

const EDGE_GAP = 8;

/**
 * A right-click menu in the Cue Points menu style. It opens at the pointer, stays
 * inside the window, closes on Escape or any outside click, and works with the arrow keys.
 */
export function ContextMenu({
  x, y, items, ariaLabel, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  ariaLabel: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - rect.width - EDGE_GAP)),
      top: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - rect.height - EDGE_GAP)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    enabled[(current + step + enabled.length) % enabled.length].focus();
  }

  return (
    <div
      className="fixed inset-0 z-[80]"
      onPointerDown={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className="fixed min-w-[190px] overflow-hidden rounded-lg border border-[#34414b] bg-[#11181e] p-1.5 shadow-2xl"
        style={position}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-xs font-semibold text-[#e5e9ed] hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40${index > 0 ? ' mt-0.5' : ''}`}
            onClick={() => { onClose(); item.onSelect(); }}
          >
            <span>{item.label}</span>
            {item.hint ? <span className="font-mono text-[10px] text-[#8e99a4]">{item.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
