import { useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { CloudUpload } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';

export function UploadDropzone({
  accept,
  multiple = true,
  onFiles,
  label = 'Drag and drop files here',
  helper = 'Supports MP3, WAV, AIFF, FLAC, AAC, M4A',
}: {
  accept?: string;
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
  label?: string;
  helper?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles?.(files);
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    emit(event.target.files);
    event.target.value = '';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    emit(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div
      className={cn('dd-dropzone', dragging && 'dd-dropzone--dragging')}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-describedby={`${inputId}-helper`}
    >
      <input ref={inputRef} id={inputId} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={onChange} onClick={(event) => event.stopPropagation()} tabIndex={-1} />
      <CloudUpload size={42} aria-hidden="true" />
      <strong>{label}</strong>
      <span>or <u>click to browse</u></span>
      <small id={`${inputId}-helper`}>{helper}</small>
      <span className="dd-feedback-button dd-feedback-button--ghost">BROWSE FILES</span>
    </div>
  );
}
