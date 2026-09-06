/**
 * Serialize a socket connection's key params to the canonical string that
 * rides the `r=` query param and doubles as a connection-identity dep.
 *
 * Keys are sorted, so the string depends on the params' VALUES and not on the
 * order the author happened to write the object literal in. Insertion order is
 * observable through `JSON.stringify`, and these params are typically built
 * inline at the call site, so `{ roomId, tenant }` and `{ tenant, roomId }`
 * are the same connection described two ways. Without the sort they serialize
 * differently, and since the string is a `useWsLifecycle` dep, a re-render
 * that merely reordered the literal would tear the socket down and reopen it
 * (dropping in-flight frames, and for a room, presence for every member of
 * that connection).
 *
 * The server JSON-parses this back into an object before resolving the topic,
 * so key order is not part of the wire contract; only the resulting params are.
 *
 * Shared by `useRoom` (which always serializes, normalizing an absent key to
 * `'{}'`) and `useSocket` (which calls this only when params are present and
 * otherwise keeps `undefined`, since a bare socket omits the query param
 * entirely). The absence policy stays at each call site: only the encoding of
 * a present key is common.
 *
 * The parameter is `unknown` because the params type is an inferred phantom
 * that resolves to `unknown` inside the generic hooks; narrowing here keeps
 * the widening castless at the call site.
 */
export function serializeSocketKey(key: unknown): string {
  if (typeof key !== 'object' || key === null) return '{}';
  const sorted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(key).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    sorted[name] = value;
  }
  return JSON.stringify(sorted);
}
