// Server-side live preview of a comment draft, computed per message on the
// task page's draft-preview socket. Pure so it is unit-testable without a
// socket; the socket handler in task.server.ts just calls it and sends the
// result back on the same connection.
import { listUsers } from './data.js';

export type DraftPreview = {
  chars: number;
  words: number;
  /** Canonical names of demo users the draft @mentions, deduped. */
  mentions: string[];
};

const MENTION = /@([\p{L}][\p{L}\d-]*)/gu;

export function previewOf(draft: string): DraftPreview {
  const trimmed = draft.trim();
  const byName = new Map(
    listUsers().map((u) => [u.name.toLowerCase(), u.name] as const)
  );
  const mentions: string[] = [];
  for (const m of draft.matchAll(MENTION)) {
    const canonical = byName.get(m[1].toLowerCase());
    if (canonical && !mentions.includes(canonical)) mentions.push(canonical);
  }
  return {
    chars: draft.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    mentions,
  };
}
