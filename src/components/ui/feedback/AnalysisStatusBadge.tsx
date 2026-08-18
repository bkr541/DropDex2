import type { ReactNode } from 'react';
import { Checkmark, CheckmarkFilled, CircleDash, CircleFilled, CloseFilled, Flash, WarningAlt } from '@carbon/icons-react';
import '../dropdex-feedback.css';
import { StatusBadge } from './StatusBadge';
import type { SemanticTone } from './types';

export type AnalysisBadgeState = 'not-analyzed' | 'analyzing' | 'bpm' | 'waveform' | 'key' | 'complete' | 'failed' | 'partial' | 'reused';

const ANALYSIS_META: Record<AnalysisBadgeState, { label: string; tone: SemanticTone; icon: ReactNode }> = {
  'not-analyzed': { label: 'Not Analyzed', tone: 'neutral', icon: <Flash size={9} /> },
  analyzing: { label: 'Analyzing', tone: 'active', icon: <CircleDash size={9} className="dd-spin" /> },
  bpm: { label: 'BPM Analyzed', tone: 'online', icon: <CircleFilled size={9} /> },
  waveform: { label: 'Waveform Ready', tone: 'purple', icon: <Flash size={9} /> },
  key: { label: 'Key Analyzed', tone: 'amber', icon: <Checkmark size={9} /> },
  complete: { label: 'Fully Analyzed', tone: 'success', icon: <CheckmarkFilled size={9} /> },
  failed: { label: 'Analysis Failed', tone: 'error', icon: <CloseFilled size={9} /> },
  partial: { label: 'Analysis Partial', tone: 'warning', icon: <WarningAlt size={9} /> },
  reused: { label: 'Analysis Reused', tone: 'success', icon: <CheckmarkFilled size={9} /> },
};

export function AnalysisStatusBadge({ state, label, className }: { state: AnalysisBadgeState; label?: string; className?: string }) {
  const meta = ANALYSIS_META[state];
  return <StatusBadge tone={meta.tone} icon={meta.icon} className={className}>{label ?? meta.label}</StatusBadge>;
}
