import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Close, Search } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';

export interface FilterDropdownOption {
  value: string;
  label: string;
}

/**
 * Labeled dropdown with an underline, as used by the Cue Points browser filters.
 * When the first option is "All", a small clear button appears once another
 * option is chosen.
 */
export function FilterDropdown({
  label,
  value,
  onChange,
  options,
  searchable = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? value;

  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const focusTimer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
      else {
        const selected = listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
        const first = listboxRef.current?.querySelector<HTMLElement>('[role="option"]');
        (selected ?? first)?.focus();
      }
    }, 0);
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndRestoreFocus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeAndRestoreFocus, open, searchable]);

  function handleListboxKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const optionElements = [...(listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (optionElements.length === 0) return;
    event.preventDefault();
    const currentIndex = optionElements.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = optionElements.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : Math.min(optionElements.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? optionElements.length - 1 : Math.max(0, currentIndex - 1);
    optionElements[nextIndex]?.focus();
  }

  const isFiltered = options.length > 0 && options[0].label.toLowerCase() === 'all' && value !== options[0].value;

  return (
    <div ref={ref} className={cn('relative min-w-[130px]', className)}>
      <div className="pb-2 border-b border-white/15 hover:border-white/35 transition-colors">
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</p>
        <div className="flex items-center gap-1">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="text-sm text-foreground truncate">{selectedLabel}</span>
          </button>
          {isFiltered && (
            <button
              type="button"
              aria-label={`Clear ${label} filter`}
              onClick={() => { onChange(options[0].value); closeAndRestoreFocus(); }}
              className="shrink-0 text-red-400 hover:text-red-300 transition-colors focus-visible:outline-none"
            >
              <Close size={12} />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground focus-visible:outline-none"
          >
            <ChevronDown
              size={14}
              className={cn('transition-transform duration-200', open && 'rotate-180')}
            />
          </button>
        </div>
      </div>
      {open && (
        <div
          ref={listboxRef}
          role="listbox"
          aria-label={`${label} filter options`}
          onKeyDown={handleListboxKeyDown}
          className="absolute top-full left-0 mt-1.5 z-50 min-w-full overflow-y-auto overscroll-contain rounded-md border border-[var(--color-control-border)] bg-[var(--color-control-surface)] shadow-[0_12px_28px_rgba(0,0,0,0.32)] max-h-[320px]"
        >
          {searchable && (
            <div className="dd-control-wrap sticky top-0 p-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-card)]">
              <Search size={16} className="dd-control-start-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label={`Search ${label} filter options`}
                className="dd-text-control dd-text-control--with-start-icon"
                style={{ minHeight: 34, fontSize: 13 }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results</p>
          ) : filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              onClick={() => { onChange(opt.value); closeAndRestoreFocus(); }}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.06]',
                value === opt.value ? 'text-foreground' : 'font-medium text-muted-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
