import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuth } from "#/lib/auth-context";
import { getCurrentUser } from "#/lib/server/auth";

/**
 * AuthSessionWatcher — re-validates the session against the live cookie and
 * keeps the UI from acting under a stale auth snapshot.
 *
 * Why this exists: the root route loader resolves the user once per page load
 * and seeds AuthProvider from it (src/routes/__root.tsx). RoleGuard and the
 * role-filtered navigation all read that snapshot. But the browser profile
 * shares ONE session cookie across tabs/windows, and every login flow
 * (email, branch PIN, non-branch PIN) overwrites it. If another tab signs in
 * as a different user while this tab sits in the background, this tab's
 * snapshot stays the old user — yet server functions (e.g. deleteIngredient)
 * re-read the live cookie on every call and enforce the *current* role. The
 * UI can therefore show actions the current session may not perform.
 *
 * Fix: on window focus / visibility / pageshow, fetch the current session
 * (same `getCurrentUser` the root loader uses, so it reflects exactly what
 * server actions will see). When the identity-relevant part of the session
 * differs from the snapshot — different user, role, status, branch, or
 * branch assignment, or signed-out vs signed-in — invalidate the router so
 * every active loader re-runs. The root loader then re-seeds AuthProvider
 * from the live session and RoleGuard / role homes re-evaluate, redirecting
 * the UI before it can act under the stale user.
 */
export function AuthSessionWatcher() {
  const router = useRouter();
  const { user: snapshotUser } = useAuth();

  // Always compare against the latest snapshot, even if the provider
  // re-renders while an async check is in flight.
  const snapshotRef = useRef(snapshotUser);
  snapshotRef.current = snapshotUser;

  // Dedupe overlapping checks (focus + visibilitychange can fire together).
  const checkingRef = useRef(false);

  const revalidateIfStale = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const liveUser = await getCurrentUser();
      if (sessionKey(liveUser) !== sessionKey(snapshotRef.current)) {
        await router.invalidate();
      }
    } catch {
      // Transient network/server failure — leave the UI as-is; the next
      // focus/visibility event retries.
    } finally {
      checkingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    const onWindowFocus = () => void revalidateIfStale();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidateIfStale();
    };
    // Fires on back/forward-cache restores, where focus may not re-fire.
    const onPageShow = () => void revalidateIfStale();

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [revalidateIfStale]);

  return null;
}

type SessionLike = {
  id: string;
  role: string;
  status: string;
  branchId?: string;
  assignedBranches?: string[];
} | null;

/**
 * Identity-relevant projection of a user. Deliberately excludes display-only
 * fields (name, email, pin) — the goal is detecting a *different* acting
 * session, not cosmetic drift. Both AuthUser (context snapshot) and AppUser
 * (getCurrentUser result) fit this shape.
 */
function sessionKey(user: SessionLike): string | null {
  if (!user) return null;
  return JSON.stringify([
    user.id,
    user.role,
    user.status,
    user.branchId ?? null,
    [...(user.assignedBranches ?? [])].sort(),
  ]);
}
