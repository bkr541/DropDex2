/** The production waveform palette shared by listening and cue editing. */
export function waveformSectionInk(label: string): string {
  return /drop|chorus/i.test(label) ? '#F78361' : '#8997AE';
}
