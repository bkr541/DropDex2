/**
 * Waveform styles for the track timeline, modelled on the colour schemes DJ software offers:
 * - Rekordbox: a classic Blue waveform (one hue, brighter where the music is louder), RGB, and 3-Band (low = blue, mid = amber, high = white).
 * - Serato, Traktor and Cross DJ: RGB / Spectrum, coloured by frequency (bass red, mids green, highs blue), and Traktor's one-hue Infrared.
 * Rekordbox's own colour data stores how much low, mid and high sound each column has as its red, green and blue values, so the styles
 * below recolour a column from those three amounts, and fall back to the column's loudness when a track only has a mono waveform.
 */
export type Rgb = [number, number, number];
export interface WaveformStyleSource { r?: number; g?: number; b?: number; i?: number; h?: number }

export interface WaveformStyle {
  id: string;
  label: string;
  description: string;
  /** CSS gradient drawn on the option card, showing how the style colours low, mid and high. */
  swatch: string;
  /** null = draw the one plain colour the timeline always used. */
  colorFor: ((column: WaveformStyleSource) => Rgb) | null;
}

const lerp = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = Math.max(0, Math.min(1, t));
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
};
const hasBands = (c: WaveformStyleSource): c is Required<Pick<WaveformStyleSource, 'r' | 'g' | 'b'>> => c.r != null && c.g != null && c.b != null;
/** How loud a column is, 0 to 1. */
const loudness = (c: WaveformStyleSource): number => (hasBands(c) ? (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722) / 255 : (c.i ?? c.h ?? 0.5));
/** How much of each band a column has, as shares that add up to 1. */
const bands = (c: Required<Pick<WaveformStyleSource, 'r' | 'g' | 'b'>>): Rgb => {
  const sum = c.r + c.g + c.b || 1;
  return [c.r / sum, c.g / sum, c.b / sum];
};
const mix = (low: Rgb, mid: Rgb, high: Rgb, w: Rgb): Rgb => [0, 1, 2].map((n) => Math.round(low[n] * w[0] + mid[n] * w[1] + high[n] * w[2])) as Rgb;

const BLUE_DARK: Rgb = [24, 70, 150];
const BLUE_LIGHT: Rgb = [130, 198, 255];
const IR_DARK: Rgb = [122, 29, 13];
const IR_LIGHT: Rgb = [255, 179, 71];

export const WAVEFORM_STYLES: readonly WaveformStyle[] = [
  { id: 'slate', label: 'Slate', description: 'One calm blue-gray', swatch: 'linear-gradient(90deg, #8997AE, #8997AE)', colorFor: null },
  {
    id: 'blue', label: 'Classic blue', description: 'Rekordbox’s original blue',
    swatch: 'linear-gradient(90deg, #184696, #4a90e2, #82c6ff)', colorFor: (c) => lerp(BLUE_DARK, BLUE_LIGHT, loudness(c)),
  },
  {
    id: 'rgb', label: 'RGB', description: 'Bass red, mids green, highs blue',
    swatch: 'linear-gradient(90deg, #e5484d, #46c46b, #4a8df0)',
    colorFor: (c) => (hasBands(c) ? mix([229, 72, 77], [70, 196, 107], [74, 141, 240], bands(c)) : lerp([60, 90, 150], [140, 210, 255], loudness(c))),
  },
  {
    id: 'three-band', label: '3-Band', description: 'Bass blue, mids amber, highs white',
    swatch: 'linear-gradient(90deg, #2f6fed, #f5a623, #ffffff)',
    colorFor: (c) => (hasBands(c) ? mix([47, 111, 237], [245, 166, 35], [255, 255, 255], bands(c)) : lerp([47, 111, 237], [255, 255, 255], loudness(c))),
  },
  {
    id: 'infrared', label: 'Infrared', description: 'Traktor’s warm red to amber',
    swatch: 'linear-gradient(90deg, #7a1d0d, #d9622b, #ffb347)', colorFor: (c) => lerp(IR_DARK, IR_LIGHT, loudness(c)),
  },
];

export type WaveformStyleId = typeof WAVEFORM_STYLES[number]['id'];
export const DEFAULT_WAVEFORM_STYLE: WaveformStyleId = 'slate';
export const waveformStyleById = (id: string): WaveformStyle => WAVEFORM_STYLES.find((style) => style.id === id) ?? WAVEFORM_STYLES[0];
