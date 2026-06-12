export type Accept = 'html' | 'json' | 'event-stream';

/**
 * Content negotiation for action POSTs: chooses json (RPC), event-stream
 * (streaming action), or html (progressive-enhancement form post) from the
 * request's Accept header. Highest q-value wins; ties break by Accept order.
 * Wildcards and text/html map to html; unsupported media types are ignored.
 * Unspecified quality defaults to 1.0; an empty/missing header defaults to html.
 */
export function pickAccept(header: string | undefined): Accept {
  const h = header ?? '';
  type Candidate = { type: Accept; q: number };
  const candidates: Candidate[] = [];

  for (const part of h.split(',')) {
    const [mediaType, ...params] = part.trim().split(';');
    const mt = (mediaType ?? '').trim().toLowerCase();
    let q = 1.0;
    for (const p of params) {
      const kv = p.trim().split('=');
      if (kv[0]?.trim() === 'q' && kv[1] !== undefined) {
        const parsed = Number(kv[1].trim());
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (mt === 'text/event-stream')
      candidates.push({ type: 'event-stream', q });
    else if (mt === 'application/json') candidates.push({ type: 'json', q });
    else if (mt === 'text/html' || mt === '*/*')
      candidates.push({ type: 'html', q });
  }

  if (candidates.length === 0) return 'html';
  candidates.sort((a, b) => b.q - a.q);
  return candidates[0]!.type;
}
