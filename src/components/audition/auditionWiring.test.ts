import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const appSource = read('../../App.tsx');
const developerTabSource = read('../profile/DeveloperTab.tsx');
const cuePointsSource = read('../cues/CuePointsView.tsx');
const auditionDir = new URL('./', import.meta.url);
const auditionFiles = readdirSync(auditionDir).filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'));

describe('Audition is its own page', () => {
  it('the Audition route renders AuditionView, not the Cue Points screen', () => {
    expect(appSource).toContain("import('./components/audition/AuditionView')");
    expect(appSource).toContain("currentView === 'audition' && (");
    expect(appSource).toContain('<AuditionView importId={importId}');
    expect(appSource).not.toContain("mode={currentView === 'audition'");
    expect(appSource).toContain('mode="cues"');
  });

  it('no Audition file depends on the Cue Points screen', () => {
    expect(auditionFiles.length).toBeGreaterThan(5);
    for (const file of auditionFiles) {
      const source = readFileSync(new URL(file, auditionDir), 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/cues\//);
    }
  });

  it('uses no sample data from the design mockup', () => {
    for (const file of auditionFiles) {
      const source = readFileSync(new URL(file, auditionDir), 'utf8');
      expect(source, file).not.toMatch(/ILLENIUM|Afterlife|Melodic Bass|Echos/i);
    }
  });

  it('keeps the Keep / Maybe / Remove buttons switched off and does not store decisions yet', () => {
    const header = read('./AuditionDecisions.tsx');
    expect(header).toContain('disabled');
    expect(header).not.toContain('onClick={() => onDecide');
    for (const file of auditionFiles) {
      expect(readFileSync(new URL(file, auditionDir), 'utf8'), file).not.toMatch(/\.from\('[a-z_]*decision/);
    }
  });
});

describe('Audition shares its section names with Cue Points', () => {
  it('both screens take section naming and positioning from the one shared module', () => {
    expect(cuePointsSource).toContain("from '../../lib/music/phraseSections'");
    expect(cuePointsSource).not.toContain('function sectionDisplayLabel');
    expect(cuePointsSource).not.toContain('function sectionTone');
    expect(read('./AuditionView.tsx')).toContain("from '../../lib/music/phraseSections'");
  });
});

describe('Audition logging', () => {
  it('writes its failures to the in-app Logger under the audition prefix and shows them in Developer', () => {
    expect(read('./useAuditionTrackAnalysis.ts')).toContain("'audition.sections.load_failed'");
    expect(read('./AuditionView.tsx')).toContain("'audition.library.load_failed'");
    expect(read('./AuditionTransport.tsx')).toContain("'audition.playback.failed'");
    expect(developerTabSource).toContain("message.startsWith('audition.')");
  });
});
