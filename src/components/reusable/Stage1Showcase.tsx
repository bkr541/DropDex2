import { useState, type ReactNode } from 'react';
import { UsbConnectionButton } from '../usb/UsbConnectionButton';
import {
  ActionRow,
  AutocompleteControl,
  BreadcrumbControl,
  ChipMultiSelect,
  ClearableTextInput,
  ControlButton,
  FormField,
  IconControlButton,
  NumberControl,
  RangeControl,
  SearchControl,
  SegmentedControl,
  SelectControl,
  SettingsRow,
  TextareaControl,
  TextControl,
  UrlControl,
} from '../ui/controls';
import './stage1-showcase.css';
import { Book, Bookmark, Close, Download, Favorite, Grid, Information, Launch, Music, OverflowMenuHorizontal, Play, Search, Settings, Star, TrashCan, Upload, Waveform } from '@carbon/icons-react';

function StageCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <article className={`dd-stage1-card ${className ?? ''}`} data-stage1-card={label}>
      <h3>{label}</h3>
      <div className="dd-stage1-card__content">{children}</div>
    </article>
  );
}

const comboOptions = [
  'Deep House',
  'Deep Tech',
  'Deep Minimal',
  'Deep Progressive',
  'Deep Liquid',
].map((label) => ({ value: label.toLowerCase().replace(/\s+/g, '-'), label }));

export function Stage1Showcase() {
  const [actionView, setActionView] = useState('grid');
  const [breadcrumbs, setBreadcrumbs] = useState(['Collection', 'Playlists', 'Tech House']);
  const [deck, setDeck] = useState('deck1');
  const [mode, setMode] = useState('abs');
  const [text, setText] = useState('Midnight Roller');
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('Electronic');
  const [combo, setCombo] = useState('Deep');
  const [chips, setChips] = useState(['Tech House', 'Melodic Techno', 'Minimal', 'Deep House']);
  const [bpm, setBpm] = useState<number | ''>(128);
  const [range, setRange] = useState(128);

  return (
    <div className="dd-stage1-board" data-testid="stage1-component-board">
      <div className="dd-stage1-grid dd-stage1-grid--top">
        <StageCard label="Primary Button" className="dd-stage1-top-tall">
          <ControlButton variant="primary"><Play size={17} fill="currentColor" /> PLAY</ControlButton>
          <ControlButton><Download size={18} /> LOAD TO DECK</ControlButton>
          <ControlButton><Waveform size={19} className="dd-blue-icon" /> ANALYZE TRACK <span className="dd-button-end">⌄</span></ControlButton>
        </StageCard>

        <StageCard label="Secondary Button" className="dd-stage1-top-tall">
          <ControlButton variant="secondary" accent="blue">SYNC</ControlButton>
          <ControlButton variant="secondary" accent="orange">CUE</ControlButton>
          <ControlButton variant="secondary" accent="purple">QUANTIZE</ControlButton>
        </StageCard>

        <StageCard label="Danger / Ghost Button" className="dd-stage1-top-tall">
          <ControlButton variant="danger"><TrashCan size={17} /> DELETE</ControlButton>
          <ControlButton variant="danger-outline"><Close size={17} /> REMOVE</ControlButton>
          <ControlButton variant="ghost">CLEAR HISTORY</ControlButton>
        </StageCard>

        <StageCard label="Icon Button" className="dd-stage1-top-tall">
          <div className="dd-icon-grid">
            <IconControlButton label="Favorite" tone="red"><Favorite size={21} fill="currentColor" /></IconControlButton>
            <IconControlButton label="Bookmark" tone="blue" className="dd-icon-neutral"><Bookmark size={21} /></IconControlButton>
            <IconControlButton label="Star" tone="orange" className="dd-icon-neutral"><Star size={22} /></IconControlButton>
            <IconControlButton label="Download" tone="blue"><Download size={21} /></IconControlButton>
            <IconControlButton label="Upload" tone="green"><Upload size={21} /></IconControlButton>
            <IconControlButton label="Share" tone="purple"><Launch size={20} /></IconControlButton>
            <IconControlButton label="Information" tone="blue"><Information size={21} fill="currentColor" /></IconControlButton>
            <IconControlButton label="Settings" tone="blue" className="dd-icon-neutral"><Settings size={21} /></IconControlButton>
            <IconControlButton label="More actions" tone="blue" className="dd-icon-neutral"><OverflowMenuHorizontal size={22} /></IconControlButton>
          </div>
        </StageCard>

        <StageCard label="Action Row Button" className="dd-stage1-span-2 dd-stage1-top-action">
          <ActionRow
            value={actionView}
            onChange={setActionView}
            items={[
              { id: 'grid', label: 'GRID', icon: <Grid /> },
              { id: 'waveform', label: 'WAVEFORM', icon: <Waveform /> },
              { id: 'library', label: 'LIBRARY', icon: <Book /> },
              { id: 'playlists', label: 'PLAYLISTS', icon: <Music /> },
              { id: 'search', label: 'SEARCH', icon: <Search /> },
            ]}
          />
        </StageCard>

        <StageCard label="Disabled Button" className="dd-stage1-span-2 dd-stage1-top-disabled">
          <div className="dd-disabled-row">
            <ControlButton disabled><Play size={17} fill="currentColor" /> PLAY</ControlButton>
            <ControlButton disabled>SYNC</ControlButton>
            <ControlButton disabled><Download size={17} /> LOAD</ControlButton>
          </div>
        </StageCard>
      </div>

      <div className="dd-stage1-grid dd-stage1-grid--actions">
        <StageCard label="Back Button / Breadcrumb" className="dd-stage1-span-2">
          <BreadcrumbControl items={breadcrumbs} onBack={() => setBreadcrumbs((items) => items.length > 1 ? items.slice(0, -1) : items)} />
        </StageCard>

        <StageCard label="USB Connection Button">
          <div className="dd-stage1-usb-wrap"><UsbConnectionButton /></div>
        </StageCard>

        <StageCard label="Segmented / Toggle Row" className="dd-stage1-span-2">
          <div className="dd-segment-stack">
            <SegmentedControl
              ariaLabel="Deck selection"
              value={deck}
              onChange={setDeck}
              options={['deck1', 'deck2', 'deck3', 'deck4'].map((value, index) => ({ value, label: `DECK ${index + 1}` }))}
            />
            <SegmentedControl
              ariaLabel="Playback mode"
              tone="green"
              value={mode}
              onChange={setMode}
              options={['abs', 'rel', 'int', 'thru'].map((value) => ({ value, label: value.toUpperCase() }))}
            />
          </div>
        </StageCard>

        <StageCard label="Settings Row" className="dd-stage1-span-2">
          <SettingsRow />
        </StageCard>
      </div>

      <div className="dd-stage1-grid dd-stage1-grid--inputs">
        <StageCard label="Text Input">
          <ClearableTextInput aria-label="Track title" value={text} onValueChange={setText} />
        </StageCard>
        <StageCard label="Search Input">
          <SearchControl aria-label="Search tracks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tracks, artists, albums..." />
        </StageCard>
        <StageCard label="Textarea">
          <TextareaControl aria-label="Track notes" rows={3} defaultValue="Set the energy high, build the transition, and drop at the perfect moment." />
        </StageCard>
        <StageCard label="URL Input">
          <UrlControl aria-label="Track URL" defaultValue="https://rekordbox.com/track/12345" />
        </StageCard>
        <StageCard label="Select / Dropdown">
          <SelectControl aria-label="Genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
            {['Electronic', 'Tech House', 'Deep House', 'Melodic Techno'].map((option) => <option key={option}>{option}</option>)}
          </SelectControl>
        </StageCard>
      </div>

      <div className="dd-stage1-grid dd-stage1-grid--lower">
        <StageCard label="Searchable Combobox / Autocomplete" className="dd-lower-combo dd-stage1-combo-card">
          <AutocompleteControl ariaLabel="Search genres" options={comboOptions} value={combo} onChange={setCombo} />
        </StageCard>

        <StageCard label="Multi-Select / Removable Chips" className="dd-lower-chips">
          <ChipMultiSelect values={chips} onChange={setChips} />
        </StageCard>

        <StageCard label="Number Input" className="dd-lower-number">
          <NumberControl value={bpm} onChange={setBpm} min={0} max={300} />
        </StageCard>

        <StageCard label="Range Slider" className="dd-lower-range">
          <RangeControl value={range} onChange={setRange} min={0} max={200} label="BPM range" />
        </StageCard>

        <StageCard label="Form Field With Helper Text" className="dd-lower-helper">
          <FormField label="Key" helperText="Harmonic key for seamless mixing.">
            {({ id, describedBy }) => (
              <SelectControl id={id} aria-describedby={describedBy} defaultValue="8A - Camelot">
                <option>8A - Camelot</option><option>8B - Camelot</option><option>9A - Camelot</option>
              </SelectControl>
            )}
          </FormField>
        </StageCard>

        <StageCard label="Required Field Indicator" className="dd-lower-required">
          <FormField label="Artist" required>
            {({ id }) => <TextControl id={id} required defaultValue="Oliver Schories" />}
          </FormField>
        </StageCard>

        <StageCard label="Inline Field Error" className="dd-lower-error">
          <FormField label="BPM" error="Please enter a valid number.">
            {({ id, describedBy, invalid }) => <TextControl id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="abc" />}
          </FormField>
        </StageCard>

        <StageCard label="Accent Palette" className="dd-lower-palette">
          <div className="dd-accent-palette" aria-label="Accent palette">
            {['blue', 'cyan', 'teal', 'indigo', 'purple', 'magenta', 'red', 'orange', 'yellow', 'lime'].map((tone) => (
              <span key={tone} className={`dd-accent-dot dd-accent-dot--${tone}`} title={tone} />
            ))}
          </div>
          <div className="dd-state-guide" aria-label="State guide">
            {[
              ['Default', 'default'], ['Hover', 'hover'], ['Active', 'active'], ['Focus', 'focus'],
              ['Disabled', 'disabled'], ['Error', 'error'], ['Success', 'success'],
            ].map(([label, tone]) => (
              <span key={label} className="dd-state-guide__item"><i className={`dd-state-dot dd-state-dot--${tone}`} />{label}</span>
            ))}
          </div>
        </StageCard>

        <StageCard label="Form Field With Label" className="dd-lower-label">
          <FormField label="Track Name" helperText="The name of the track as it will appear in your library.">
            {({ id, describedBy }) => <TextControl id={id} aria-describedby={describedBy} defaultValue="Night Drive" />}
          </FormField>
        </StageCard>
      </div>
    </div>
  );
}
