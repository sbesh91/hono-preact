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
 * Dev-only warning for a data-factory result that would exceed the forward
 * budget on Cloudflare. On Node the result never rides a header, so it works
 * locally and would only fail on deploy; this surfaces it early. A no-op unless
 * `dev` is true and the serialized result is over budget. `undefined` (a
 * factory-less connection) is never over budget.
 */
export function warnIfOverForwardBudget(
  data: unknown,
  dev: boolean,
  kind: 'socket' | 'room'
): void {
  if (!dev || data === undefined) return;
  const json = JSON.stringify(data);
  if (json === undefined || byteLength(json) <= MAX_FORWARD_HEADER_BYTES)
    return;
  console.warn(
    `hono-preact: ${kind} connection data exceeds the ` +
      `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. It works on Node but will ` +
      'throw at connect time on Cloudflare (the data rides a request header to ' +
      'the Durable Object). Keep the data factory result small.'
  );
}
