import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

export interface PageHeading {
  title: string;
  onBack: (() => void) | null;
  /** Extra page details shown under the title (e.g. playlist stats and actions). */
  details?: ReactNode;
}

// Small grace period so the pointer can cross the gap between the logo and the
// flyout without it snapping shut.
const CLOSE_DELAY_MS = 180;

/**
 * Wraps the sidebar logo. Hovering (or focusing) it slides the current page's
 * back button and title out from the sidebar's edge; leaving slides it back in.
 */
export function LogoTitleFlyout({ heading, children }: { heading: PageHeading | null; children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const show = useCallback(() => {
    cancelClose();
    const anchor = anchorRef.current;
    if (!anchor) return;
    const logoRect = anchor.getBoundingClientRect();
    const sidebarRight = anchor.closest('aside')?.getBoundingClientRect().right ?? logoRect.right;
    setPosition({ left: sidebarRight + 8, top: logoRect.top + logoRect.height / 2 });
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  useEffect(() => () => cancelClose(), []);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
  };

  const offscreenX = reduceMotion ? 0 : -28;

  return (
    <div
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={handleBlur}
      className="relative flex items-center"
    >
      {children}
      <AnimatePresence>
        {open && heading && position && (
          <motion.div
            data-testid="page-title-flyout"
            role="navigation"
            aria-label={`${heading.title} page`}
            onMouseEnter={show}
            onMouseLeave={hide}
            initial={{ opacity: 0, x: offscreenX, y: '-50%' }}
            animate={{ opacity: 1, x: 0, y: '-50%' }}
            exit={{ opacity: 0, x: offscreenX, y: '-50%' }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 60 }}
            className="flex max-w-[min(560px,calc(100vw-120px))] flex-col gap-1.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] px-2 py-2 shadow-[0_12px_32px_rgb(0_0_0_/_0.45)]"
          >
            <div className="flex min-w-0 items-center gap-2 pr-2">
              {heading.onBack && (
                <ControlButton variant="ghost" onClick={heading.onBack} aria-label="Go back">
                  <ChevronLeft size={20} />
                </ControlButton>
              )}
              <h2 className={`truncate text-2xl font-black italic ${heading.onBack ? '' : 'pl-2'}`}>{heading.title}</h2>
            </div>
            {heading.details && <div className="px-2 pb-0.5">{heading.details}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
