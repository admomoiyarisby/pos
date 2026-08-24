import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { searchStringParam } from "#/lib/utils";
import type { UnknownRecord } from "#/lib/unknown-record";

export interface TableSortState {
  key: string;
  dir: "asc" | "desc";
}

/**
 * URL-persisted table state: page, sort, and arbitrary filter params.
 *
 * Extends ADR-0008's search-only persistence to the full "where I was in the
 * table" state. Because every param lives in the URL query string, the list
 * page restores the exact page/sort/filter when the user comes back from a
 * detail page (via history.back or a preserved query string), reloads, or
 * opens a shared link. Search remains on `useTableSearch`; both hooks write
 * with the merge-update pattern so sibling params are preserved.
 *
 * Writes use `replace: true` so paginating doesn't spam the history stack.
 */
export function useTableUrlState<F extends Record<string, string | number | null | undefined>>(
  filterKeys: (keyof F)[] = [],
) {
  const navigate = useNavigate();
  const urlSearch = useSearch({ strict: false });
  // SAFETY: URL search params arrive as `unknown`; the route's typed search
  // schema only declares a subset (e.g. search/status), so widen to a loose
  // record to read page/sort/filter keys that live outside it.
  const loose: UnknownRecord = urlSearch as UnknownRecord;

  // Page: absent / non-numeric → 0 (the default, so it's omitted from the URL).
  const page = z.coerce.number().int().min(0).catch(0).parse(loose.page);

  // Sort: sortKey + sortDir. Only a valid (key, dir) pair is a real sort.
  const sortKey = searchStringParam(loose, "sortKey");
  const sortDirRaw = searchStringParam(loose, "sortDir");
  const sort: TableSortState | null =
    sortKey && (sortDirRaw === "asc" || sortDirRaw === "desc")
      ? { key: sortKey, dir: sortDirRaw }
      : null;

  // Filters: each declared key is read as an optional string.
  // SAFETY: the object starts empty and every key is populated below from the
  // same string-ish filterKeys, so the widened F shape is fully owned.
  const filters = {} as F;
  for (const key of filterKeys) {
    // SAFETY: URL search params are strings when present; each declared filter
    // key is a string-ish value owned by F, so the loose-record write below
    // only touches keys the caller declared (no widening of known shape).
    (filters as UnknownRecord<string | undefined>)[String(key)] = searchStringParam(
      loose,
      String(key),
    );
  }

  const commit = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      void navigate({
        search: (prev) => {
          const next: UnknownRecord = { ...prev };
          for (const [k, v] of Object.entries(patch)) {
            // Empty / default values are omitted so the URL stays clean.
            if (v === undefined || v === null || v === "") {
              delete next[k];
            } else {
              next[k] = v;
            }
          }
          // Page 0 is the default → omit.
          if (next.page === 0) delete next.page;
          // SAFETY: we only add/remove string/number keys we own; navigate
          // accepts the widened search shape.
          return next as never;
        },
        replace: true,
      });
    },
    [navigate],
  );

  const setPage = useCallback((p: number) => commit({ page: Math.max(0, p) }), [commit]);

  const setSort = useCallback(
    (s: TableSortState | null) => commit({ sortKey: s?.key, sortDir: s?.dir, page: undefined }),
    [commit],
  );

  const setFilter = useCallback(
    (key: keyof F, value: string | number | null | undefined) => commit({ [String(key)]: value }),
    [commit],
  );

  return { page, setPage, sort, setSort, filters, setFilter, urlSearch };
}
