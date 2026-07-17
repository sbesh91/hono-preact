export type Accept = 'html' | 'json' | 'event-stream';

type Candidate = { type: Accept; q: number };

/**
 * Parse an Accept header into the candidates this module understands
 * (json, event-stream, html), each with its resolved q-value. Unspecified
 * quality defaults to 1.0; unparseable q-values also default to 1.0.
 * Wildcards and text/html both map to html; unsupported media types are
 * dropped. Shared by `pickAccept` (which wins) and `acceptsEventStream`
 * (which only cares whether event-stream is present at all).
 */
function parseAcceptCandidates(header: string | undefined): Candidate[] {
  const h = header ?? '';
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

  return candidates;
}

/**
 * Content negotiation for action POSTs: chooses json (RPC), event-stream
 * (streaming action), or html (progressive-enhancement form post) from the
 * request's Accept header. Highest q-value wins; ties break by Accept order.
 * Wildcards and text/html map to html; unsupported media types are ignored.
 * Unspecified quality defaults to 1.0; an empty/missing header defaults to html.
 */
export function pickAccept(header: string | undefined): Accept {
  const candidates = parseAcceptCandidates(header);
  if (candidates.length === 0) return 'html';
  candidates.sort((a, b) => b.q - a.q);
  return candidates[0]!.type;
}

/**
 * Whether the client can accept an SSE response at all (any positive q),
 * regardless of which type WINS the negotiation. Streaming actions stream
 * whenever this is true; pickAccept still picks the shape of non-streaming
 * and error responses.
 */
export function acceptsEventStream(header: string | undefined): boolean {
  return parseAcceptCandidates(header).some(
    (c) => c.type === 'event-stream' && c.q > 0
  );
}
