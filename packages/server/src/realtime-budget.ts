// Runtime-neutral forward-header budget helpers. Shared by the Cloudflare glue
// (which throws over budget at connect time) and the Node path (which only
// dev-warns, since the Node transport does not ride the data through a header).
// Kept out of `cf/` so the Node path imports no Cloudflare-typed module.

/** Connections whose forwarded context exceeds this byte budget are denied on CF. */
export const MAX_FORWARD_HEADER_BYTES = 6 * 1024;

/** UTF-8 byte length of a string (header size is measured in bytes, not chars). */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Dev-only warning for a connection whose forwarded context would exceed the
 * Cloudflare forward budget at connect time. On Node the context never rides a
 * header, so it works locally and would only fail on deploy; this surfaces it
 * early. A no-op unless `dev` is true and a serialized segment is over budget.
 *
 * A room forwards BOTH its key `params` and its `data`, and Cloudflare budgets
 * each independently (see `cf/realtime-do-glue.ts`), so pass `params` for the
 * room path to warn on an over-budget key too. A socket has no params. An
 * `undefined` segment (e.g. a factory-less connection) is never over budget.
 */
export function warnIfOverForwardBudget(
  data: unknown,
  dev: boolean,
  kind: 'socket' | 'room',
  params?: unknown
): void {
  if (!dev) return;
  if (kind === 'room') warnSegmentOverBudget(params, kind, 'params');
  warnSegmentOverBudget(data, kind, 'data');
}

/** Warn if one forwarded segment (`params` or `data`) is over the byte budget. */
function warnSegmentOverBudget(
  value: unknown,
  kind: 'socket' | 'room',
  segment: 'params' | 'data'
): void {
  if (value === undefined) return;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    console.warn(
      `hono-preact: ${kind} connection ${segment} is not JSON-serializable and ` +
        'will fail the upgrade on Cloudflare (it rides a JSON-stringified header ' +
        'to the Durable Object).'
    );
    return;
  }
  if (json === undefined || byteLength(json) <= MAX_FORWARD_HEADER_BYTES)
    return;
  console.warn(
    `hono-preact: ${kind} connection ${segment} exceeds the ` +
      `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. It works on Node but will ` +
      'throw at connect time on Cloudflare (it rides a request header to the ' +
      'Durable Object). Keep it small.'
  );
}
