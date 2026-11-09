import { Fragment, useMemo, useState } from 'react';
import { NavArrowDown } from 'iconoir-react/regular';
import { filterXmlCollection, xmlTrackLocation, type XmlCollectionTrack } from '../../lib/rekordboxXml/xmlCollection';
import { LibraryFilterRow, recordOptions } from '../library/LibraryFilterRow';
import { ControlButton } from '../ui/controls';

const PAGE_SIZE = 50;

/** Reference view of an XML snapshot; it does not register audio tracks or require a USB. */
export function RekordboxXmlViewer({ tracks }: { tracks: readonly XmlCollectionTrack[] }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('xml');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const visible = useMemo(() => filterXmlCollection(tracks, search, kind, sort), [tracks, search, kind, sort]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <div className="profile-xml-viewer space-y-3">
    <LibraryFilterRow label="XML collection" placeholder="Search any field or file path…" search={search}
      onSearchChange={(value) => { setSearch(value); setPage(0); }} filters={[
        { label: 'File type', value: kind, onChange: (value) => { setKind(value); setPage(0); }, options: recordOptions(tracks.map(({ values }) => values.Kind)) },
        { label: 'Sort', value: sort, onChange: (value) => { setSort(value); setPage(0); }, options: [
          { value: 'xml', label: 'XML order' }, { value: 'newest', label: 'Date added: newest' },
          { value: 'oldest', label: 'Date added: oldest' }, { value: 'name', label: 'Track A–Z' }, { value: 'artist', label: 'Artist A–Z' },
        ] },
      ]} />
    <p className="text-xs text-muted-foreground" role="status">{visible.length.toLocaleString()} of {tracks.length.toLocaleString()} tracks · View values to inspect every XML track field.</p>
    {shown.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{tracks.length ? 'No tracks match your filters.' : 'This XML Collection contains no tracks.'}</p> : (
      <table className="profile-xml-table" aria-label="Rekordbox XML Collection">
        <thead><tr>{['Track', 'Artist', 'Date added', 'File location', 'Values'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{shown.map(({ values, index }) => <Fragment key={index}>
          <tr className="profile-xml-summary">
            <td data-label="Track">{values.Name || '—'}</td>
            <td data-label="Artist">{values.Artist || '—'}</td>
            <td data-label="Date added">{values.DateAdded || '—'}</td>
            <td data-label="File location" title={values.Location}>{xmlTrackLocation(values.Location) || '—'}</td>
            <td data-label="Values"><button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={expanded === index} aria-controls={`xml-values-${index}`} aria-label={`View values for ${values.Name || values.TrackID || 'track'}`}
              onClick={() => setExpanded(expanded === index ? null : index)}>
              View <NavArrowDown width={12} height={12} aria-hidden="true" />
            </button></td>
          </tr>
          {expanded === index && <tr id={`xml-values-${index}`} className="profile-xml-details"><td colSpan={5}>
            <dl className="profile-xml-values">{Object.entries(values).map(([name, value]) => <div key={name}>
              <dt>{name}</dt><dd>{value || '—'}</dd>
            </div>)}</dl>
          </td></tr>}
        </Fragment>)}</tbody>
      </table>
    )}
    {visible.length > PAGE_SIZE && <div className="flex flex-wrap items-center justify-between gap-2">
      <ControlButton variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</ControlButton>
      <span className="text-xs text-muted-foreground">Page {currentPage + 1} of {pages}</span>
      <ControlButton variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</ControlButton>
    </div>}
  </div>;
}
