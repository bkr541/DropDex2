import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditPencil, Maximize, Minus, Plus, Xmark } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { PopoverMockupsContent } from './LayoutLabPopoverMockups';
import { ReusableMockupsContent } from './LayoutLabReusableMockups';

// ── Types ────────────────────────────────────────────────────────────────────

interface Position { x: number; y: number }
interface Size { width: number; height: number }
interface Tab { id: string; label: string }

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragRef  { mouseX: number; mouseY: number; winX: number; winY: number }
interface ResizeRef { mouseX: number; mouseY: number; startX: number; startY: number; startW: number; startH: number; edge: ResizeEdge }

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const TITLE_BAR_HEIGHT = 44;
const TAB_BAR_HEIGHT = 36;

const DEFAULT_TABS: Tab[] = [
  { id: 'scratch-pad',   label: 'Scratch Pad'   },
  { id: 'icons', label: 'Icons' },
  { id: 'popover', label: 'Popover' },
  { id: 'reusable', label: 'Reusable UI Components' },
];

let tabCounter = 0;
function newTabId() { return `tab-${++tabCounter}`; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullscreenState(): { pos: Position; size: Size } {
  return { pos: { x: 0, y: 0 }, size: { width: window.innerWidth, height: window.innerHeight } };
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: Tab[];
  activeId: string;
  editingId: string | null;
  editingValue: string;
  onSelect(id: string): void;
  onAddTab(): void;
  onEditChange(value: string): void;
  onEditCommit(): void;
  onEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void;
  editInputRef: React.RefObject<HTMLInputElement | null>;
}

function TabBar({
  tabs, activeId, editingId, editingValue,
  onSelect, onAddTab, onEditChange, onEditCommit, onEditKeyDown, editInputRef,
}: TabBarProps) {
  return (
    <div
      className="flex items-end gap-0 px-3 shrink-0 border-b border-[var(--color-border-subtle)] overflow-x-auto"
      style={{ height: TAB_BAR_HEIGHT, background: 'var(--color-surface)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isEditing = tab.id === editingId;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'relative flex items-center h-[28px] px-3 rounded-t-lg text-[11px] font-semibold tracking-wide transition-all shrink-0 border-x border-t',
              isActive
                ? 'bg-[var(--color-panel)] border-[var(--color-border-subtle)] text-foreground -mb-px z-10'
                : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)]',
            )}
          >
            {isEditing ? (
              <span className="relative block">
                <EditPencil width={11} height={11} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={editInputRef}
                  value={editingValue}
                  onChange={(e) => onEditChange(e.target.value)}
                  onBlur={onEditCommit}
                  onKeyDown={onEditKeyDown}
                  className="w-24 bg-transparent pl-4 text-[11px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
                  placeholder="Tab name…"
                />
              </span>
            ) : (
              tab.label
            )}
          </button>
        );
      })}

      <button
        onClick={onAddTab}
        aria-label="New tab"
        className="flex items-center justify-center w-7 h-7 mb-0.5 ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
      >
        <Plus width={14} height={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Blank canvas ──────────────────────────────────────────────────────────────

function BlankCanvas() {
  return (
    <>
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.3 }}>
        <defs>
          <pattern id="ll-dot-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="currentColor" className="text-muted-foreground" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ll-dot-grid)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground/40">
          Blank canvas
        </p>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface LayoutLabWindowProps {
  onClose(): void;
  /** Fill a dedicated browser window: no dragging, resizing, minimizing or window chrome. */
  standalone?: boolean;
}

export function LayoutLabWindow({ onClose, standalone = false }: LayoutLabWindowProps) {
  const [{ pos, size }, setState] = useState(fullscreenState);
  const [minimized, setMinimized] = useState(false);

  const [tabs, setTabs] = useState<Tab[]>(DEFAULT_TABS);
  const [activeId, setActiveId] = useState(DEFAULT_TABS[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const dragRef   = useRef<DragRef | null>(null);
  const resizeRef = useRef<ResizeRef | null>(null);

  // ── Viewport resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      setState((prev) => ({
        size: prev.size,
        pos: {
          x: Math.max(0, Math.min(prev.pos.x, window.innerWidth  - prev.size.width)),
          y: Math.max(0, Math.min(prev.pos.y, window.innerHeight - prev.size.height)),
        },
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Drag & resize ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.mouseX;
        const dy = e.clientY - dragRef.current.mouseY;
        setState((prev) => ({
          size: prev.size,
          pos: {
            x: Math.max(0, Math.min(dragRef.current!.winX + dx, window.innerWidth  - prev.size.width)),
            y: Math.max(0, Math.min(dragRef.current!.winY + dy, window.innerHeight - prev.size.height)),
          },
        }));
        return;
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        const dx = e.clientX - r.mouseX;
        const dy = e.clientY - r.mouseY;
        setState((prev) => {
          let { x, y } = prev.pos;
          let w = r.startW;
          let h = r.startH;
          if (r.edge.includes('e')) w = Math.max(MIN_WIDTH,  r.startW + dx);
          if (r.edge.includes('s')) h = Math.max(MIN_HEIGHT, r.startH + dy);
          if (r.edge.includes('w')) { const p = Math.max(MIN_WIDTH,  r.startW - dx); x = r.startX + (r.startW - p); w = p; }
          if (r.edge.includes('n')) { const p = Math.max(MIN_HEIGHT, r.startH - dy); y = r.startY + (r.startH - p); h = p; }
          w = Math.min(w, window.innerWidth  - Math.max(0, x));
          h = Math.min(h, window.innerHeight - Math.max(0, y));
          return { pos: { x: Math.max(0, x), y: Math.max(0, y) }, size: { width: w, height: h } };
        });
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',  onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',  onMouseUp);
    };
  }, []);

  const onTitleBarMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    dragRef.current = { mouseX: e.clientX, mouseY: e.clientY, winX: pos.x, winY: pos.y };
  }, [pos]);

  const onResizeHandleMouseDown = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    resizeRef.current = { mouseX: e.clientX, mouseY: e.clientY, startX: pos.x, startY: pos.y, startW: size.width, startH: size.height, edge };
  }, [pos, size]);

  const restoreFullscreen = useCallback(() => { setState(fullscreenState()); setMinimized(false); }, []);

  // ── Tab management ────────────────────────────────────────────────────────
  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const label = editingValue.trim();
    setTabs((prev) =>
      label
        ? prev.map((t) => t.id === editingId ? { ...t, label } : t)
        : prev.filter((t) => t.id !== editingId),
    );
    if (!label) {
      setActiveId((prev) => prev === editingId ? (tabs[tabs.length - 2]?.id ?? tabs[0]?.id ?? '') : prev);
    }
    setEditingId(null);
    setEditingValue('');
  }, [editingId, editingValue, tabs]);

  const onEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') {
      setTabs((prev) => prev.filter((t) => t.id !== editingId));
      setActiveId((prev) => prev === editingId ? (tabs[tabs.length - 2]?.id ?? '') : prev);
      setEditingId(null);
      setEditingValue('');
    }
  }, [commitEdit, editingId, tabs]);

  const addTab = useCallback(() => {
    const id = newTabId();
    setTabs((prev) => [...prev, { id, label: '' }]);
    setActiveId(id);
    setEditingId(id);
    setEditingValue('');
    requestAnimationFrame(() => editInputRef.current?.focus());
  }, []);

  const canvasHeight = size.height - TITLE_BAR_HEIGHT - TAB_BAR_HEIGHT;

  return (
    <div
      className={cn(
        'fixed z-[9999] flex flex-col overflow-hidden',
        standalone ? 'inset-0' : 'rounded-2xl border border-[var(--color-border-subtle)] shadow-2xl',
      )}
      style={standalone
        ? { background: 'var(--color-panel)' }
        : {
          left: pos.x, top: pos.y,
          width: size.width,
          height: minimized ? TITLE_BAR_HEIGHT : size.height,
          background: 'var(--color-panel)',
        }}
    >
      {/* Resize handles */}
      {!minimized && !standalone && (
        <>
          <div onMouseDown={onResizeHandleMouseDown('n')}  className="absolute top-0 left-3 right-3 h-1 cursor-ns-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('s')}  className="absolute bottom-0 left-3 right-3 h-1 cursor-ns-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('e')}  className="absolute right-0 top-3 bottom-3 w-1 cursor-ew-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('w')}  className="absolute left-0  top-3 bottom-3 w-1 cursor-ew-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('ne')} className="absolute top-0 right-0  w-3 h-3 cursor-nesw-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('nw')} className="absolute top-0 left-0   w-3 h-3 cursor-nwse-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('se')} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('sw')} className="absolute bottom-0 left-0  w-3 h-3 cursor-nesw-resize z-20" />
        </>
      )}

      {/* Title bar */}
      <div
        className={cn('flex items-center px-4 shrink-0 border-b border-[var(--color-border-subtle)] select-none', !standalone && 'cursor-grab active:cursor-grabbing')}
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--color-surface)' }}
        onMouseDown={standalone ? undefined : onTitleBarMouseDown}
      >
        <div className="flex items-center gap-1.5 mr-3">
          <button onClick={onClose} aria-label="Close Layout Lab"
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group">
            <Xmark width={8} height={8} aria-hidden="true" className="opacity-0 group-hover:opacity-100 text-red-900" />
          </button>
          {!standalone && (
            <>
          <button onClick={() => setMinimized((v) => !v)} aria-label={minimized ? 'Restore' : 'Minimize'}
            className="w-3 h-3 rounded-full bg-amber-400 hover:bg-amber-300 transition-colors flex items-center justify-center group">
            <Minus width={8} height={8} aria-hidden="true" className="opacity-0 group-hover:opacity-100 text-amber-900" />
          </button>
          <button onClick={restoreFullscreen} aria-label="Full screen"
            className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-400 transition-colors flex items-center justify-center group">
            <Maximize width={8} height={8} aria-hidden="true" className="opacity-0 group-hover:opacity-100 text-emerald-900" />
          </button>
            </>
          )}
        </div>
        <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground flex-1 text-center pr-16">
          Layout Lab
        </span>
      </div>

      {/* Tab bar */}
      {!minimized && (
        <TabBar
          tabs={tabs}
          activeId={activeId}
          editingId={editingId}
          editingValue={editingValue}
          onSelect={setActiveId}
          onAddTab={addTab}
          onEditChange={setEditingValue}
          onEditCommit={commitEdit}
          onEditKeyDown={onEditKeyDown}
          editInputRef={editInputRef}
        />
      )}

      {/* Canvas */}
      {!minimized && (
        <div className="relative flex-1 overflow-hidden" style={{ height: canvasHeight }}>
          {activeId === 'popover' ? <PopoverMockupsContent /> : activeId === 'reusable' ? <ReusableMockupsContent /> : <BlankCanvas />}
        </div>
      )}
    </div>
  );
}
