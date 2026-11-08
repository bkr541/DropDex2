import { RecordTrackListing } from '../../components/ui/display/RecordTrackListing';
import { useEffect, useId, useState } from 'react';
import { ArrowSeparate, NavArrowLeft, NavArrowRight } from 'iconoir-react/regular';
import { CheckboxControl, ControlButton, IconControlButton, SearchControl } from '../../components/ui/controls';
import { FilterDropdown } from '../../components/ui/controls/FilterDropdown';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import { fetchLibraryTracksPage, fetchTracksByIds, type PaginatedResult } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import type { SetLabDraft } from './session';
import {
  loadSetLabSwapContext, loadSimilarSetLabSwapIds, rankSetLabSwapCandidate, swapContextKey, swapUnavailableReason,
  type SetLabSwapContext,
} from './swapCandidates';

const PAGE_SIZE = 25;
type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; page: PaginatedResult<RekordboxTrack> };
type RankingState = { key: string; ids: string[] } | { key: string; error: string };

export function SetLabTrackTable({ tracks, draft, selectedId, onSelect, context, busy, onSwap }: {
  tracks: readonly RekordboxTrack[];
  draft: SetLabDraft;
  selectedId: string | null;
  onSelect: (track: RekordboxTrack) => void;
  context: SetLabSwapContext | null;
  busy: boolean;
  onSwap: (track: RekordboxTrack) => void;
}) {
  const helpId = useId();
  const target = draft.selectedSlot;
  const help = target == null
    ? 'Select a slot in a generated set to choose its swap target.'
    : `Swap target is slot ${target}. Audio and section length are checked when you choose Swap.`;
  return (
    <>
      <p id={helpId} className="border-b border-[var(--color-border-faint)] px-4 py-2 text-xs text-muted-foreground">{help}</p>
      <RecordTrackListing
        tracks={tracks} importId={draft.sourceImportId} selectedId={selectedId} onSelect={onSelect}
        actions={(track) => {
          const reason = swapUnavailableReason(draft, track) ?? (busy ? 'Another Set Lab change is in progress.' : null);
          const rank = context ? rankSetLabSwapCandidate(draft, context, track) : null;
          const compatibility = [...(rank?.reasons ?? []), ...(rank?.caution ? ['Use caution'] : [])].join(' · ');
          return (
            <div className="flex justify-end" title={reason ?? undefined}>
              <IconControlButton label={`Swap ${track.title}${target == null ? '' : ` into slot ${target}`}`}
                title={reason ?? (compatibility || 'Swap this track into the selected slot')} aria-describedby={helpId}
                disabled={!!reason} onKeyDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onSwap(track); }}>
                <ArrowSeparate width={16} height={16} aria-hidden="true" />
              </IconControlButton>
              {reason && target != null && <span className="sr-only">{reason}</span>}
            </div>
          );
        }}
        ariaLabel="Set Lab library tracks"
      />
    </>
  );
}

export function SetLabTrackBrowser({ draft, busy, onSwap, onSimilarOnly }: {
  draft: SetLabDraft;
  busy: boolean;
  onSwap: (track: RekordboxTrack, context: SetLabSwapContext | null) => void;
  onSimilarOnly: (checked: boolean) => void;
}) {
  const { sourceImportId, userId } = draft;
  const { stats } = useLibraryStats(sourceImportId);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const contextKey = swapContextKey(draft);
  const [contextResult, setContext] = useState<{ key: string; value?: SetLabSwapContext; error?: string } | null>(null);
  const currentContext = contextResult?.key === contextKey ? contextResult : null;
  const context = currentContext?.value ?? null;
  const similarOnly = draft.settings.similarOnly && contextKey != null;
  const query = search.trim();
  const rankingKey = similarOnly ? JSON.stringify([contextKey, query, genre, retry]) : null;
  const [ranking, setRanking] = useState<RankingState | null>(null);
  const currentRanking = ranking?.key === rankingKey ? ranking : null;
  const rankedIds = currentRanking && 'ids' in currentRanking ? currentRanking.ids : null;

  useEffect(() => {
    if (contextKey == null) return;
    const controller = new AbortController();
    const { signal } = controller;
    void loadSetLabSwapContext(draft, signal).then(
      (value) => { if (!signal.aborted) setContext({ key: contextKey, value }); },
      () => { if (!signal.aborted) setContext({ key: contextKey, error: 'Could not load the selected slot’s compatibility context.' }); },
    );
    return () => controller.abort();
    // The key captures account, import, selection and every track reference.
  }, [contextKey, retry]);

  useEffect(() => {
    if (similarOnly) { setPageIndex(0); setSelectedId(null); }
  }, [contextKey, similarOnly]);

  useEffect(() => {
    if (!rankingKey || !context) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      void loadSimilarSetLabSwapIds(draft, context, { search: query, genre }, signal).then(
        (ids) => { if (!signal.aborted) setRanking({ key: rankingKey, ids }); },
        (error: unknown) => {
          if (!signal.aborted) setRanking({ key: rankingKey, error: error instanceof Error ? error.message : 'Could not rank similar tracks.' });
        },
      );
    }, 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rankingKey, context]);

  const key = JSON.stringify([userId, sourceImportId, query, genre, pageIndex, retry, rankingKey]);
  const [loaded, setLoaded] = useState<{ key: string; state: PageState } | null>(null);
  const rankError = similarOnly && (currentContext?.error ?? (currentRanking && 'error' in currentRanking ? currentRanking.error : null));
  const state: PageState = rankError ? { status: 'error', message: rankError }
    : loaded?.key === key ? loaded.state : { status: 'loading' };

  useEffect(() => {
    if (similarOnly && !rankedIds) return;
    const controller = new AbortController();
    const { signal } = controller;
    const offset = pageIndex * PAGE_SIZE;
    const timer = setTimeout(() => {
      void (async () => {
        let page: PaginatedResult<RekordboxTrack>;
        if (rankedIds) {
          const ids = rankedIds.slice(offset, offset + PAGE_SIZE);
          const items = ids.length ? await fetchTracksByIds(ids, signal) : [];
          if (items.length !== ids.length) throw new Error('The library changed while reading ranked tracks. Retry the list.');
          page = { items, offset, limit: PAGE_SIZE, total: rankedIds.length, hasMore: offset + PAGE_SIZE < rankedIds.length };
        } else {
          page = await fetchLibraryTracksPage(sourceImportId, offset, PAGE_SIZE, { search: query, genre }, signal);
        }
        signal.throwIfAborted();
        if (page.offset !== offset || page.items.some((track) => track.import_id !== sourceImportId)) {
          throw new Error('The library returned an unexpected page. Retry loading tracks.');
        }
        const lastPage = Math.max(0, Math.ceil(page.total / PAGE_SIZE) - 1);
        if (pageIndex > lastPage) setPageIndex(lastPage);
        else setLoaded({ key, state: { status: 'ready', page } });
      })().catch((error: unknown) => {
        if (!signal.aborted) setLoaded({ key, state: { status: 'error', message: error instanceof Error ? error.message : 'Could not load library tracks.' } });
      });
    }, rankedIds ? 0 : 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, rankedIds, similarOnly, pageIndex, sourceImportId, query, genre]);

  return (
    <section aria-label="Set Lab track browser" className="min-w-0 rounded-xl border border-[var(--color-border-subtle)]">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div className="min-w-[12rem] flex-1">
          <SearchControl aria-label="Search library tracks" placeholder="Search library tracks…" value={search}
            onChange={(event) => { setSearch(event.target.value); setPageIndex(0); setSelectedId(null); }} />
        </div>
        <FilterDropdown label="Genre" value={genre} searchable
          onChange={(value) => { setGenre(value); setPageIndex(0); setSelectedId(null); }}
          options={[{ label: 'All', value: '' }, ...(stats?.genreTotals ?? []).map(({ name }) => ({ label: name, value: name }))]} />
        <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground"
          title={contextKey ? 'Show Similar Vibes matches ranked against adjacent slots' : 'Select a slot to enable Similar Only'}>
          <CheckboxControl checked={similarOnly} disabled={!contextKey} aria-label="Similar Only" onChange={onSimilarOnly} />
          <span>Similar Only</span>
        </div>
      </div>
      {context?.partial && <p className="px-4 py-2 text-xs text-muted-foreground">Some Rekordbox matches could not load. Tempo and key matches are still available.</p>}
      {state.status === 'loading' ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">{similarOnly ? 'Ranking similar tracks…' : 'Loading library tracks…'}</p>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <p>{state.message}</p>
          <ControlButton variant="neutral" onClick={() => setRetry((value) => value + 1)}>Retry tracks</ControlButton>
        </div>
      ) : state.page.items.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          {similarOnly ? 'No similar tracks match these filters. Turn off Similar Only to browse the library.' : 'No tracks match these filters.'}
        </p>
      ) : (
        <>
          <SetLabTrackTable tracks={state.page.items} draft={draft} selectedId={selectedId} context={context} busy={busy}
            onSelect={(track) => setSelectedId(track.id)} onSwap={(track) => onSwap(track, context)} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-faint)] px-4 py-2">
            <p role="status" className="text-xs text-muted-foreground">
              {state.page.offset + 1}–{state.page.offset + state.page.items.length} of {state.page.total.toLocaleString()} tracks
            </p>
            <div className="flex items-center gap-1">
              <IconControlButton label="Previous track page" disabled={pageIndex === 0}
                onClick={() => setPageIndex((value) => value - 1)}><NavArrowLeft width={17} height={17} aria-hidden="true" /></IconControlButton>
              <IconControlButton label="Next track page" disabled={!state.page.hasMore}
                onClick={() => setPageIndex((value) => value + 1)}><NavArrowRight width={17} height={17} aria-hidden="true" /></IconControlButton>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
