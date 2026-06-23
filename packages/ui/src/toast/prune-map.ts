/**
 * Delete every entry of `map` whose key is not in `liveIds`.
 *
 * The Toaster keeps id-keyed registries (last-announced text, measured heights)
 * across the app lifetime. Without pruning, an entry leaks for every toast ever
 * shown. This drops the entries for toasts that have left the store, keeping the
 * registries bounded by the live toast set.
 */
export function pruneMapToIds<K, V>(
  map: Map<K, V>,
  liveIds: ReadonlySet<K>
): void {
  for (const key of map.keys()) {
    if (!liveIds.has(key)) map.delete(key);
  }
}
