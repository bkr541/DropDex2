/** What the top of a Rekordbox XML export says about the file. */
export interface RekordboxXmlHeader {
  /** Number of tracks in the collection, when the file says. */
  trackCount: number | null;
  /** The Rekordbox version that wrote it, when the file says. */
  rekordboxVersion: string | null;
}

export type RekordboxXmlCheck = { ok: true; header: RekordboxXmlHeader } | { ok: false; problem: string };

/** How much of the start of the file is read to check it. The details are all in the first few lines. */
export const XML_HEADER_BYTES = 64 * 1024;

export const NOT_REKORDBOX_XML = "That doesn't look like a Rekordbox XML file. In Rekordbox, use File > Export Collection in xml format, then choose that file.";

/** Checks the start of a file's text for the Rekordbox XML root element and reads the track count and version. */
export function parseRekordboxXmlHeader(text: string): RekordboxXmlCheck {
  if (!/<DJ_PLAYLISTS\b/.test(text)) return { ok: false, problem: NOT_REKORDBOX_XML };
  const entries = /<COLLECTION\b[^>]*\bEntries="(\d+)"/.exec(text)?.[1];
  const version = /<PRODUCT\b[^>]*\bVersion="([^"]*)"/.exec(text)?.[1];
  return { ok: true, header: { trackCount: entries == null ? null : Number(entries), rekordboxVersion: version || null } };
}

/** Reads the start of the chosen file and checks it. Never throws; a file that cannot be read gets a plain-language problem. */
export async function checkRekordboxXmlFile(file: Blob): Promise<RekordboxXmlCheck> {
  try {
    return parseRekordboxXmlHeader(await file.slice(0, XML_HEADER_BYTES).text());
  } catch {
    return { ok: false, problem: "DropDex couldn't read that file. Check that it still exists and try again." };
  }
}

/** A plain-language reason for an upload that the cloud refused. The raw message is logged separately. */
export function friendlyXmlUploadError(message: string): string {
  if (/maximum allowed size|payload too large|too large|413/i.test(message)) {
    return "That file is bigger than DropDex's cloud storage currently accepts.";
  }
  if (/mime|not supported|invalid file type/i.test(message)) return 'The cloud rejected that kind of file. Choose a Rekordbox XML file.';
  return "The file couldn't be saved. Check your connection and try again.";
}
