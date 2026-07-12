/**
 * The required `:param` slot names in a route or channel pattern: a `:name`
 * segment with no `?` (optional), `*` (rest-zero-or-more), or `+`
 * (rest-one-or-more) suffix, returned without the leading colon.
 *
 * Single-sourced so the room-key resolver (`resolveRoomKey`), the socket param
 * resolver (`resolveSocketParams`), and the boot route/channel congruence
 * check all agree on what "required" means.
 */
export function requiredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((seg) => {
      if (!seg.startsWith(':')) return false;
      const flag = seg[seg.length - 1];
      return flag !== '?' && flag !== '*' && flag !== '+';
    })
    .map((seg) => seg.slice(1));
}

/**
 * Every declared `:param` slot name in a route or channel pattern, INCLUDING
 * optional (`:name?`) and rest (`:name*`, `:name+`) slots, with the leading
 * colon AND the trailing flag stripped.
 *
 * Answers a different question from `requiredParamSlots`: "what is allowed to
 * be present" rather than "what must be present". Used to restrict a resolved
 * params object (parsed from the untrusted wire) to the pattern's own
 * declared slots, so a client cannot smuggle an undeclared key into
 * `ctx.location.pathParams` or `onJoin`'s params, a key no real HTTP request
 * could ever produce (Hono only populates declared slots).
 */
export function declaredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((seg) => seg.startsWith(':'))
    .map((seg) => {
      const flag = seg[seg.length - 1];
      const stripFlag = flag === '?' || flag === '*' || flag === '+';
      return seg.slice(1, stripFlag ? -1 : undefined);
    });
}
