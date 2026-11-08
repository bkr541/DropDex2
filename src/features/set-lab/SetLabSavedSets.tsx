import { useEffect, useId, useState } from 'react';
import { ControlButton } from '../../components/ui/controls';
import { fetchSetLabSavedSets, type SetLabSavedSetSummary } from './sessionRepository';

type Listing = { key: string } & (
  { sets: SetLabSavedSetSummary[]; hasMore: boolean } | { error: string }
);

export function SetLabSavedSets({ userId, sourceImportId, refresh, disabled, onLoad }: {
  userId: string;
  sourceImportId: string;
  refresh: number;
  disabled: boolean;
  onLoad: (id: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Listing | null>(null);
  const key = JSON.stringify([userId, refresh, page, attempt]);
  const listing = result?.key === key ? result : null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    void fetchSetLabSavedSets(userId, page, signal).then(
      (value) => { if (!signal.aborted) setResult({ key, ...value }); },
      (error: unknown) => {
        if (!signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Could not list saved sets.' });
      },
    );
    return () => controller.abort();
  }, [key, open, page, userId]);

  return (
    <div className="min-w-0">
      <ControlButton variant="neutral" aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={() => {
          if (!open) { setPage(0); setAttempt((value) => value + 1); }
          setOpen(!open);
        }}>Saved Sets</ControlButton>
      {open && (
        <section id={listId} aria-label="Saved Set Lab sets"
          className="mt-2 max-w-lg rounded-lg border border-[var(--color-border-subtle)] p-2">
          {!listing ? <p role="status" className="p-2 text-xs text-muted-foreground">Loading saved sets…</p>
            : 'error' in listing ? (
              <div className="space-y-2 p-2 text-xs">
                <p role="alert">{listing.error}</p>
                <ControlButton variant="neutral" onClick={() => setAttempt((value) => value + 1)}>Retry saved sets</ControlButton>
              </div>
            ) : (
              <>
                {listing.sets.length === 0 && <p className="p-2 text-xs text-muted-foreground">
                  {page === 0 ? 'No named sets yet. Save a complete set to reopen it here.' : 'No saved sets on this page.'}
                </p>}
                <ul className="divide-y divide-[var(--color-border-faint)]">
                  {listing.sets.map(({ id, name, sourceImportId: importId, updatedAt }) => (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="break-words text-xs font-bold">{name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(updatedAt).toLocaleString()} · {importId === sourceImportId ? 'This import' : 'Another import'}
                        </p>
                      </div>
                      <ControlButton variant="neutral" disabled={disabled} aria-label={`Load ${name}`}
                        onClick={() => onLoad(id)}>Load Set</ControlButton>
                    </li>
                  ))}
                </ul>
                {(page > 0 || listing.hasMore) && <div className="flex justify-between gap-2 p-2">
                  <ControlButton variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</ControlButton>
                  <ControlButton variant="ghost" disabled={!listing.hasMore} onClick={() => setPage(page + 1)}>Next</ControlButton>
                </div>}
              </>
            )}
        </section>
      )}
    </div>
  );
}
