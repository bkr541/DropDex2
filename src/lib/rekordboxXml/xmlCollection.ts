import { NOT_REKORDBOX_XML } from './xmlHeader';

export interface XmlCollectionTrack {
  /** Original XML attributes, including fields not displayed in the summary. */
  values: Record<string, string>;
  index: number;
}

export function parseRekordboxXmlCollection(text: string): XmlCollectionTrack[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('Choose a standard Rekordbox XML export without document type declarations.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement?.tagName !== 'DJ_PLAYLISTS') {
    throw new Error(NOT_REKORDBOX_XML);
  }
  const root = document.documentElement;
  const collection = Array.from(root.childNodes).find((node) => node.nodeType === 1 && (node as Element).tagName === 'COLLECTION') as Element | undefined;
  if (!collection) throw new Error('This XML file does not contain a Rekordbox Collection.');
  return Array.from(collection.childNodes).filter((node) => node.nodeType === 1 && (node as Element).tagName === 'TRACK')
    .map((node, index) => ({ index, values: Object.fromEntries(Array.from((node as Element).attributes).map((attribute) => [attribute.name, attribute.value])) }));
}

/** Display the original file location without opening or checking the audio file. */
export function xmlTrackLocation(value: string | undefined): string {
  if (!value) return '';
  try {
    if (!/^file:/i.test(value)) return decodeURIComponent(value);
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    return url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${path}` : path.replace(/^\/([a-z]:\/)/i, '$1');
  } catch { return value; }
}

export function filterXmlCollection(tracks: readonly XmlCollectionTrack[], search: string, kind: string, sort: string) {
  const query = search.trim().toLocaleLowerCase();
  const visible = tracks.filter(({ values }) => (!kind || values.Kind === kind)
    && (!query || `${Object.values(values).join(' ')} ${xmlTrackLocation(values.Location)}`.toLocaleLowerCase().includes(query)));
  if (sort === 'name' || sort === 'artist') {
    const column = sort === 'name' ? 'Name' : 'Artist';
    visible.sort((a, b) => (a.values[column] ?? '').localeCompare(b.values[column] ?? '') || a.index - b.index);
  } else if (sort === 'newest' || sort === 'oldest') {
    visible.sort((a, b) => {
      const left = a.values.DateAdded, right = b.values.DateAdded;
      if (!left || !right) return left ? -1 : right ? 1 : a.index - b.index;
      return (sort === 'newest' ? right.localeCompare(left) : left.localeCompare(right)) || a.index - b.index;
    });
  }
  return visible;
}
