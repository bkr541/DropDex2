import { useState } from 'react';
import { ControlButton } from './controls/ControlButton';
import { NoticeCard, type NoticeTone } from './feedback/NoticeCard';
import { ToastNotification, type ToastTone } from './feedback/ToastNotification';
import './layout-lab-notice-card.css';
import './layout-lab-notice-component.css';

interface Study {
  id: string;
  name: string;
  description: string;
  message: string;
}

interface CardStudy extends Study {
  kind: 'card';
  tone: NoticeTone;
  eyebrow?: string;
  title?: string;
  action?: string;
}

interface ToastStudy extends Study {
  kind: 'toast';
  tone: ToastTone;
  title: string;
  meta: string;
}

const GROUPS: { title: string; studies: readonly (CardStudy | ToastStudy)[] }[] = [
  {
    title: 'Inline notice cards',
    studies: [
      {
        kind: 'card', id: 'raised-plate', name: 'Raised Plate',
        description: 'The current graphite card with a lit rim, tinted edge, and recessed icon.',
        tone: 'success', eyebrow: 'Rekordbox', title: 'Library imported',
        message: 'Your tracks and playlists are ready.',
      },
      {
        kind: 'card', id: 'top-rail', name: 'Top Rail',
        description: 'A slim accent across the top flags an interruption in a panel.',
        tone: 'warning', eyebrow: 'Playback', title: 'USB disconnected',
        message: 'Reconnect the drive to resume playback.',
      },
      {
        kind: 'card', id: 'action-footer', name: 'Action Footer',
        description: 'A hairline separates the message from a dedicated recovery action.',
        tone: 'error', eyebrow: 'Analysis', title: 'Analysis paused',
        message: 'The last batch could not be processed.', action: 'Retry analysis',
      },
      {
        kind: 'card', id: 'inline-strip', name: 'Inline Strip',
        description: 'A flat, one-line notice for a quiet update within a list.',
        tone: 'neutral', message: 'Playlist order updated.',
      },
      {
        kind: 'card', id: 'centered-callout', name: 'Centered Callout',
        description: 'A centered icon and action give a workspace prerequisite more room.',
        tone: 'info', eyebrow: 'USB Management', title: 'Connect a drive',
        message: 'Choose a USB drive to view its library.', action: 'Choose USB',
      },
    ],
  },
  {
    title: 'Toast notifications',
    studies: [
      {
        kind: 'toast', id: 'compact-toast', name: 'Compact Toast',
        description: 'The current toast layout with a tinted outline and timestamp.',
        tone: 'success', title: 'Import complete', message: '24 tracks added.', meta: 'Now',
      },
      {
        kind: 'toast', id: 'floating-plate', name: 'Floating Plate',
        description: 'A raised graphite face and recessed icon lift the toast above the workspace.',
        tone: 'info', title: 'Set draft saved', message: 'Open it again from Set Lab.', meta: 'Now',
      },
      {
        kind: 'toast', id: 'status-rail', name: 'Status Rail',
        description: 'A bottom accent carries the warning color across a matte surface.',
        tone: 'warning', title: 'USB storage low', message: 'Free up space before exporting.', meta: 'USB',
      },
      {
        kind: 'toast', id: 'stacked-toast', name: 'Stacked Toast',
        description: 'A separate source label leaves room for a longer message.',
        tone: 'error', title: 'Preview unavailable', message: 'The track file could not be opened. Reconnect your USB and try again.', meta: 'Playback',
      },
      {
        kind: 'toast', id: 'capsule-toast', name: 'Capsule Toast',
        description: 'Rounded ends frame a short confirmation with a compact icon well.',
        tone: 'success', title: 'Saved to crate', message: 'Track added to your crate.', meta: 'Now',
      },
    ],
  },
];

function StudyPreview({ study, number }: { study: CardStudy | ToastStudy; number: number }) {
  const [dismissed, setDismissed] = useState(false);
  const [actionSelected, setActionSelected] = useState(false);
  const dismiss = () => {
    setDismissed(true);
    setActionSelected(false);
  };
  const previewClass = `ncl-${study.id}`;

  return (
    <article className="ncl-study" data-notice-study={study.id} aria-labelledby={`${study.id}-heading`}>
      <header className="ncl-study-head">
        <span className="nl-number" aria-hidden="true">{String(number).padStart(2, '0')}</span>
        <div>
          <h3 id={`${study.id}-heading`}>{study.name}</h3>
          <p>{study.description}</p>
        </div>
      </header>
      <div className="ncl-stage" data-kind={study.kind}>
        {dismissed ? (
          <ControlButton variant="secondary" className="!min-h-8" onClick={() => setDismissed(false)}>
            Show {study.kind === 'card' ? 'notice' : 'toast'} again
          </ControlButton>
        ) : study.kind === 'card' ? (
          <NoticeCard
            className={previewClass}
            tone={study.tone}
            eyebrow={study.eyebrow}
            title={study.title}
            action={study.action && (
              <ControlButton variant="primary" className="!min-h-8" onClick={() => setActionSelected(true)}>
                {study.action}
              </ControlButton>
            )}
            onDismiss={dismiss}
            dismissLabel={`Dismiss ${study.name} preview`}
          >
            {study.message}
          </NoticeCard>
        ) : (
          <ToastNotification className={previewClass} tone={study.tone} title={study.title} message={study.message} meta={study.meta} onDismiss={dismiss} />
        )}
        {actionSelected && study.kind === 'card' && (
          <p className="ncl-preview-feedback" role="status">{study.action} selected in preview.</p>
        )}
      </div>
    </article>
  );
}

export function NoticeComponentMockupsContent() {
  return (
    <div className="nl-lab ncl-lab">
      <header className="nl-intro">
        <span className="nl-eyebrow">Layout Lab / Notice Component</span>
        <h1>Notice Component</h1>
        <p>Five inline notices and five floating toasts in DropDex’s graphite style. Each preview can be dismissed and shown again. Actions use sample data.</p>
      </header>
      {GROUPS.map(({ title, studies }, groupIndex) => (
        <section className="ncl-group" key={title} aria-labelledby={`notice-study-group-${groupIndex}`}>
          <h2 id={`notice-study-group-${groupIndex}`}>{title}</h2>
          <div className="ncl-grid">
            {studies.map((study, index) => <StudyPreview key={study.id} study={study} number={groupIndex * 5 + index + 1} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
