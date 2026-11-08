import { NavArrowDown, Settings } from 'iconoir-react/regular';
import '../dropdex-controls.css';
import { IconControlButton } from './IconControlButton';

export function SettingsRow() {
  return (
    <div className="dd-settings-row" role="group" aria-label="Track display settings">
      {['BPM', 'KEY', 'GRID'].map((label) => (
        <button type="button" key={label} className="dd-settings-row__button">
          <span>{label}</span>
          <NavArrowDown width={15} height={15} aria-hidden="true" />
        </button>
      ))}
      <IconControlButton label="Open settings" tone="blue" className="dd-settings-row__settings">
        <Settings aria-hidden="true" width={19} height={19} />
      </IconControlButton>
    </div>
  );
}
