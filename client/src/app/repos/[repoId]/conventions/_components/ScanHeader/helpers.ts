/* Pure formatting for the scan stats strip (AC-34). */

/** `850ms`, `42s`, `1m 12s`. Null (a scan still running, or an old row) has no duration. */
export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** `950`, `12.3k`, `1.2M`: compact token counts. */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
