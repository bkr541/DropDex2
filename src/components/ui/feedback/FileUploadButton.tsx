import { useRef, type ReactNode } from 'react';
import { CircleFilled, FolderOpen, Mobile, Upload } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';

export type UploadButtonVariant = 'primary' | 'folder' | 'outline' | 'device';
export function FileUploadButton({
  variant = 'primary',
  children,
  onClick,
  onFiles,
  accept,
  multiple = true,
}: {
  variant?: UploadButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  onFiles?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const icon = variant === 'primary' ? <Upload size={14} /> : variant === 'folder' ? <FolderOpen size={14} /> : variant === 'device' ? <Mobile size={14} /> : <CircleFilled size={13} />;
  const handleClick = () => {
    if (onFiles) inputRef.current?.click();
    onClick?.();
  };
  return <>
    {onFiles && <input ref={inputRef} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length > 0) onFiles(files);
      event.target.value = '';
    }} />}
    <button type="button" className={cn('dd-upload-button', `dd-upload-button--${variant}`)} onClick={handleClick}>{icon}{children}</button>
  </>;
}
