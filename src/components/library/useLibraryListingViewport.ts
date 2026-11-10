import { useEffect, useState } from 'react';

/** Match the Tracks tab's scroll height below the filters and waveform. */
export function useLibraryListingViewport() {
  const [listing, listingRef] = useState<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  useEffect(() => {
    if (!listing) return;
    const measure = () => {
      if (listing.offsetWidth === 0) return;
      setMaxHeight(Math.max(280, Math.floor(window.innerHeight - listing.getBoundingClientRect().top - 16)));
    };
    measure();
    window.addEventListener('resize', measure);

    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(listing);
    const panel = listing.closest('.artist-library-studio, .cue-studio');
    if (panel) observer.observe(panel);

    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [listing]);

  return { listingRef, maxHeight };
}
