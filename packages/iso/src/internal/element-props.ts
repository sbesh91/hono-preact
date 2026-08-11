/**
 * `Omit` that distributes over a union instead of collapsing it.
 *
 * Preact types several intrinsic elements as a union discriminated on a
 * required attribute, so that `role` can be narrowed to the roles that element
 * legally accepts: `<a href>` takes `'link' | 'button' | 'menuitem' | ...`
 * rather than every `AriaRole`, and `<form>` takes
 * `'search' | 'form' | 'none' | 'presentation'`.
 *
 * A plain `Omit` over that union produces a single object type whose `role`
 * has widened back to the full `AriaRole`, which then fails to assign back to
 * the element it came from. Distributing preserves the arms, so a wrapper that
 * forwards props to `<a>` or `<form>` keeps the narrowing its callers should
 * see.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
