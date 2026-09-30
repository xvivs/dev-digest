/** How often "Scanning… started X ago" re-reads the clock while a scan runs. */
export const SCANNING_TICK_MS = 5_000;

/** How often "last scan X ago" re-reads the clock; a minute-scale label needs no faster tick. */
export const LAST_SCAN_TICK_MS = 30_000;
