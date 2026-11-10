import { Palette } from 'iconoir-react/regular';
import { setWaveformStyle, useWaveformStyleId } from '../../lib/preferences/displayPreferences';
import { WAVEFORM_STYLES } from '../../lib/preferences/waveformStyles';
import { SelectableOptionCard } from '../ui/feedback';

/** Personalization: how information is shown to you. For now, the colour of the waveform in the track timeline. */
export function DisplayPreferencesGroup() {
  const selected = useWaveformStyleId();
  return (
    <section className="profile-group" data-testid="display-preferences-group">
      <h2 className="profile-heading"><Palette width={11} height={11} aria-hidden="true" />Display</h2>
      <p className="text-sm font-bold">Choose your waveform style</p>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Based on the waveforms DJ software uses. It changes every track timeline, and is saved on this computer.</p>
      <div className="profile-choice-grid" role="radiogroup" aria-label="Waveform style">
        {WAVEFORM_STYLES.map((style) => (
          <SelectableOptionCard
            key={style.id}
            selected={selected === style.id}
            title={style.label}
            description={style.description}
            hero={<span aria-hidden="true" data-testid={`waveform-swatch-${style.id}`} />}
            heroBackground={style.swatch}
            horizontal
            onSelect={() => setWaveformStyle(style.id)}
          />
        ))}
      </div>
    </section>
  );
}
