// Sizes for the Delete All slider, kept together so the thumb is centred inside the track's border.
export const THUMB_SIZE = 44;
/** Space between the thumb and the inside of the track's border, on all four sides. */
export const TRACK_PAD = 4;
/** The track's red border. */
export const TRACK_BORDER = 1;
/** Tall enough that the thumb has the same space above and below as it has at the left and right. */
export const SLIDER_TRACK_HEIGHT = THUMB_SIZE + (TRACK_PAD + TRACK_BORDER) * 2;

/** How far the thumb can travel for a track this wide (its outer width, border included), leaving the same space at the far end as at the start. */
export function sliderTravel(trackOuterWidth: number): number {
  return trackOuterWidth - (TRACK_PAD + TRACK_BORDER) * 2 - THUMB_SIZE;
}
