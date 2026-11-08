import type { ReactNode } from 'react';
import { Check, CheckCircle, Circle, Flash, Refresh, WarningTriangle, XmarkCircle } from 'iconoir-react/regular';
import '../dropdex-feedback.css';
import { StatusBadge } from './StatusBadge';
import type { SemanticTone } from './types';

export type AnalysisBadgeState = 'not-analyzed' | 'analyzing' | 'bpm' | 'waveform' | 'key' | 'complete' | 'failed' | 'partial' | 'reused';

const ANALYSIS_META: Record<AnalysisBadgeState, { label: string; tone: SemanticTone; icon: ReactNode }> = {
  'not-analyzed': { label: 'Not Analyzed', tone: 'neutral', icon: <Flash aria-hidden="true" width={9} height={9} /> },
  analyzing: { label: 'Analyzing', tone: 'active', icon: <Refresh aria-hidden="true" width={9} height={9} className="dd-spin" /> },
  bpm: { label: 'BPM Analyzed', tone: 'online', icon: <Circle aria-hidden="true" width={9} height={9} /> },
  waveform: { label: 'Waveform Ready', tone: 'purple', icon: <Flash aria-hidden="true" width={9} height={9} /> },
  key: { label: 'Key Analyzed', tone: 'amber', icon: <Check aria-hidden="true" width={9} height={9} /> },
  complete: { label: 'Fully Analyzed', tone: 'success', icon: <CheckCircle aria-hidden="true" width={9} height={9} /> },
  failed: { label: 'Analysis Failed', tone: 'error', icon: <XmarkCircle aria-hidden="true" width={9} height={9} /> },
  partial: { label: 'Analysis Partial', tone: 'warning', icon: <WarningTriangle aria-hidden="true" width={9} height={9} /> },
  reused: { label: 'Analysis Reused', tone: 'success', icon: <CheckCircle aria-hidden="true" width={9} height={9} /> },
};

export function AnalysisStatusBadge({ state, label, className }: { state: AnalysisBadgeState; label?: string; className?: string }) {
  const meta = ANALYSIS_META[state];
  return <StatusBadge tone={meta.tone} icon={meta.icon} className={className}>{label ?? meta.label}</StatusBadge>;
}
