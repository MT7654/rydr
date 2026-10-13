/**
 * Time helpers. All internal arithmetic is UTC epoch milliseconds.
 * Singapore is a fixed UTC+08:00 offset with no DST, so display conversion is exact.
 */

export const SINGAPORE_OFFSET_MINUTES = 480;

export function toEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable timestamp: ${iso}`);
  }
  return ms;
}

export function diffSeconds(fromIso: string, toIso: string): number {
  return Math.round((toEpochMs(toIso) - toEpochMs(fromIso)) / 1000);
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(toEpochMs(iso) + seconds * 1000).toISOString();
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Canonical storage form: UTC, offset-aware. */
export function toUtcIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Display form for the UI and exports: Asia/Singapore with an explicit +08:00.
 * Deliberately not using Intl so output is byte-stable regardless of host locale data.
 */
export function formatSingapore(iso: string, withSeconds = true): string {
  const ms = toEpochMs(iso) + SINGAPORE_OFFSET_MINUTES * 60_000;
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = withSeconds
    ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date} ${time} +08:00`;
}

export function formatDurationSeconds(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(Math.round(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}m ${pad(s)}s`;
}
