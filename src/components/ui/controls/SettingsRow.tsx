import { ChevronDown, Settings } from '@carbon/icons-react';
import '../dropdex-controls.css';
import { IconControlButton } from './IconControlButton';

export function SettingsRow() {
  return (
    <div className="dd-settings-row" role="group" aria-label="Track display settings">
      {['BPM', 'KEY', 'GRID'].map((label) => (
        <button type="button" key={label} className="dd-settings-row__button">
          <span>{label}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      ))}
      <IconControlButton label="Open settings" tone="blue" className="dd-settings-row__settings">
        <Settings size={19} />
      </IconControlButton>
    </div>
  );
}
