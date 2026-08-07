/**
 * Shallow structural equality: same reference, or the same own enumerable
 * entries compared by identity one level deep.
 *
 * This exists for signal writes whose SOURCE is a render expression. A value
 * built inline (`data?.movies ?? []`, `items.filter(...)`, `{ ...state }`) is a
 * fresh reference on every render while holding identical contents, and a
 * signal write always notifies. Gating the write on reference equality
 * therefore republishes an unchanged value and wakes every bound consumer, so
 * the comparison has to be over contents.
 *
 * Deliberately NOT recursive. The cost has to stay proportional to what a
 * render just built, and one level is what separates "rebuilt the container"
 * (common, inert) from "the data changed" (rare, must publish). A nested
 * rebuild reads as a change, which is the safe direction to be wrong in: an
 * extra notification is a wasted render, a missed one is stale UI.
 *
 * Non-plain objects (Map, Set, Date, class instances) compare by identity.
 * They carry their contents somewhere other than own enumerable keys, so a
 * key-wise comparison would call any two of them equal, which is the unsafe
 * direction.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const x = a as readonly unknown[];
    const y = b as readonly unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (!Object.is(x[i], y[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    // `hasOwn` before the read: a missing key whose value would be `undefined`
    // must not compare equal to a present `undefined`, or `{a: undefined}` and
    // `{}` collapse (they have different key counts here, but `{a: 1, b: u}`
    // versus `{a: 1, c: u}` would not).
    if (!Object.hasOwn(b, k)) return false;
    if (!Object.is(a[k as keyof typeof a], b[k as keyof typeof b]))
      return false;
  }
  return true;
}

/**
 * A plain object literal or a null-prototype bag, as distinct from a Map, a
 * Date, or a class instance. Written as a predicate so the indexed reads above
 * need no cast.
 */
function isPlainObject(v: object): v is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
