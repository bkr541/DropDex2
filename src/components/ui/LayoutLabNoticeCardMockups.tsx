import { useState, type ReactNode } from 'react';
import { Usb } from 'iconoir-react/regular';
import { ControlButton } from './controls/ControlButton';
import { NoticeCard } from './feedback/NoticeCard';
import { NOTICES, NOTICE_GROUPS, NOTICE_SHOWN_IN, SURFACE_NOTICES } from './layoutLabNoticeData';
import './layout-lab-notice-card.css';

// Layout Lab / Notice Card: the one reusable notice card, then every message the player can show (25), then one notice for each
// of the other places that tell the user about their USB (7).

function Row({ n, name, where, children }: { n: number; name: string; where: string; children: ReactNode }) {
  return (
    <div className="nl-row" data-testid="notice-row">
      <div className="nl-meta">
        <span className="nl-number">{n}</span>
        <div><strong>{name}</strong><small>{where}</small></div>
      </div>
      <div className="nl-card">{children}</div>
    </div>
  );
}

/** A card that can be dismissed, and brought back, so the close button can be tried. */
function Dismissable({ children }: { children: (dismiss: () => void) => ReactNode }) {
  const [open, setOpen] = useState(true);
  return open ? <>{children(() => setOpen(false))}</> : (
    <p className="nl-dismissed">Dismissed. <button type="button" onClick={() => setOpen(true)}>Show again</button></p>
  );
}

const connect = <ControlButton variant="primary" className="!min-h-8 text-xs"><Usb width={12} height={12} aria-hidden="true" /> Connect USB</ControlButton>;

export function NoticeCardMockupsContent() {
  let n = 0;
  return (
    <div className="nl-lab" data-testid="notice-card-mockups">
      <div className="nl-intro">
        <span className="nl-eyebrow">Layout Lab / Notice Card</span>
        <h1>One notice card for every message</h1>
        <p>
          The reusable <code>NoticeCard</code> in the graphite look: a raised card with a tinted icon, a short title, the message and, when it helps, a
          button and a close. Below are all {NOTICES.length} messages the audio player can show, grouped as they are written in the code, and then one notice for each of the
          {' '}{SURFACE_NOTICES.length} other screens that tell the user about their USB.
        </p>
        <div className="nl-tones" aria-label="Tones">
          {(['error', 'warning', 'info', 'success', 'neutral'] as const).map((tone) => (
            <NoticeCard key={tone} tone={tone} eyebrow={tone} title={`A ${tone} notice`}>{tone === 'error' ? 'Something failed.' : tone === 'warning' ? 'Something needs fixing.' : tone === 'info' ? 'Something to know.' : tone === 'success' ? 'It worked.' : 'Nothing is wrong.'}</NoticeCard>
          ))}
        </div>
      </div>

      {NOTICE_GROUPS.map((group) => {
        const entries = NOTICES.filter((entry) => entry.group === group.id);
        return (
          <section key={group.id} className="nl-section" data-testid="notice-group" data-group={group.id}>
            <div className="nl-section-head"><h2>{group.title}</h2><span>{group.note}</span></div>
            {entries.map((entry) => {
              n += 1;
              return (
                <Row key={entry.id} n={n} name={entry.id} where={NOTICE_SHOWN_IN}>
                  <Dismissable>
                    {(dismiss) => (
                      <NoticeCard tone={entry.tone} eyebrow={group.title} title={entry.title} action={entry.connectAction ? connect : undefined} onDismiss={dismiss}>
                        {entry.message}
                      </NoticeCard>
                    )}
                  </Dismissable>
                </Row>
              );
            })}
          </section>
        );
      })}

      <section className="nl-section" data-testid="notice-surfaces">
        <div className="nl-section-head"><h2>Other USB notices</h2><span>Written separately from the player today, one per screen.</span></div>
        {SURFACE_NOTICES.map((notice, i) => (
          <Row key={notice.id} n={i + 1} name={notice.surface} where={notice.where}>
            <NoticeCard
              tone={notice.tone}
              eyebrow={notice.surface}
              title={notice.title}
              action={notice.action ? <ControlButton variant="secondary" className="!min-h-8 text-xs">{notice.action}</ControlButton> : undefined}
            >
              {notice.message}
            </NoticeCard>
          </Row>
        ))}
      </section>
    </div>
  );
}
