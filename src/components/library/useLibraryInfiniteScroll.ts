import { useEffect, useState } from 'react';

/** Request one page per observation. Loading state re-arms the observer for the next page. */
export function useLibraryInfiniteScroll(loadNextPage: (() => Promise<void>) | null) {
  const [end, endRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!end || !loadNextPage) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (requested || !entry?.isIntersecting || entry.intersectionRatio < 0.1) return;
      requested = true;
      observer.disconnect();
      void loadNextPage();
    }, { threshold: 0.1 });

    observer.observe(end);
    return () => {
      requested = true;
      observer.disconnect();
    };
  }, [end, loadNextPage]);

  return endRef;
}
