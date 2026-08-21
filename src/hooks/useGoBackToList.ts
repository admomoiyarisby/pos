import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Navigate back to a list page from a detail page.
 *
 * Prefers `history.back()` so the browser restores the exact prior list URL —
 * including the URL-persisted page/sort/filter params (useTableUrlState) —
 * instead of landing on page 1. Falls back to `to` when there's no prior
 * history entry (e.g. the user deep-linked straight to the detail page).
 */
export function useGoBackToList(to: string) {
  const navigate = useNavigate();

  return useCallback(() => {
    // SAFETY: history.state is `any` in the DOM lib; the router sets `idx` on
    // navigations, and the null/undefined cases are handled below.
    const state = window.history.state as { idx?: number } | null;
    const idx = state?.idx;
    if (idx != null && Number.isFinite(idx) && idx > 0) {
      window.history.back();
    } else if (idx === 0) {
      void navigate({ to });
    } else {
      window.history.back();
    }
  }, [navigate, to]);
}
