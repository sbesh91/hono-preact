// In-memory audit ring for the demo: per-process like the rest of the demo
// store, capped so a long-lived dev server cannot grow it unbounded. Written
// by the app-level stream observer; read by the audit registry loader.
type AuditEntry = { at: number; line: string };

const MAX_ENTRIES = 50;
const entries: AuditEntry[] = [];

export function recordAudit(line: string): void {
  entries.push({ at: Date.now(), line });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function recentAudit(limit = 20): string[] {
  return entries
    .slice(-limit)
    .reverse()
    .map((e) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.line}`);
}

export function resetAudit(): void {
  entries.length = 0;
}
