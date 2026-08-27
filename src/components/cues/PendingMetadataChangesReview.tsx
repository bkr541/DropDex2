import { CircleDash, WarningAlt } from '@carbon/icons-react';
import type { RekordboxTrack } from '../../types';
import type { TrackMetadataDraftRow } from '../../lib/queries/trackMetadataDrafts';
import type { DesktopMetadataApplyResult, DesktopMetadataPreflightResult } from '../../types/dropdex-desktop';
import { ControlButton } from '../ui/controls';
import { Dialog } from '../ui/feedback/Dialog';

export type PendingMetadataReviewLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface PendingMetadataReviewRow {
  draft: TrackMetadataDraftRow;
  track: Pick<RekordboxTrack, 'id' | 'title' | 'artist'>;
}

function currentGenreLabel(value: string | null): string {
  return value == null ? 'No Genre' : value;
}

function pendingGenreLabel(value: string | null): string {
  return value == null ? 'Clear Genre (No Genre)' : value;
}

export function PendingMetadataChangesReview({
  open,
  pendingCount,
  draftLoadStatus,
  draftLoadError,
  identityLoadStatus,
  identityLoadError,
  rows,
  discardingTrackIds,
  actionError,
  applyAvailable,
  applyAvailabilityReason,
  preflightBusy,
  preflightResult,
  applyResult,
  preflightMessage,
  onClose,
  onRetryDrafts,
  onRetryIdentities,
  onDiscard,
  onPreflightAll,
  onApplyAll,
}: {
  open: boolean;
  pendingCount: number;
  draftLoadStatus: PendingMetadataReviewLoadStatus;
  draftLoadError: string | null;
  identityLoadStatus: PendingMetadataReviewLoadStatus;
  identityLoadError: string | null;
  rows: PendingMetadataReviewRow[];
  discardingTrackIds: Set<string>;
  actionError: string | null;
  applyAvailable: boolean;
  applyAvailabilityReason: string | null;
  preflightBusy: boolean;
  preflightResult: DesktopMetadataPreflightResult | null;
  applyResult: DesktopMetadataApplyResult | null;
  preflightMessage: string | null;
  onClose: () => void;
  onRetryDrafts: () => void;
  onRetryIdentities: () => void;
  onDiscard: (draft: TrackMetadataDraftRow) => void;
  onPreflightAll: () => void;
  onApplyAll: () => void;
}) {
  const title = draftLoadStatus === 'loaded'
    ? `Pending Changes (${pendingCount})`
    : 'Pending Changes';

  return (
    <Dialog open={open} title={title} onClose={onClose} placement="right" closeOnBackdrop>
      <div className="flex min-h-0 flex-col gap-4" data-testid="pending-metadata-review">
        <div>
          <p className="text-[11px] font-semibold text-foreground">Metadata changes waiting for Rekordbox</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Review saved metadata drafts here. Cue drafts remain a separate Apply operation.
          </p>
        </div>

        {(draftLoadStatus === 'idle' || draftLoadStatus === 'loading') && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3 text-[11px] text-muted-foreground" role="status">
            <CircleDash className="animate-spin" size={15} />
            Loading pending metadata changes…
          </div>
        )}

        {draftLoadStatus === 'failed' && (
          <div className="rounded-lg border border-red-400/25 bg-red-400/[0.05] p-3 text-[11px] text-red-200" role="alert">
            <div className="flex items-start gap-2">
              <WarningAlt className="mt-0.5 shrink-0" size={15} />
              <p className="min-w-0 break-words">{draftLoadError ?? 'Pending metadata changes could not be loaded.'}</p>
            </div>
            <ControlButton variant="surface" className="mt-3" onClick={onRetryDrafts}>
              Retry pending changes
            </ControlButton>
          </div>
        )}

        {draftLoadStatus === 'loaded' && pendingCount === 0 && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-5 text-center">
            <p className="text-xs font-black text-foreground">No pending metadata changes</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Saved Genre edits will appear here until they are discarded or applied.</p>
          </div>
        )}

        {draftLoadStatus === 'loaded' && pendingCount > 0 && (identityLoadStatus === 'idle' || identityLoadStatus === 'loading') && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3 text-[11px] text-muted-foreground" role="status">
            <CircleDash className="animate-spin" size={15} />
            Loading track details for all pending changes…
          </div>
        )}

        {draftLoadStatus === 'loaded' && pendingCount > 0 && identityLoadStatus === 'failed' && (
          <div className="rounded-lg border border-red-400/25 bg-red-400/[0.05] p-3 text-[11px] text-red-200" role="alert">
            <div className="flex items-start gap-2">
              <WarningAlt className="mt-0.5 shrink-0" size={15} />
              <p className="min-w-0 break-words">{identityLoadError ?? 'Track details for pending changes could not be loaded.'}</p>
            </div>
            <ControlButton variant="surface" className="mt-3" onClick={onRetryIdentities}>
              Retry track details
            </ControlButton>
          </div>
        )}

        {actionError && (
          <div className="rounded-lg border border-red-400/25 bg-red-400/[0.05] p-3 text-[11px] text-red-200" role="alert">
            <p className="break-words">{actionError}</p>
            <ControlButton variant="surface" className="mt-3" onClick={onRetryDrafts}>
              Reload pending changes
            </ControlButton>
          </div>
        )}

        {draftLoadStatus === 'loaded' && pendingCount > 0 && identityLoadStatus === 'loaded' && (
          <div className="space-y-3" aria-label="Pending metadata changes list">
            {rows.map(({ draft, track }) => {
              const discarding = discardingTrackIds.has(draft.trackId);
              return (
                <article
                  key={draft.id}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/45 p-3"
                  data-testid="pending-metadata-row"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-xs font-black text-foreground [overflow-wrap:anywhere]">{track.title}</p>
                      {track.artist && <p className="mt-0.5 break-words text-[10px] text-muted-foreground [overflow-wrap:anywhere]">{track.artist}</p>}
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-2 py-1 text-[8px] font-black uppercase tracking-wide text-amber-200">
                      Genre
                    </span>
                  </div>

                  <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2" aria-label="Current to pending Genre change">
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2.5">
                      <p className="text-[8px] font-black uppercase tracking-[0.12em] text-muted-foreground">Current</p>
                      <p className="mt-1 break-words text-[11px] font-semibold text-foreground [overflow-wrap:anywhere]">{currentGenreLabel(draft.currentBaselineValue)}</p>
                    </div>
                    <div className="flex items-center text-sm font-black text-muted-foreground" aria-hidden="true">→</div>
                    <div className="min-w-0 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-2.5">
                      <p className="text-[8px] font-black uppercase tracking-[0.12em] text-amber-200">Pending</p>
                      <p className="mt-1 break-words text-[11px] font-semibold text-foreground [overflow-wrap:anywhere]">{pendingGenreLabel(draft.pendingValue)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <ControlButton
                      variant="ghost"
                      disabled={discarding}
                      onClick={() => onDiscard(draft)}
                      aria-label={`Discard pending Genre change for ${track.title}`}
                    >
                      {discarding ? 'Discarding…' : 'Discard'}
                    </ControlButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {preflightResult && (
          <div
            className={`rounded-lg border p-3 text-[11px] ${preflightResult.ok
              ? 'border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-100'
              : 'border-red-400/25 bg-red-400/[0.05] text-red-200'}`}
            role={preflightResult.ok ? 'status' : 'alert'}
            data-testid="metadata-preflight-result"
          >
            <p className="font-black">
              {preflightResult.ok
                ? `Preflight ready for ${preflightResult.tracks.length} metadata change${preflightResult.tracks.length === 1 ? '' : 's'}.`
                : 'Metadata preflight is blocked.'}
            </p>
            {preflightResult.blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {preflightResult.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}:${index}`} className="break-words">
                    <span className="font-black">{blocker.code}:</span> {blocker.message}
                  </li>
                ))}
              </ul>
            )}
            {preflightResult.ok && (
              <div className="mt-2 space-y-1 text-[10px]">
                {preflightResult.tracks.map((track) => (
                  <p key={track.draft_id} className="break-words">
                    {pendingGenreLabel(track.pending_value)}: {track.desired_resolution === 'reuse'
                      ? 'reuse existing Genre'
                      : track.desired_resolution === 'create'
                        ? 'create Genre during Stage 5 apply'
                        : 'clear Genre during Stage 5 apply'}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {applyResult && (
          <div
            className={`rounded-lg border p-3 text-[11px] ${applyResult.ok
              ? 'border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-100'
              : applyResult.state === 'recovery-unverified'
                ? 'border-amber-300/30 bg-amber-300/[0.06] text-amber-100'
                : 'border-red-400/25 bg-red-400/[0.05] text-red-200'}`}
            role={applyResult.ok ? 'status' : 'alert'}
            data-testid="metadata-apply-result"
          >
            <p className="font-black">
              {applyResult.state === 'applied'
                ? `Rekordbox Genre verified for ${applyResult.tracks.length} metadata change${applyResult.tracks.length === 1 ? '' : 's'}.`
                : applyResult.state === 'rolled-back'
                  ? 'Metadata apply failed after replacement; the prior Rekordbox generation was restored and verified.'
                  : applyResult.state === 'recovery-unverified'
                    ? 'Metadata apply recovery could not be verified. Do not retry until the Rekordbox database is inspected.'
                    : 'Metadata apply was rejected before a verified write completed.'}
            </p>
            {applyResult.blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {applyResult.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}:${index}`} className="break-words">
                    <span className="font-black">{blocker.code}:</span> {blocker.message}
                  </li>
                ))}
              </ul>
            )}
            {applyResult.ok && (
              <p className="mt-2 text-[10px] text-emerald-100/80">
                Local Rekordbox is verified. The pending DropDex draft remains until Stage 6 cloud finalization and canonical rebase.
              </p>
            )}
          </div>
        )}

        {preflightMessage && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3 text-[11px] text-muted-foreground" role="status">
            {preflightMessage}
          </div>
        )}

        <div className="border-t border-[var(--color-border-subtle)] pt-4">
          {preflightResult?.ok && preflightResult.token ? (
            <div className="space-y-2">
              <ControlButton
                variant="primary"
                className="w-full justify-center"
                disabled={preflightBusy || !applyAvailable || discardingTrackIds.size > 0}
                onClick={onApplyAll}
                title="Apply the exact preflight-bound Genre plan through staging, verification, atomic replacement, and rollback protection."
              >
                {preflightBusy ? 'Applying Metadata…' : `Apply All Metadata Changes (${preflightResult.tracks.length})`}
              </ControlButton>
              <ControlButton
                variant="surface"
                className="w-full justify-center"
                disabled={preflightBusy || !applyAvailable || discardingTrackIds.size > 0}
                onClick={onPreflightAll}
              >
                Run Preflight Again
              </ControlButton>
            </div>
          ) : (
            <ControlButton
              variant="primary"
              className="w-full justify-center"
              disabled={
                preflightBusy
                || !applyAvailable
                || draftLoadStatus !== 'loaded'
                || identityLoadStatus !== 'loaded'
                || pendingCount === 0
                || discardingTrackIds.size > 0
              }
              onClick={onPreflightAll}
              title={applyAvailable
                ? 'Run a read-only Rekordbox metadata preflight for the complete pending set.'
                : (applyAvailabilityReason ?? 'Metadata apply is unavailable in this desktop runtime.')}
            >
              {preflightBusy ? 'Checking Metadata…' : `Preflight Apply All Metadata Changes${draftLoadStatus === 'loaded' ? ` (${pendingCount})` : ''}`}
            </ControlButton>
          )}
          <p className="mt-2 text-center text-[9px] text-muted-foreground">
            Preflight is read-only. Apply writes only the bound Genre plan through the verified staging and rollback path; cue drafts remain separate.
          </p>
          {!applyAvailable && applyAvailabilityReason && (
            <p className="mt-1 break-words text-center text-[9px] text-red-300">{applyAvailabilityReason}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
