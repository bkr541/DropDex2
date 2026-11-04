import { PaintBrush } from '@carbon/icons-react';
import { PAGE_NAME_TAB_SHADOW } from './FloatingSidebar';

/** Opens Layout Lab. It floats in the bottom right of the app, outside the left nav. */
export function FloatingLayoutLabButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Layout Lab in a new window"
      title="Layout Lab (opens in a new window)"
      data-testid="floating-layout-lab"
      className="glass logo-gradient-border fixed bottom-6 right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:flex"
      style={{ boxShadow: PAGE_NAME_TAB_SHADOW }}
    >
      <PaintBrush size={20} />
    </button>
  );
}
