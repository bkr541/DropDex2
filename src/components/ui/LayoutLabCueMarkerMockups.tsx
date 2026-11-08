import { useState, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { WaveformSectionRow } from './media/WaveformSectionRow';
import { CueFlag, CUE_FLAG_PALETTE } from './media/WaveformCueMarker';
import './layout-lab-cue-markers.css';

interface MarkerLook {
  id: string;
  title: string;
  description: string;
  rounded?: boolean;
  fine?: boolean;
  production?: boolean;
}

const LOOKS: readonly MarkerLook[] = [
  { id: 'outline-flag', title: 'Outline Flag', description: 'Straight sides, a full-width downward point, and a 2px outline.' },
  { id: 'filled-flag', title: 'Filled Flag', description: 'A muted cue-tinted face with a clear, light letter.' },
  { id: 'fine-flag', title: 'Fine Outline', description: 'A lighter 1px outline around a cue-tinted flag.', fine: true },
  { id: 'wide-flag', title: 'Wide Flag', description: 'A broader face gives the letter more breathing room.' },
  { id: 'tall-flag', title: 'Tall Flag', description: 'A narrow, taller flag with the same centered point.' },
  { id: 'short-point', title: 'Short Point', description: 'A rectangular face with a shallower bottom point.' },
  { id: 'rounded-flag', title: 'Rounded Flag', description: 'A shield with rounded shoulders and a curved base.', rounded: true },
  { id: 'filled-rounded', title: 'Filled Rounded', description: 'A softly tinted rounded flag with a light cue letter.', rounded: true },
  { id: 'fine-rounded', title: 'Fine Rounded', description: 'An open rounded flag with a lighter outline.', rounded: true, fine: true },
  { id: 'graphite-flag', title: 'Graphite Flag', description: 'A graphite face, quiet rim, and a thin cue-colored top edge.',
    production: true },
  { id: 'graphite-point', title: 'Graphite Point', description: 'A rounded graphite flag with a light letter and a cue-colored line at the base.', rounded: true,
    production: true },
  { id: 'graphite-header', title: 'Graphite Header', description: 'A broader graphite flag with a short cue-colored header rule.',
    production: true },
];

const CUES = [
  { id: 'a', label: 'A', number: 1, percent: 5, color: CUE_FLAG_PALETTE.A, memory: false },
  { id: 'b', label: 'B', number: 2, percent: 18, color: CUE_FLAG_PALETTE.B, memory: false },
  { id: 'm1', label: 'M1', number: 1, percent: 30, color: CUE_FLAG_PALETTE['1'], memory: true },
  { id: 'c', label: 'C', number: 3, percent: 47, color: CUE_FLAG_PALETTE.C, memory: false },
  { id: 'd', label: 'D', number: 4, percent: 67, color: CUE_FLAG_PALETTE.D, memory: false },
  { id: 'm2', label: 'M2', number: 2, percent: 86, color: CUE_FLAG_PALETTE['2'], memory: true },
];

const SECTIONS = [
  { id: 'intro', label: 'Intro', color: '#8997AE', leftPercent: 0, widthPercent: 6 },
  { id: 'build', label: 'Build', color: '#8997AE', leftPercent: 6, widthPercent: 25 },
  { id: 'verse', label: 'Verse', color: '#8997AE', leftPercent: 31, widthPercent: 35 },
  { id: 'drop', label: 'Drop', color: '#b18b80', leftPercent: 66, widthPercent: 26 },
];

const WAVEFORM_SECTIONS = SECTIONS.map((section) => ({
  startFraction: section.leftPercent / 100,
  endFraction: (section.leftPercent + section.widthPercent) / 100,
  color: section.color,
}));

const COLUMNS = Array.from({ length: 160 }, (_, index) => ({
  h: Math.round(6 + Math.abs(Math.sin(index * .23)) * 16 + Math.abs(Math.sin(index * .071)) * 8),
  i: 3,
}));

const WAVEFORM: WaveformLoadState = {
  status: 'loaded',
  trackId: 'cue-marker-sample',
  waveform: {
    trackId: 'cue-marker-sample', previewFormat: 'mono', previewColumnCount: COLUMNS.length,
    previewColumns: COLUMNS, previewColumnsValid: true, inferredFormat: 'mono',
    validationError: null, invalidReason: null, detailFormat: null, detailColumnCount: null,
    detailStorageBucket: null, detailStoragePath: null,
  },
};

const PRODUCTION_COLUMNS = Array.from({ length: 600 }, (_, index) => {
  const envelope = index < 24 ? index / 24 : index > 560 ? Math.max(.08, (600 - index) / 40) : 1;
  const beat = index % 16 < 4 ? 12 : 5;
  const detail = (index * 37 % 29) / 29 * 10;
  return { h: Math.round((9 + beat + detail) * envelope), i: 3 };
});

const PRODUCTION_WAVEFORM: WaveformLoadState = {
  ...WAVEFORM,
  waveform: { ...WAVEFORM.waveform, previewColumnCount: PRODUCTION_COLUMNS.length, previewColumns: PRODUCTION_COLUMNS },
};

function clock(percent: number) {
  const seconds = Math.round(percent * 1.5);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function MarkerStudy({ look, number }: { look: MarkerLook; number: number }) {
  const cues = CUES;
  const [selectedId, setSelectedId] = useState('b');
  const selected = cues.find((cue) => cue.id === selectedId)!;

  const ruler = (
    <div className="cml-ruler" aria-hidden="true">
      <span>0:00</span><span>0:30</span><span>1:00</span><span>1:30</span><span>2:00</span><span>2:30</span>
    </div>
  );

  return (
    <article className={cn(`cml-study cml-style-${look.id}`, look.production && 'cml-production')} aria-labelledby={`cue-study-${look.id}`}>
      <header className="cml-study-heading">
        <span className="cml-number">{String(number).padStart(2, '0')}</span>
        <div>
          <h2 id={`cue-study-${look.id}`}>{look.title}</h2>
          <p>{look.description}</p>
        </div>
      </header>
      <div className="cml-stage waveform-section-frame">
        <div className="cml-cues" role="group" aria-label={`${look.title} cue markers`}>
          {cues.map((cue) => (
            <button
              type="button"
              key={cue.id}
              className={cn('cml-marker', cue.memory && 'cml-memory')}
              style={{ left: `${cue.percent}%`, '--waveform-cue-ink': cue.color } as CSSProperties}
              aria-label={`${cue.memory ? 'Memory cue' : 'Hot cue'} ${cue.label} at ${clock(cue.percent)}`}
              aria-pressed={selectedId === cue.id}
              title={`${cue.label} · ${clock(cue.percent)}`}
              onClick={() => setSelectedId(cue.id)}
            >
              <CueFlag label={cue.memory ? cue.label.slice(1) : cue.label} rounded={look.rounded} fine={look.fine} />
            </button>
          ))}
        </div>
        <WaveformSectionRow sections={SECTIONS} />
        {look.production && ruler}
        <RekordboxPreviewWaveform
          state={look.production ? PRODUCTION_WAVEFORM : WAVEFORM}
          height={look.production ? 72 : 46}
          variant={look.production ? 'detail' : 'compact'}
          appearance={look.production ? 'rekordbox' : 'dropdex'}
          renderMode={look.production ? 'area' : 'bars'}
          colorSegments={look.production ? WAVEFORM_SECTIONS : undefined}
          tint={look.production ? undefined : '#8997AE'}
          showCenterLine={false}
          surface={false}
          ariaLabel={`Sample waveform for ${look.title}`}
        />
        {look.production ? <div className="cml-beat-ticks" aria-hidden="true" /> : ruler}
      </div>
      <footer className="cml-study-footer" role="status">
        <span>Selected <strong>{selected.label}</strong> · {clock(selected.percent)}</span>
        <span>Click a marker to select</span>
      </footer>
    </article>
  );
}

export function CueMarkerMockupsContent() {
  return (
    <div className="cml-lab">
      <header className="cml-intro">
        <span className="cml-eyebrow">Layout Lab / Cue Markers</span>
        <h1>Cue Markers</h1>
        <p>Twelve cue treatments using Iconoir's label and shield. Compare proportions, outline weight, and color on a waveform. Letters mark hot cues and numbers mark memory cues. Studies 10–12 use the production waveform’s graphite surface and give every marker its own color.</p>
      </header>
      <div className="cml-grid">
        {LOOKS.map((look, index) => <MarkerStudy key={look.id} look={look} number={index + 1} />)}
      </div>
    </div>
  );
}
