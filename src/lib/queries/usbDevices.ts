import { supabase } from '../supabase';
import { deviceKeyFor } from '../usb/usbFormat';
import type { DesktopTransferFile, DesktopTransferResult, DesktopUsbDetails } from '../../types/dropdex-desktop';

export interface UsbDeviceRecord {
  id: string;
  deviceKey: string;
  label: string;
  nickname: string | null;
  brand: string | null;
  model: string | null;
  filesystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  retiredAt: string | null;
}

export interface UsbTransferRecord {
  id: string;
  sourceDeviceId: string | null;
  destinationDeviceId: string | null;
  sourceLabel: string;
  destinationLabel: string;
  categories: string[];
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  copiedCount: number;
  skippedCount: number;
  failedCount: number;
  totalBytes: number;
  files: DesktopTransferFile[];
  filesTruncated: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

interface DeviceRow {
  id: string; device_key: string; label: string; nickname: string | null; brand: string | null; model: string | null;
  filesystem: string | null; total_bytes: number | string | null; free_bytes: number | string | null;
  first_seen_at: string; last_seen_at: string; retired_at: string | null;
}

interface TransferRow {
  id: string; source_device_id: string | null; destination_device_id: string | null; source_label: string; destination_label: string;
  categories: string[] | null; status: UsbTransferRecord['status']; copied_count: number; skipped_count: number; failed_count: number;
  total_bytes: number | string; files: DesktopTransferFile[] | null; files_truncated: boolean; error: string | null;
  started_at: string; finished_at: string;
}

const toNumber = (value: number | string | null): number | null => (value == null ? null : Number(value));

export function toDeviceRecord(row: DeviceRow): UsbDeviceRecord {
  return {
    id: row.id, deviceKey: row.device_key, label: row.label, nickname: row.nickname, brand: row.brand, model: row.model,
    filesystem: row.filesystem, totalBytes: toNumber(row.total_bytes), freeBytes: toNumber(row.free_bytes),
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, retiredAt: row.retired_at,
  };
}

export function toTransferRecord(row: TransferRow): UsbTransferRecord {
  return {
    id: row.id, sourceDeviceId: row.source_device_id, destinationDeviceId: row.destination_device_id,
    sourceLabel: row.source_label, destinationLabel: row.destination_label, categories: row.categories ?? [], status: row.status,
    copiedCount: row.copied_count, skippedCount: row.skipped_count, failedCount: row.failed_count, totalBytes: Number(row.total_bytes),
    files: Array.isArray(row.files) ? row.files : [], filesTruncated: row.files_truncated, error: row.error,
    startedAt: row.started_at, finishedAt: row.finished_at,
  };
}

export async function fetchUsbDevices(): Promise<UsbDeviceRecord[]> {
  const { data, error } = await supabase.from('user_usb_devices').select('*').order('last_seen_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as DeviceRow[]).map(toDeviceRecord);
}

/** Remembers a drive the first time it is seen and refreshes its size and last-seen time after that. Un-retires it if it comes back. */
export async function rememberUsbDevice(userId: string, details: DesktopUsbDetails): Promise<UsbDeviceRecord> {
  const { data, error } = await supabase
    .from('user_usb_devices')
    .upsert({
      user_id: userId,
      device_key: deviceKeyFor(details),
      label: details.volumeName,
      brand: details.brand,
      model: details.model,
      filesystem: details.filesystem,
      total_bytes: details.totalBytes,
      free_bytes: details.freeBytes,
      last_seen_at: new Date().toISOString(),
      retired_at: null,
    }, { onConflict: 'user_id,device_key' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toDeviceRecord(data as DeviceRow);
}

export async function renameUsbDevice(deviceId: string, nickname: string | null): Promise<void> {
  const { error } = await supabase.from('user_usb_devices').update({ nickname: nickname?.trim() || null }).eq('id', deviceId);
  if (error) throw new Error(error.message);
}

export async function setUsbDeviceRetired(deviceId: string, retired: boolean): Promise<void> {
  const { error } = await supabase.from('user_usb_devices').update({ retired_at: retired ? new Date().toISOString() : null }).eq('id', deviceId);
  if (error) throw new Error(error.message);
}

export async function fetchUsbTransfers(limit = 100): Promise<UsbTransferRecord[]> {
  const { data, error } = await supabase.from('usb_transfers').select('*').order('finished_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as TransferRow[]).map(toTransferRecord);
}

export async function recordUsbTransfer(
  userId: string,
  result: DesktopTransferResult,
  sourceDeviceId: string | null,
  destinationDeviceId: string | null,
): Promise<void> {
  const { error } = await supabase.from('usb_transfers').insert({
    user_id: userId,
    source_device_id: sourceDeviceId,
    destination_device_id: destinationDeviceId,
    source_label: result.sourceVolumeName ?? 'Unknown USB',
    destination_label: result.destinationVolumeName ?? 'Unknown USB',
    categories: result.categories,
    status: result.status,
    copied_count: result.copied,
    skipped_count: result.skipped,
    failed_count: result.failed,
    total_bytes: result.bytes,
    files: result.files,
    files_truncated: result.filesTruncated,
    error: result.error,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
  });
  if (error) throw new Error(error.message);
}
