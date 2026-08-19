/**
 * Look up a display label (or other mapped value) by a runtime string key.
 *
 * Label maps are declared with `satisfies` so their keys stay literal and their
 * values stay typed; this function is the one widening read a dynamic key
 * requires, and it owns that boundary. Returns `undefined` when the key is
 * absent, mirroring plain `map[key]` on an open dictionary.
 */
export function lookupLabel<K extends PropertyKey, V>(
  table: Record<K, V>,
  key: string | number,
): V | undefined {
  // SAFETY: the map's keys are string literals (checked via `satisfies`); the K
  // cast only narrows for the indexed read, and an absent key yields undefined.
  return (table as Record<string, V>)[key];
}
