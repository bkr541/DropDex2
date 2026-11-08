/** Standard slate everywhere; Audition alone opts into drop/chorus highlighting. */
export function waveformSectionInk(label: string, highlightDrops = false): string {
  return highlightDrops && /drop|chorus/i.test(label) ? '#F78361' : '#8997AE';
}
