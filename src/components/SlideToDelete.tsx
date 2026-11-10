import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'iconoir-react/regular';
import { SLIDER_TRACK_HEIGHT, THUMB_SIZE, TRACK_BORDER, TRACK_PAD, sliderTravel } from './deleteAllSlider';

/**
 * The drag-to-confirm control used by every permanent delete. Drag the thumb across the track to confirm; letting go before
 * 90% sends it back. `onChange` reports whether the delete is confirmed. It starts unconfirmed each time it appears.
 */
export function SlideToDelete({ disabled = false, onChange }: { disabled?: boolean; onChange: (confirmed: boolean) => void }) {
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const confirmed = progress >= 1;

  useEffect(() => { onChange(confirmed); }, [confirmed, onChange]);

  const maxOffset = trackRef.current ? sliderTravel(trackRef.current.offsetWidth) : 0;
  const thumbX = progress * maxOffset;

  function handleThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || confirmed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function handleThumbPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const max = sliderTravel(trackRef.current.offsetWidth);
    const raw = e.clientX - rect.left - TRACK_BORDER - THUMB_SIZE / 2 - TRACK_PAD;
    setProgress(Math.max(0, Math.min(1, max > 0 ? raw / max : 0)));
  }

  function handleThumbPointerUp() {
    if (!dragging) return;
    setDragging(false);
    setProgress((prev) => (prev >= 0.9 ? 1 : 0));
  }

  return (
              <div>
                <p className="import-group__label">Slide to delete</p>
                <div
                  ref={trackRef}
                  className="relative overflow-hidden rounded-full border border-red-500/50 select-none"
                  style={{ height: SLIDER_TRACK_HEIGHT, borderWidth: TRACK_BORDER }}
                >
                  {/* Fill — only visible when confirmed */}
                  {confirmed && (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ background: 'linear-gradient(90deg, #dc2626 0%, #ef4444 100%)' }}
                    />
                  )}
                  {/* Idle label */}
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    style={{ opacity: Math.max(0, 1 - progress * 2.5) }}
                  >
                    <span className="text-[11px] font-semibold tracking-wider text-red-400/70">
                      Drag to confirm
                    </span>
                  </div>
                  {/* Confirmed label */}
                  {confirmed && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="text-[11px] font-semibold tracking-wider text-white/90">
                        Ready for Delete
                      </span>
                    </div>
                  )}
                  {/* Thumb */}
                  <div
                    onPointerDown={handleThumbPointerDown}
                    onPointerMove={handleThumbPointerMove}
                    onPointerUp={handleThumbPointerUp}
                    className="absolute flex items-center justify-center rounded-full bg-red-400"
                    style={{
                      left: TRACK_PAD,
                      top: TRACK_PAD,
                      width: THUMB_SIZE,
                      height: THUMB_SIZE,
                      transform: `translateX(${thumbX}px)`,
                      transition: dragging ? 'none' : 'transform 220ms ease',
                      cursor: confirmed ? 'default' : dragging ? 'grabbing' : 'grab',
                    }}
                  >
                    {confirmed ? (
                      <Check width={18} height={18} color="rgba(255,200,200,0.9)" strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <ArrowRight width={18} height={18} aria-hidden="true" className="text-white" />
                    )}
                  </div>
                </div>
              </div>
  );
}
