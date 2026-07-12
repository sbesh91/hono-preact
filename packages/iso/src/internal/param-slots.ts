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
