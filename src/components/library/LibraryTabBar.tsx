import type { ElementType } from 'react';
import { cn } from '../../lib/utils';

export interface LibraryTabBarItem<T extends string = string> {
  id: T;
  label: string;
  /** Shown to the left of the label. */
  icon?: ElementType;
  disabled?: boolean;
}

/** The underlined tab row from the artist Library page. Review uses the same one. */
export function LibraryTabBar<T extends string>({
  tabs, activeTab, onChange, ariaLabel = 'Library sections',
}: {
  tabs: ReadonlyArray<LibraryTabBarItem<T>>;
  activeTab: T;
  onChange: (tab: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="lib-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          disabled={tab.disabled}
          onClick={() => { if (!tab.disabled) onChange(tab.id); }}
          className="lib-tab"
        >
          {tab.icon && <tab.icon size={16} className="shrink-0" aria-hidden="true" />}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
