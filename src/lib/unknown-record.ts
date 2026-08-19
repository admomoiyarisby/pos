/**
 * A string-keyed record whose values are untyped.
 *
 * Named owner contract for deliberately loose shapes: audit-log diffs, generic
 * view props that render arbitrary rows, and JSON-ish payloads that are only
 * ever inspected field-by-field. Prefer a concrete domain type at boundaries
 * where the shape is actually known.
 */
export type UnknownRecord<V = unknown> = {
  [key: string]: V;
};
