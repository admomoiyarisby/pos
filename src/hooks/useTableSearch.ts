import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Read the free-text Table Search term out of a loosely-typed search object.
 * See ADR 0008 — the term lives under the `search` key, normalised to "".
 */
function readSearch(search: { search?: unknown }): string {
  // URL search values arrive as `unknown` (string, absent, or occasionally an
  // array/number). A search term is a single string; anything else is "".
  return z.string().catch("").parse(search.search);
}

export interface UseTableSearchOptions {
  /**
   * Debounce (ms) before committing the term to the URL. Use ~250 for
   * server-backed searches so we don't navigate (and refetch) per keystroke.
   * Client-filtered DataTable pages should leave this at 0 (instant local filter).
   */
  debounceMs?: number;
}

/**
 * URL-persisted, controlled Table Search (ADR 0008).
 *
 * Returns `[value, setValue]` to pass straight into `<DataTable search=… onSearchChange=…>`.
 * Writing goes through `navigate({ search: (prev) => ({ ...prev, search }), replace: true })`,
 * so sibling URL params (`status`, `negative`, `noInvestigation`) are preserved. An empty
 * term is written as `undefined` so the URL stays clean. The local `value` also re-syncs
 * when the URL changes externally (back/forward, shared link).
 */
export function useTableSearch(options: UseTableSearchOptions = {}) {
  const debounceMs = options.debounceMs ?? 0;
  const navigate = useNavigate();
  const urlSearch = useSearch({ strict: false });
  const urlValue = readSearch(urlSearch);

  const [value, setValue] = useState(urlValue);

  // Re-sync the input when the URL changes out from under us (back/forward, deep link).
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setValue(urlValue);
  }, [urlValue]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setSearch = useCallback(
    (next: string) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      const commit = () => {
        // SAFETY: the merged object preserves every existing search param and
        // only updates the `search` key; navigate accepts the widened shape.
        // Reset page to 0 when search changes so results start at first page.
        const nextSearch = {
          ...urlSearch,
          search: next || undefined,
          page: undefined,
        } as never;
        void navigate({ search: nextSearch, replace: true });
      };

      if (debounceMs > 0) {
        timer.current = setTimeout(commit, debounceMs);
      } else {
        commit();
      }
    },
    [debounceMs, navigate, urlSearch],
  );

  return [value, setSearch, urlValue] as const;
}

/**
 * Shared `validateSearch` factory for table-list routes. Empty string is
 * normalised to `undefined` so `?search=` is omitted from the URL when empty.
 */
export function tableSearchValidation(search: { search?: unknown }) {
  // Same boundary parse as readSearch: only a string term is meaningful, and
  // an empty term is normalised to `undefined` so `?search=` is omitted.
  return {
    search: z.string().catch("").parse(search.search) || undefined,
  };
}
