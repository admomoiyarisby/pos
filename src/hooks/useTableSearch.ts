import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

/**
 * Read the free-text Table Search term out of a loosely-typed search object.
 * See ADR 0008 — the term lives under the `search` key, normalised to "".
 */
function readSearch(search: unknown): string {
  if (search && typeof search === "object" && "search" in search) {
    const v = (search as Record<string, unknown>).search;
    return typeof v === "string" ? v : "";
  }
  return "";
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
        void navigate({
          search: { ...(urlSearch as Record<string, unknown>), search: next || undefined } as never,
          replace: true,
        });
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
export function tableSearchValidation(search: Record<string, unknown>) {
  const raw = search.search;
  return {
    search: typeof raw === "string" && raw.length > 0 ? raw : undefined,
  };
}
