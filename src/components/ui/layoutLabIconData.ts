// Ten duotone icon concepts for each page in the left nav. Each is drawn on a 24 x 24 grid with a 1.6 stroke, round caps and
// joins. Every icon has two tones: a solid tone (strokes and solid shapes) and a light tone (tinted fills at 30%), both from
// currentColor so one set of CSS rules can show it in every state.

interface IconConcept { name: string; svg: string }
interface IconGroup { page: string; icons: IconConcept[] }

export const ICON_GROUPS: IconGroup[] = [
  {
    page: "Library",
    icons: [
      { name: "Records in a crate", svg: "<path d=\"M4.6 12a4.2 4.2 0 0 1 8.4 0\"/><path d=\"M11 12a4.2 4.2 0 0 1 8.4 0\"/><circle cx=\"8.8\" cy=\"9.2\" r=\"0.8\" fill=\"currentColor\"/><circle cx=\"15.2\" cy=\"9.2\" r=\"0.8\" fill=\"currentColor\"/><path d=\"M3.5 12h17v7.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M9.5 16.5h5\"/>" },
      { name: "Vinyl", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"12\" r=\"5.6\"/><circle cx=\"12\" cy=\"12\" r=\"2.6\" fill=\"currentColor\"/><path d=\"M6.2 7.8a7 7 0 0 1 3.6-2.6\"/>" },
      { name: "Record stack", svg: "<ellipse cx=\"12\" cy=\"17\" rx=\"8.5\" ry=\"3.2\" fill=\"currentColor\" fill-opacity=\".3\"/><ellipse cx=\"12\" cy=\"12\" rx=\"8.5\" ry=\"3.2\" fill=\"currentColor\" fill-opacity=\".3\"/><ellipse cx=\"12\" cy=\"7\" rx=\"8.5\" ry=\"3.2\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"7\" r=\"1\" fill=\"currentColor\"/>" },
      { name: "Playlist folder", svg: "<path d=\"M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"10\" cy=\"16.2\" r=\"1.6\" fill=\"currentColor\"/><circle cx=\"14.6\" cy=\"15.2\" r=\"1.6\" fill=\"currentColor\"/><path d=\"M11.6 16.2v-4.6l4.6-1v4.6\"/>" },
      { name: "Playlist card", svg: "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"3\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M7.5 9.5h5.5M7.5 13h4M7.5 16.5h2.5\"/><path d=\"M15.3 12.4l4 2.6-4 2.6z\" fill=\"currentColor\"/>" },
      { name: "My book", svg: "<path d=\"M6 3.5h11.5A1.5 1.5 0 0 1 19 5v14.5H7.5A1.5 1.5 0 0 1 6 18z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M6 18a1.5 1.5 0 0 1 1.5-1.5H19\"/><circle cx=\"12.5\" cy=\"10\" r=\"3.4\"/><circle cx=\"12.5\" cy=\"10\" r=\"1\" fill=\"currentColor\"/>" },
      { name: "Shelf of spines", svg: "<rect x=\"4\" y=\"6\" width=\"3.4\" height=\"13\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"8.6\" y=\"3.5\" width=\"3.4\" height=\"15.5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"13.2\" y=\"7\" width=\"3.4\" height=\"12\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"17.8\" y=\"5\" width=\"3\" height=\"14\" rx=\"1\"/><path d=\"M3 20.5h18\"/>" },
      { name: "Waveform tile", svg: "<rect x=\"3.5\" y=\"3.5\" width=\"17\" height=\"17\" rx=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M8 10.5v3M11 8v8M14 9.5v5M17 11v2\" stroke-width=\"2.2\"/>" },
      { name: "Beamed notes", svg: "<path d=\"M9 8l10-2.2v3.6L9 11.6z\" fill=\"currentColor\"/><path d=\"M9 16.5V8M19 14.5V5.8\"/><circle cx=\"6.6\" cy=\"16.5\" r=\"2.5\" fill=\"currentColor\"/><circle cx=\"16.6\" cy=\"14.5\" r=\"2.5\" fill=\"currentColor\"/>" },
      { name: "Artwork grid", svg: "<rect x=\"3.5\" y=\"3.5\" width=\"7.5\" height=\"7.5\" rx=\"2\" fill=\"currentColor\"/><rect x=\"13\" y=\"3.5\" width=\"7.5\" height=\"7.5\" rx=\"2\"/><rect x=\"3.5\" y=\"13\" width=\"7.5\" height=\"7.5\" rx=\"2\"/><rect x=\"13\" y=\"13\" width=\"7.5\" height=\"7.5\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/>" },
    ],
  },
  {
    page: "Review",
    icons: [
      { name: "Camelot wheel", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"12\" r=\"5.2\"/><path d=\"M17.02 13.35L20.69 14.33M15.68 15.68L18.36 18.36M13.35 17.02L14.33 20.69M10.65 17.02L9.67 20.69M8.32 15.68L5.64 18.36M6.98 13.35L3.31 14.33M6.98 10.65L3.31 9.67M8.32 8.32L5.64 5.64M10.65 6.98L9.67 3.31M13.35 6.98L14.33 3.31M15.68 8.32L18.36 5.64M17.02 10.65L20.69 9.67\"/><path d=\"M14.33 3.31A9 9 0 0 1 18.36 5.64L15.68 8.32A5.2 5.2 0 0 0 13.35 6.98z\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"1.7\" fill=\"currentColor\"/>" },
      { name: "BPM histogram", svg: "<path d=\"M3.5 20.5h17\"/><rect x=\"4.5\" y=\"14\" width=\"3\" height=\"6.5\" rx=\"0.8\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"9\" y=\"10\" width=\"3\" height=\"10.5\" rx=\"0.8\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"13.5\" y=\"3.5\" width=\"3\" height=\"17\" rx=\"0.8\" fill=\"currentColor\"/><rect x=\"18\" y=\"12\" width=\"2.5\" height=\"8.5\" rx=\"0.8\" fill=\"currentColor\" fill-opacity=\".3\"/>" },
      { name: "Split pie", svg: "<circle cx=\"11\" cy=\"13\" r=\"8\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M12.5 11.5V2.5a8.5 8.5 0 0 1 8.5 9z\" fill=\"currentColor\"/>" },
      { name: "Bars and trend", svg: "<rect x=\"4.5\" y=\"13\" width=\"3.5\" height=\"7.5\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"10.2\" y=\"9\" width=\"3.5\" height=\"11.5\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"15.9\" y=\"5.5\" width=\"3.5\" height=\"15\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3.5 9.5l5-4 4.5 3 7.5-6\"/><path d=\"M16.5 3h4v4\"/>" },
      { name: "Tempo gauge", svg: "<path d=\"M3.5 17a8.5 8.5 0 0 1 17 0h-4.4a4.1 4.1 0 0 0-8.2 0z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M3.5 17a8.5 8.5 0 0 1 17 0\"/><path d=\"M12 17l4.6-6\"/><circle cx=\"12\" cy=\"17\" r=\"1.9\" fill=\"currentColor\"/><path d=\"M3.5 20.5h17\" stroke-opacity=\".4\"/>" },
      { name: "Analysis lens", svg: "<circle cx=\"10.5\" cy=\"10.5\" r=\"7\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M15.8 15.8L21 21\" stroke-width=\"2.2\"/><path d=\"M7 12.8l2.6-3.2 2 1.8 2.6-3.4\"/><circle cx=\"14.2\" cy=\"8.4\" r=\"1.1\" fill=\"currentColor\"/>" },
      { name: "Report", svg: "<rect x=\"5\" y=\"4.5\" width=\"14\" height=\"16.5\" rx=\"2.5\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"9\" y=\"2.8\" width=\"6\" height=\"3.4\" rx=\"1.2\" fill=\"currentColor\"/><path d=\"M8.5 12.5l2.2 2.2 4-4.5\"/><path d=\"M8.5 18h7\"/>" },
      { name: "Analysis table", svg: "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"14\" rx=\"2.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3.5 7.5A2.5 2.5 0 0 1 6 5h12a2.5 2.5 0 0 1 2.5 2.5V10h-17z\" fill=\"currentColor\"/><path d=\"M3.5 14.5h17M10 10v9\"/>" },
      { name: "Ranking podium", svg: "<rect x=\"3.5\" y=\"12\" width=\"5.5\" height=\"8.5\" rx=\"1.2\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"9.3\" y=\"6.5\" width=\"5.5\" height=\"14\" rx=\"1.2\" fill=\"currentColor\"/><rect x=\"15\" y=\"14\" width=\"5.5\" height=\"6.5\" rx=\"1.2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3 20.5h18\"/>" },
      { name: "Pulse tile", svg: "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"16\" rx=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M6.5 12.5h2.5l1.5-3.5 3 7 1.7-3.5h2.3\" stroke-width=\"1.9\"/>" },
    ],
  },
  {
    page: "Cue Points",
    icons: [
      { name: "Cue flag", svg: "<rect x=\"3.5\" y=\"16.2\" width=\"17\" height=\"4.3\" rx=\"2.15\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M8.5 18.5V4\"/><path d=\"M8.5 4.5h10l-2.4 3.6 2.4 3.6h-10z\" fill=\"currentColor\"/>" },
      { name: "Hot cue pad", svg: "<rect x=\"3.5\" y=\"3.5\" width=\"17\" height=\"17\" rx=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M9.5 17V7\"/><path d=\"M9.5 7.6h6l-1.6 2.6 1.6 2.6h-6z\" fill=\"currentColor\"/>" },
      { name: "Marker on wave", svg: "<rect x=\"3.2\" y=\"12.5\" width=\"2.6\" height=\"5\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"6.95\" y=\"10.5\" width=\"2.6\" height=\"9\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"10.7\" y=\"9\" width=\"2.6\" height=\"12\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"14.45\" y=\"10.5\" width=\"2.6\" height=\"9\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"18.2\" y=\"12\" width=\"2.6\" height=\"6\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M8.8 2.5h6.4L12 7z\" fill=\"currentColor\"/><path d=\"M12 7v13\"/>" },
      { name: "Memory bookmark", svg: "<rect x=\"3.5\" y=\"3.5\" width=\"17\" height=\"17\" rx=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M8.5 4.5h7v14l-3.5-3-3.5 3z\" fill=\"currentColor\"/>" },
      { name: "Loop region", svg: "<rect x=\"7\" y=\"6.5\" width=\"10\" height=\"11\" rx=\"1.5\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M7 6.5H4v11h3M17 6.5h3v11h-3\"/><path d=\"M10.5 10v4M13.5 8.5v7\"/>" },
      { name: "Played section", svg: "<rect x=\"3.5\" y=\"5\" width=\"8.5\" height=\"14\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M12 3.5v17\"/><path d=\"M9.4 3h5.2L12 6.6z\" fill=\"currentColor\"/><path d=\"M15.2 10v4M18.4 8.5v7\"/>" },
      { name: "Phrase blocks", svg: "<rect x=\"3.5\" y=\"12\" width=\"5\" height=\"8\" rx=\"1.5\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"9.5\" y=\"6\" width=\"5\" height=\"14\" rx=\"1.5\" fill=\"currentColor\"/><rect x=\"15.5\" y=\"9\" width=\"5\" height=\"11\" rx=\"1.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3.5 7.5h5M9.5 3.5h5M15.5 6h5\" stroke-opacity=\".4\"/>" },
      { name: "Stopwatch", svg: "<circle cx=\"12\" cy=\"13.5\" r=\"7.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10 3h4M12 3v3\"/><path d=\"M12 13.5V9.5\"/><circle cx=\"12\" cy=\"13.5\" r=\"1.6\" fill=\"currentColor\"/><path d=\"M19 6.5l1.5-1.5\"/>" },
      { name: "Target cue", svg: "<circle cx=\"12\" cy=\"12\" r=\"8\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"12\" cy=\"12\" r=\"1.7\" fill=\"currentColor\"/><path d=\"M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3\"/>" },
      { name: "Beat grid flag", svg: "<rect x=\"3.5\" y=\"16.5\" width=\"17\" height=\"4\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M4.5 20.5v-6M9.5 20.5v-6M19.5 20.5v-6\"/><path d=\"M14.5 3.5v17\"/><path d=\"M14.5 4h5l-1.4 2.2 1.4 2.2h-5z\" fill=\"currentColor\"/>" },
    ],
  },
  {
    page: "Audition",
    icons: [
      { name: "Headphones", svg: "<path d=\"M4.5 14.5v-2.5a7.5 7.5 0 0 1 15 0v2.5\" stroke-width=\"2\"/><rect x=\"3.5\" y=\"13\" width=\"4.6\" height=\"8\" rx=\"2\" fill=\"currentColor\"/><rect x=\"15.9\" y=\"13\" width=\"4.6\" height=\"8\" rx=\"2\" fill=\"currentColor\"/><rect x=\"8.4\" y=\"15\" width=\"7.2\" height=\"4\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/>" },
      { name: "Headphones play", svg: "<path d=\"M4.5 14.5v-2.5a7.5 7.5 0 0 1 15 0v2.5\" stroke-width=\"2\"/><rect x=\"3.5\" y=\"13\" width=\"4.6\" height=\"8\" rx=\"2\" fill=\"currentColor\"/><rect x=\"15.9\" y=\"13\" width=\"4.6\" height=\"8\" rx=\"2\" fill=\"currentColor\"/><path d=\"M10.5 10.2l4 2.5-4 2.5z\" fill=\"currentColor\"/>" },
      { name: "Play and sound", svg: "<circle cx=\"12\" cy=\"12\" r=\"6\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10.4 9.2l4.4 2.8-4.4 2.8z\" fill=\"currentColor\"/><path d=\"M3 8.5a6 6 0 0 0 0 7M21 8.5a6 6 0 0 1 0 7\"/>" },
      { name: "Keep, maybe, remove", svg: "<circle cx=\"5.4\" cy=\"12\" r=\"3.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M4.1 12.1l1 1 1.8-2\"/><circle cx=\"12\" cy=\"12\" r=\"3.5\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10.6 12h2.8\"/><circle cx=\"18.6\" cy=\"12\" r=\"3.5\" fill=\"currentColor\"/><path d=\"M17.4 10.8l2.4 2.4M19.8 10.8l-2.4 2.4\" stroke=\"var(--color-background)\"/>" },
      { name: "Speaker", svg: "<path d=\"M3.5 9.5h4l5-4v13l-5-4h-4z\" fill=\"currentColor\"/><path d=\"M15.5 8.5a4.5 4.5 0 0 1 0 7\"/><path d=\"M18.5 5.5a8.5 8.5 0 0 1 0 13\" stroke-opacity=\".4\"/>" },
      { name: "Equaliser tile", svg: "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"16\" rx=\"4\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"7\" y=\"11.5\" width=\"2.6\" height=\"6\" rx=\"1.3\" fill=\"currentColor\"/><rect x=\"10.7\" y=\"7\" width=\"2.6\" height=\"10.5\" rx=\"1.3\" fill=\"currentColor\"/><rect x=\"14.4\" y=\"9.5\" width=\"2.6\" height=\"8\" rx=\"1.3\" fill=\"currentColor\"/>" },
      { name: "Queue", svg: "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"5\" rx=\"2.2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M6.4 5.2l2.6 1.3-2.6 1.3z\" fill=\"currentColor\"/><path d=\"M11.5 6.5h6\"/><rect x=\"3.5\" y=\"10.5\" width=\"17\" height=\"4.5\" rx=\"2.2\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"3.5\" y=\"16.5\" width=\"17\" height=\"4\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/>" },
      { name: "Section under test", svg: "<path d=\"M10.9 2.5l3.8 2.4-3.8 2.4z\" fill=\"currentColor\"/><rect x=\"3\" y=\"12\" width=\"2.6\" height=\"7\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"6.8\" y=\"10\" width=\"2.6\" height=\"11\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"10.6\" y=\"8.5\" width=\"2.6\" height=\"14\" rx=\"1.3\" fill=\"currentColor\"/><rect x=\"14.4\" y=\"10\" width=\"2.6\" height=\"11\" rx=\"1.3\" fill=\"currentColor\"/><rect x=\"18.2\" y=\"12\" width=\"2.6\" height=\"7\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/>" },
      { name: "Kept", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M7.5 12.5l3 3 6-6.5\" stroke-width=\"2.2\"/>" },
      { name: "Record and headphones", svg: "<circle cx=\"12\" cy=\"15\" r=\"5.5\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"15\" r=\"1.5\" fill=\"currentColor\"/><path d=\"M4.5 11.5V10a7.5 7.5 0 0 1 15 0v1.5\"/><rect x=\"3.5\" y=\"9.5\" width=\"3.2\" height=\"6\" rx=\"1.4\" fill=\"currentColor\"/><rect x=\"17.3\" y=\"9.5\" width=\"3.2\" height=\"6\" rx=\"1.4\" fill=\"currentColor\"/>" },
    ],
  },
  {
    page: "Discover",
    icons: [
      { name: "Compass", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M12 5l3.2 7h-6.4z\" fill=\"currentColor\"/><path d=\"M12 19l-3.2-7h6.4z\"/>" },
      { name: "Radar", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"5\" stroke-opacity=\".4\"/><path d=\"M12 12V3a9 9 0 0 1 7.8 4.5z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M12 12l7.8-4.5\"/><circle cx=\"8\" cy=\"8\" r=\"1.5\" fill=\"currentColor\"/>" },
      { name: "Radio", svg: "<rect x=\"3.5\" y=\"8\" width=\"17\" height=\"12\" rx=\"3\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M7 8l9-4.5\"/><circle cx=\"9\" cy=\"14\" r=\"2.8\" fill=\"currentColor\"/><path d=\"M14 12.5h4M14 15.5h4\"/>" },
      { name: "Globe pin", svg: "<circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3 12h18\"/><ellipse cx=\"12\" cy=\"12\" rx=\"4\" ry=\"9\" stroke-opacity=\".4\"/><circle cx=\"16.5\" cy=\"8\" r=\"2\" fill=\"currentColor\"/>" },
      { name: "Artist search", svg: "<circle cx=\"10.5\" cy=\"10.5\" r=\"7\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"10.5\" cy=\"8.8\" r=\"2\" fill=\"currentColor\"/><path d=\"M6.8 14.6a3.7 3.7 0 0 1 7.4 0\"/><path d=\"M15.8 15.8L21 21\" stroke-width=\"2.2\"/>" },
      { name: "Broadcast", svg: "<circle cx=\"12\" cy=\"12\" r=\"3\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"5.5\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M6.6 6.6a7.6 7.6 0 0 0 0 10.8M17.4 6.6a7.6 7.6 0 0 1 0 10.8\"/><path d=\"M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17\" stroke-opacity=\".4\"/>" },
      { name: "Fresh find", svg: "<path d=\"M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4-2.4 7.1-2.4-7.1L2.5 12l7.1-2.4z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M19.5 2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z\" fill=\"currentColor\"/>" },
      { name: "Tracklist", svg: "<circle cx=\"5.5\" cy=\"6\" r=\"2\" fill=\"currentColor\"/><path d=\"M10 6h10\"/><circle cx=\"5.5\" cy=\"12\" r=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10 12h8\"/><circle cx=\"5.5\" cy=\"18\" r=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10 18h10\"/><path d=\"M5.5 8v2M5.5 14v2\" stroke-opacity=\".4\"/>" },
      { name: "Genre tag", svg: "<path d=\"M3.5 4.5a1 1 0 0 1 1-1h7.6a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0L3.8 12.1a1 1 0 0 1-.3-.7z\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"8\" cy=\"8\" r=\"1.7\" fill=\"currentColor\"/>" },
      { name: "Line-up", svg: "<circle cx=\"5.5\" cy=\"6.5\" r=\"2\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"4\" r=\"2\" fill=\"currentColor\"/><circle cx=\"18.5\" cy=\"7.5\" r=\"2\" fill=\"currentColor\"/><rect x=\"3.5\" y=\"10.5\" width=\"4\" height=\"10\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"10\" y=\"8\" width=\"4\" height=\"12.5\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"16.5\" y=\"11.5\" width=\"4\" height=\"9\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".3\"/>" },
    ],
  },
  {
    page: "Drop Lab",
    icons: [
      { name: "Flask", svg: "<path d=\"M9.5 3.5h5M10.5 3.5V10L5.2 18.8a1.6 1.6 0 0 0 1.4 2.4h10.8a1.6 1.6 0 0 0 1.4-2.4L13.5 10V3.5\"/><path d=\"M7.3 15.6h9.4l1.9 3.2a1.6 1.6 0 0 1-1.4 2.4H6.8a1.6 1.6 0 0 1-1.4-2.4z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><circle cx=\"10.5\" cy=\"18.2\" r=\"1\" fill=\"currentColor\"/><circle cx=\"14\" cy=\"17.6\" r=\"0.8\" fill=\"currentColor\"/>" },
      { name: "Water drop", svg: "<path d=\"M12 3s6.5 6.7 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.7 12 3 12 3z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M9 14.5a3.2 3.2 0 0 0 2.2 3\"/><circle cx=\"15\" cy=\"12.5\" r=\"1\" fill=\"currentColor\"/>" },
      { name: "Beaker and drop", svg: "<path d=\"M6 8.5V19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5M5 8.5h14\"/><path d=\"M6.2 14h11.6V19a2 2 0 0 1-2 2H8.2a2 2 0 0 1-2-2z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M6.2 14c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 1.5-.6 2.6 0\"/><path d=\"M12 1.5s2 2.2 2 3.6a2 2 0 0 1-4 0c0-1.4 2-3.6 2-3.6z\" fill=\"currentColor\"/>" },
      { name: "Test tubes", svg: "<path d=\"M5.5 3.5h5M6.5 3.5V17a2.5 2.5 0 0 0 5 0V3.5\"/><path d=\"M12.5 3.5h5M13.5 3.5V17a2.5 2.5 0 0 0 5 0V3.5\"/><path d=\"M6.5 11h5v6a2.5 2.5 0 0 1-5 0z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M13.5 8h5v9a2.5 2.5 0 0 1-5 0z\" fill=\"currentColor\"/>" },
      { name: "Impact", svg: "<circle cx=\"12\" cy=\"12\" r=\"3.5\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"6.5\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M20.31 14.23L22.63 14.85M18.08 18.08L19.78 19.78M14.23 20.31L14.85 22.63M9.77 20.31L9.15 22.63M5.92 18.08L4.22 19.78M3.69 14.23L1.37 14.85M3.69 9.77L1.37 9.15M5.92 5.92L4.22 4.22M9.77 3.69L9.15 1.37M14.23 3.69L14.85 1.37M18.08 5.92L19.78 4.22M20.31 9.77L22.63 9.15\"/>" },
      { name: "Atom", svg: "<ellipse cx=\"12\" cy=\"12\" rx=\"9.5\" ry=\"3.8\"/><ellipse cx=\"12\" cy=\"12\" rx=\"9.5\" ry=\"3.8\" transform=\"rotate(60 12 12)\"/><ellipse cx=\"12\" cy=\"12\" rx=\"9.5\" ry=\"3.8\" transform=\"rotate(120 12 12)\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"12\" r=\"2\" fill=\"currentColor\"/>" },
      { name: "Drop marker", svg: "<rect x=\"3.5\" y=\"13\" width=\"2.6\" height=\"7.5\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"7\" y=\"10.5\" width=\"2.6\" height=\"10\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><rect x=\"10.5\" y=\"8\" width=\"2.6\" height=\"12.5\" rx=\"1.3\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M15.8 3v18\" stroke-dasharray=\"1.6 2\"/><rect x=\"17.2\" y=\"3.5\" width=\"2.6\" height=\"17\" rx=\"1.3\" fill=\"currentColor\"/>" },
      { name: "Double drop", svg: "<path d=\"M5 5l7 6 7-6\" stroke-opacity=\".4\" stroke-width=\"2\"/><path d=\"M5 11.5l7 6.5 7-6.5\" stroke-width=\"2\"/><path d=\"M5 21.5h14\" stroke-opacity=\".4\"/>" },
      { name: "Flask with wave", svg: "<path d=\"M9.5 3.5h5M10.5 3.5V10L5.2 18.8a1.6 1.6 0 0 0 1.4 2.4h10.8a1.6 1.6 0 0 0 1.4-2.4L13.5 10V3.5\"/><path d=\"M7.4 16c1.2-1.4 2.4-1.4 3.6 0s2.4 1.4 3.6 0 2.4-1.4 3.5 0l1.1 2.5a1.6 1.6 0 0 1-1.4 2.7H6.8a1.6 1.6 0 0 1-1.4-2.4z\" fill=\"currentColor\" fill-opacity=\".3\" stroke=\"none\"/><path d=\"M7.4 16c1.2-1.4 2.4-1.4 3.6 0s2.4 1.4 3.6 0 2.4-1.4 3.5 0\"/>" },
      { name: "Dropper", svg: "<rect x=\"8.5\" y=\"2.5\" width=\"7\" height=\"6\" rx=\"3\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M7.5 8.5h9\"/><path d=\"M10 8.5v8l2 2.5 2-2.5v-8\"/><path d=\"M12 20.5s1.6 1.7 1.6 2.6a1.6 1.6 0 0 1-3.2 0c0-.9 1.6-2.6 1.6-2.6z\" fill=\"currentColor\"/>" },
    ],
  },
  {
    page: "Flip Lab",
    icons: [
      { name: "Deck swap", svg: "<circle cx=\"6\" cy=\"13\" r=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"6\" cy=\"13\" r=\"1\" fill=\"currentColor\"/><circle cx=\"18\" cy=\"13\" r=\"4.5\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"18\" cy=\"13\" r=\"1\" fill=\"currentColor\"/><path d=\"M9.5 5h5M13 3.4l1.6 1.6L13 6.6M14.5 21h-5M11 19.4L9.4 21l1.6 1.6\"/>" },
      { name: "Flipping a record", svg: "<circle cx=\"12\" cy=\"12\" r=\"4.8\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"12\" cy=\"12\" r=\"1.1\" fill=\"currentColor\"/><path d=\"M4.5 9a8 8 0 0 1 13.5-3M19.5 15a8 8 0 0 1-13.5 3M18.2 2.8V6.2h-3.4M5.8 21.2V17.8h3.4\"/>" },
      { name: "Vocal over instrumental", svg: "<rect x=\"3.5\" y=\"3.5\" width=\"17\" height=\"5.5\" rx=\"2.7\" fill=\"currentColor\"/><rect x=\"3.5\" y=\"15\" width=\"17\" height=\"5.5\" rx=\"2.7\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2\"/>" },
      { name: "Vocal on a record", svg: "<circle cx=\"14.5\" cy=\"13\" r=\"7\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"14.5\" cy=\"13\" r=\"1.2\" fill=\"currentColor\"/><rect x=\"3.5\" y=\"3.5\" width=\"5.5\" height=\"9\" rx=\"2.75\" fill=\"currentColor\"/><path d=\"M2.8 11a4.2 4.2 0 0 0 7.9 0M6.2 15.5v3\"/>" },
      { name: "Key shift", svg: "<path d=\"M8 3.5l-4.5 6h3v5h3v-5h3z\" fill=\"currentColor\"/><path d=\"M16.5 20.5l4.5-6h-3v-5h-3v5h-3z\" fill=\"currentColor\" fill-opacity=\".3\"/>" },
      { name: "Crossfade", svg: "<path d=\"M3.5 6c7 0 9 12 17 12\" stroke-width=\"2\"/><path d=\"M3.5 18c7 0 9-12 17-12\" stroke-opacity=\".4\" stroke-width=\"2\"/><path d=\"M3.5 21h17\" stroke-opacity=\".4\"/>" },
      { name: "Mirror", svg: "<path d=\"M12 3v18\" stroke-dasharray=\"1.6 2\"/><path d=\"M9 6L3.5 18H9z\" fill=\"currentColor\"/><path d=\"M15 6l5.5 12H15z\" fill=\"currentColor\" fill-opacity=\".3\"/>" },
      { name: "Card flip", svg: "<rect x=\"3.5\" y=\"6\" width=\"10\" height=\"14\" rx=\"2\" fill=\"currentColor\"/><path d=\"M16.5 7.5L20.5 9v11l-4 1.5z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M6.5 4.2a9 9 0 0 1 11-1.2M17 1v3h-3\"/>" },
      { name: "Metronome", svg: "<path d=\"M7 21L9.2 4.5h5.6L17 21z\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M12 17.5l4-9\"/><circle cx=\"14.3\" cy=\"11.4\" r=\"1.5\" fill=\"currentColor\"/><path d=\"M5.5 21h13\"/>" },
      { name: "Shuffle", svg: "<path d=\"M3.5 7h3.5c3 0 4.5 2 6 5s3 5 6 5h1.5M3.5 17h3.5c1.5 0 2.7-.6 3.6-1.6M13.5 8.6c.9-1 2-1.6 3.5-1.6H20\"/><path d=\"M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5\"/><circle cx=\"3.5\" cy=\"7\" r=\"1.4\" fill=\"currentColor\"/><circle cx=\"3.5\" cy=\"17\" r=\"1.4\" fill=\"currentColor\"/>" },
    ],
  },
  {
    page: "USB Management",
    icons: [
      { name: "USB stick", svg: "<rect x=\"6.5\" y=\"9\" width=\"11\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"9\" y=\"3.5\" width=\"6\" height=\"5.5\" rx=\"1\"/><circle cx=\"10.8\" cy=\"6.2\" r=\"0.7\" fill=\"currentColor\"/><circle cx=\"13.2\" cy=\"6.2\" r=\"0.7\" fill=\"currentColor\"/><path d=\"M9.5 15h5M9.5 18h3\"/>" },
      { name: "Import to stick", svg: "<path d=\"M5.5 4v9M2.5 10l3 3 3-3\"/><rect x=\"11.5\" y=\"9\" width=\"8\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M13.5 9V3.5h4V9\"/>" },
      { name: "Deck with USB", svg: "<rect x=\"3.5\" y=\"9\" width=\"13\" height=\"11.5\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"10\" cy=\"15\" r=\"3.6\"/><circle cx=\"10\" cy=\"15\" r=\"1\" fill=\"currentColor\"/><rect x=\"17.5\" y=\"10\" width=\"3.5\" height=\"8\" rx=\"1\" fill=\"currentColor\"/><path d=\"M18.5 10V7h1.5v3\"/>" },
      { name: "Verified stick", svg: "<rect x=\"5\" y=\"9\" width=\"11\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M7.5 9V3.5h6V9\"/><circle cx=\"17.5\" cy=\"7\" r=\"4\" fill=\"currentColor\"/><path d=\"M15.6 7l1.4 1.4 2.6-2.8\" stroke=\"var(--color-background)\"/>" },
      { name: "Stick with folder", svg: "<rect x=\"5.5\" y=\"9\" width=\"13\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M8 9V3.5h8V9\"/><path d=\"M8.5 13.5h2.6l1.2 1.3H15.5V19H8.5z\" fill=\"currentColor\"/>" },
      { name: "USB symbol", svg: "<path d=\"M12 3.5v16\"/><circle cx=\"12\" cy=\"21\" r=\"1.6\" fill=\"currentColor\"/><path d=\"M12 13L6.5 10.5V8.8M12 16l5-2.5V11\"/><circle cx=\"6.5\" cy=\"7.3\" r=\"1.6\" fill=\"currentColor\" fill-opacity=\".3\"/><rect x=\"14.8\" y=\"7.6\" width=\"4\" height=\"3.4\" rx=\"0.6\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M12 2l2 3h-4z\" fill=\"currentColor\"/>" },
      { name: "Hard drive", svg: "<rect x=\"3.5\" y=\"6.5\" width=\"17\" height=\"11\" rx=\"3\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M3.5 13h17\"/><circle cx=\"17\" cy=\"15.2\" r=\"1.1\" fill=\"currentColor\"/><path d=\"M7 15.2h5\"/>" },
      { name: "Connected", svg: "<rect x=\"8\" y=\"9\" width=\"8\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M10 9V3.5h4V9\"/><circle cx=\"12\" cy=\"15.5\" r=\"1.4\" fill=\"currentColor\"/><path d=\"M4.5 12.5a6 6 0 0 0 0 6M19.5 12.5a6 6 0 0 1 0 6\"/><path d=\"M2 10.5a10 10 0 0 0 0 10M22 10.5a10 10 0 0 1 0 10\" stroke-opacity=\".4\"/>" },
      { name: "Stick eject", svg: "<rect x=\"8\" y=\"2.5\" width=\"8\" height=\"10\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><circle cx=\"10.6\" cy=\"5.4\" r=\"0.7\" fill=\"currentColor\"/><circle cx=\"13.4\" cy=\"5.4\" r=\"0.7\" fill=\"currentColor\"/><path d=\"M7.5 19l4.5-4.5 4.5 4.5z\" fill=\"currentColor\"/><path d=\"M7 21.5h10\"/>" },
      { name: "Playlist stick", svg: "<rect x=\"5.5\" y=\"9\" width=\"13\" height=\"12\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".3\"/><path d=\"M8 9V3.5h8V9\"/><path d=\"M8.5 13.5h7M8.5 16.5h7M8.5 19h4\" stroke-width=\"1.8\"/>" },
    ],
  },
];

export type IconState = 'idle' | 'hover' | 'active' | 'pressed' | 'disabled';

export const ICON_STATES: { id: IconState; label: string; note: string }[] = [
  { id: 'idle', label: 'Idle', note: 'Not the current page' },
  { id: 'hover', label: 'Hover', note: 'Pointer is over it' },
  { id: 'active', label: 'Active', note: 'The current page: red gradient, drawn larger' },
  { id: 'pressed', label: 'Pressed', note: 'While it is being clicked' },
  { id: 'disabled', label: 'Disabled', note: 'Page unavailable' },
];

