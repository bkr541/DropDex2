import { CheckmarkFilled, CloudUpload, DataBase, Document, Search, Time, Usb, Waveform } from '@carbon/icons-react';
import type { ComponentType } from 'react';

export interface ProgressStep { id: string; label: string; Icon: ComponentType<{ size?: number; className?: string }> }

/** One thing DropDex shows progress for. */
export interface ProgressProcess {
  id: string;
  title: string;
  steps: readonly ProgressStep[];
  /** The headline for the current moment, e.g. "Analyzing track 52 of 83". */
  headline: (percent: number, stageIndex: number) => string;
  figures: (percent: number) => { label: string; value: string }[];
}

/** A process at one moment: which stage it is in and how far through that stage and the whole job. */
export interface ProgressModel {
  process: ProgressProcess;
  percent: number;
  stageIndex: number;
  /** 0 to 100 within the current stage. */
  stagePercent: number;
  done: boolean;
  headline: string;
  figures: { label: string; value: string }[];
}

const count = (percent: number, total: number) => Math.round((percent / 100) * total);

export const PROCESSES: readonly ProgressProcess[] = [
  {
    id: 'rekordbox',
    title: 'Rekordbox import',
    steps: [
      { id: 'source', label: 'Source', Icon: Usb },
      { id: 'database', label: 'Database', Icon: DataBase },
      { id: 'files', label: 'Analysis files', Icon: Document },
      { id: 'analyze', label: 'Analyze', Icon: Waveform },
      { id: 'complete', label: 'Complete', Icon: CheckmarkFilled },
    ],
    headline: (p, i) => (p >= 100 ? 'Book imported with analysis' : ['Reading your USB…', 'Saving your library…', 'Finding analysis files…', `Analyzing track ${count(p, 83)} of 83`][i]),
    figures: (p) => [{ label: 'Tracks', value: '83' }, { label: 'Analysed', value: String(count(p, 83)) }, { label: 'Parser', value: '3.0.0' }],
  },
  {
    id: 'sets',
    title: 'Artist sets',
    steps: [
      { id: 'queued', label: 'Queued', Icon: Time },
      { id: 'search', label: 'Searching', Icon: Search },
      { id: 'collect', label: 'Collecting', Icon: Document },
      { id: 'complete', label: 'Complete', Icon: CheckmarkFilled },
    ],
    headline: (p, i) => (p >= 100 ? 'Sets found' : ['Getting ready…', 'Searching for ILLENIUM’s sets…', `Collecting sets… ${count(p, 52)} found`][i]),
    figures: (p) => [{ label: 'Pages', value: String(Math.ceil((p / 100) * 6)) }, { label: 'Sets found', value: String(count(p, 52)) }, { label: 'Total listed', value: '52' }],
  },
  {
    id: 'cloud',
    title: 'Cloud sync',
    steps: [
      { id: 'prepare', label: 'Prepare', Icon: Document },
      { id: 'upload', label: 'Upload', Icon: CloudUpload },
      { id: 'complete', label: 'Complete', Icon: CheckmarkFilled },
    ],
    headline: (p, i) => (p >= 100 ? 'Your music is in the cloud' : ['Choosing previews…', `Uploading ${count(p, 120)} of 120`][i]),
    figures: (p) => [{ label: 'Synced', value: String(count(p, 120)) }, { label: 'Left', value: String(120 - count(p, 120)) }, { label: 'Failed', value: '0' }],
  },
];

/** Where a process is at a given overall percent: the last stage is "complete" and only shows at 100. */
export function progressModel(process: ProgressProcess, rawPercent: number): ProgressModel {
  const percent = Math.max(0, Math.min(100, rawPercent));
  const working = process.steps.length - 1;
  const done = percent >= 100;
  const stageIndex = done ? working : Math.min(working - 1, Math.floor((percent / 100) * working));
  const span = 100 / working;
  const stagePercent = done ? 100 : Math.round(((percent - stageIndex * span) / span) * 100);
  return { process, percent, stageIndex, stagePercent, done, headline: process.headline(percent, stageIndex), figures: process.figures(percent) };
}
