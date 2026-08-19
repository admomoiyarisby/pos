import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side persistence for "Unsaved Draft" screens (ADR 0011).
 *
 * A screen qualifies when it collects bulk, non-reconstructable data that lives
 * only in client state until an explicit submit (e.g. physical stock counts,
 * hand-keyed line items before the first server save). This hook debounces
 * writes to localStorage so a crash / tab-close / navigation does not lose the
 * user's work. The server remains the source of truth once the user submits;
 * these drafts are a *restore buffer*, not a data store.
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_DEBOUNCE_MS = 300;

interface DraftRecord<T> {
  state: T;
  updatedAt: number;
}

function readDraft<T>(key: string, ttlMs: number): DraftRecord<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    // SAFETY: the shape is validated immediately below (updatedAt finite,
    // `state` present); malformed payloads are treated as no draft.
    const rec = JSON.parse(raw) as DraftRecord<T>;
    if (rec == null || Number.isFinite(rec.updatedAt) === false || !("state" in rec)) {
      // Legacy / malformed payload — treat as no draft.
      return null;
    }
    if (Date.now() - rec.updatedAt > ttlMs) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return null;
    }
    return rec;
  } catch {
    // QuotaExceededError or storage unavailable — treat as no draft.
    return null;
  }
}

function writeDraft<T>(key: string, state: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ state, updatedAt: Date.now() } satisfies DraftRecord<T>),
    );
  } catch {
    // QuotaExceededError or storage unavailable — silently skip (no persistence).
  }
}

function clearDraftKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export type RestoreMode = "silent" | "prompt";

export interface UseUnsavedDraftOptions<T> {
  /** TTL before a stored draft is silently evicted. Default 7 days. */
  ttlMs?: number;
  /** Debounce (ms) before committing to localStorage. Default 300. */
  debounceMs?: number;
  /**
   * `silent` (default) — apply any stored draft on mount, no prompt. Use for
   *   entity-detail screens, where the draft is unambiguously "your work on this
   *   entity" (e.g. Stock Opname detail).
   * `prompt` — on cold load, hold the draft aside and expose it via `pendingDraft` +
   *   `hasPendingDraft`; the screen shows a Restore/Discard banner. Use for creation
   *   forms, where a stale draft may be from a previous, unrelated attempt. Once a
   *   decision is made in a browser session, reloads silently re-apply (sessionStorage).
   */
  restoreMode?: RestoreMode;
  /**
   * Optional predicate marking whether `state` has any user content. When false, the
   * draft is NOT written (and any existing empty draft is cleared) so that merely
   * visiting a creation form never seeds a spurious "restore?" prompt. If omitted,
   * every state is considered dirty.
   */
  isDirty?: (state: T) => boolean;
}

export interface UseUnsavedDraftResult<T> {
  state: T;
  setState: React.Dispatch<React.SetStateAction<T>>;
  /** Remove the draft from storage (call on successful submit / intentional cancel). */
  clear: () => void;
  /** Prompt mode: a non-expired draft was found on cold load and awaits a decision. */
  hasPendingDraft: boolean;
  /** Prompt mode: the held-back draft, or null. */
  pendingDraft: T | null;
  /**
   * Prompt mode: apply the pending draft to state. Pass a reconciled value to drop
   * items that no longer exist server-side (see ADR 0011 D5). Marks the session resolved.
   */
  restorePending: (value?: T) => void;
  /** Prompt mode: discard the pending draft and start blank. Marks the session resolved. */
  discardPending: () => void;
}

export function useUnsavedDraft<T>(
  key: string,
  fallback: T,
  options: UseUnsavedDraftOptions<T> = {},
): UseUnsavedDraftResult<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const restoreMode = options.restoreMode ?? "silent";
  const resolvedKey = `draft-resolved:${key}`;

  // Read the stored draft exactly once per mount.
  const initRef = useRef<DraftRecord<T> | null | undefined>(undefined);
  if (initRef.current === undefined) {
    initRef.current = readDraft<T>(key, ttlMs);
  }
  const initRec = initRef.current;

  const [state, setState] = useState<T>(() => {
    if (!initRec) return fallback;
    if (restoreMode === "silent") return initRec.state;
    // prompt mode: auto-apply only if already resolved earlier this session
    try {
      if (sessionStorage.getItem(resolvedKey)) return initRec.state;
    } catch {
      /* ignore */
    }
    return fallback;
  });

  const [pendingDraft, setPendingDraft] = useState<T | null>(() => {
    if (restoreMode !== "prompt" || !initRec) return null;
    try {
      if (sessionStorage.getItem(resolvedKey)) return null;
    } catch {
      /* ignore */
    }
    return initRec.state;
  });

  // Latest-value refs so the unmount flush and debounced save read current state
  // without re-subscribing the effect on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef(pendingDraft);
  pendingRef.current = pendingDraft;
  const isDirtyRef = useRef(options.isDirty);
  isDirtyRef.current = options.isDirty;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced persistence. Suppressed while a prompt is pending so the held-back
  // draft is never clobbered by typing on the still-blank form.
  useEffect(() => {
    if (pendingDraft !== null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const dirty = isDirtyRef.current;
      if (dirty && !dirty(stateRef.current)) {
        clearDraftKey(key);
      } else {
        writeDraft(key, stateRef.current);
      }
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, pendingDraft, key, debounceMs]);

  // Flush on unmount so the last keystrokes within the debounce window are not lost.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (pendingRef.current === null) {
          const dirty = isDirtyRef.current;
          if (dirty && !dirty(stateRef.current)) clearDraftKey(key);
          else writeDraft(key, stateRef.current);
        }
      }
    };
  }, [key]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    clearDraftKey(key);
  }, [key]);

  const restorePending = useCallback(
    (value?: T) => {
      setState(value ?? pendingDraft ?? fallback);
      setPendingDraft(null);
      try {
        sessionStorage.setItem(resolvedKey, "1");
      } catch {
        /* ignore */
      }
    },
    [pendingDraft, fallback, resolvedKey],
  );

  const discardPending = useCallback(() => {
    clearDraftKey(key);
    setPendingDraft(null);
    try {
      sessionStorage.setItem(resolvedKey, "1");
    } catch {
      /* ignore */
    }
  }, [key, resolvedKey]);

  return {
    state,
    setState,
    clear,
    hasPendingDraft: pendingDraft !== null,
    pendingDraft,
    restorePending,
    discardPending,
  };
}
