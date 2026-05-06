# Page Transition Loading Feedback — Implementation Plan

## Problem

Page-to-page navigation feels laggy. The root cause is likely a combination of:

1. **Supabase round-trips** — every route `loader` and `useQuery` call hits the database over the network.
2. **No route-level pending state** — TanStack Router supports `defaultPendingComponent` and per-route `pendingComponent`, but neither is configured. When a user clicks a sidebar link, nothing visible happens until the new route's loader resolves and React commits the new tree.
3. **No global loading indicator** — there is no top-level progress bar or spinner that fires during navigation.

The result: users click a nav link, the UI appears frozen for 1–3 seconds, then the new page snaps in. This feels broken even if the data layer is working correctly.

---

## Solution Overview

Implement a **three-layer** loading feedback system:

| Layer                                                   | What it does                                                                         | Where                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **1. Global route pending component**                   | Full-page spinner shown while any route loader is pending                            | `src/router.tsx` (router config) + new `src/components/PageTransition.tsx` |
| **2. Top progress bar**                                 | Slim animated bar at the top of the viewport during navigation                       | New `src/components/TopProgressBar.tsx`, mounted in `__root.tsx`           |
| **3. Skeleton / spinner fallbacks on individual pages** | Replace raw `if (isLoading) return <Spinner />` blocks with content-shaped skeletons | Each page route (targeted list below)                                      |

Layer 1 is the highest-impact, lowest-effort change. Layer 2 adds polish. Layer 3 is optional nice-to-have for the heaviest pages.

---

## Layer 1 — Global Route `pendingComponent`

### Why

TanStack Router (v1.168+) has built-in support for a `defaultPendingComponent` on the router instance. When a route's loader is resolving, the router renders this component in place of the route's `component`. Combined with `pendingMs` (delay before showing the component, to avoid flash for fast navigations) and `pendingMinMs` (minimum display time, to avoid flicker), this gives us instant feedback on every single page transition with zero per-page changes.

### Steps

#### 1. Create `src/components/PageTransition.tsx`

A centered full-page spinner with the Omoiyari POS branding. Design:

- Full-height flex container (`min-h-screen`)
- Centered spinner (reuse the existing `h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent` pattern already used in `_layout.tsx` and `RoleGuard.tsx`)
- Optional: "Memuat..." text below the spinner
- Use `bg-background` so it matches the app shell

```tsx
// src/components/PageTransition.tsx
export default function PageTransition() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Memuat...</p>
    </div>
  );
}
```

#### 2. Update `src/router.tsx`

Add `defaultPendingComponent`, `pendingMs`, and `pendingMinMs` to the router config:

```ts
import PageTransition from "./components/PageTransition";

// Inside getRouter():
const router = createTanStackRouter({
  routeTree,
  context,
  scrollRestoration: true,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // NEW:
  defaultPendingComponent: PageTransition,
  pendingMs: 200, // don't show for navigations < 200ms (avoids flash)
  pendingMinMs: 300, // once shown, display for at least 300ms (avoids flicker)
});
```

**Rationale for timing values:**

- `pendingMs: 200` — Supabase queries over a fast connection often resolve in < 200ms. This prevents the spinner from flashing on and off for quick navigations.
- `pendingMinMs: 300` — If the spinner does appear, it should stay visible long enough for the user to perceive it. A 100ms flash is worse than no feedback at all.

These values can be tuned later. If the Supabase queries are consistently slow (> 500ms), consider lowering `pendingMs` to 100.

#### 3. (Optional) Per-route `pendingComponent` overrides

Some routes may want a custom pending component instead of the full-page spinner. For example, `/pos` could show a POS-specific loading screen. This is done by adding `pendingComponent` to individual route definitions:

```ts
// Example for pos.tsx only if a custom loader is added later:
export const Route = createFileRoute("/_layout/pos")({
  component: PosPage,
  pendingComponent: PosLoadingScreen, // optional override
});
```

**No per-route overrides are needed for the initial implementation.** The global `defaultPendingComponent` covers all routes.

---

## Layer 2 — Top Progress Bar

### Why

A progress bar (sometimes called a "nprogress" bar) is a well-known UX pattern (see: YouTube, GitHub, Medium). It gives the user a sense of forward progress even when the actual load time is unpredictable. It complements the spinner: the bar appears immediately on navigation start, and the spinner appears if the navigation takes longer than `pendingMs`.

### Steps

#### 1. Create `src/components/TopProgressBar.tsx`

A thin (3–4px) colored bar fixed to the top of the viewport. Behavior:

- Listens to TanStack Router's `router.state.isLoading` (or the `onRouteChange` / `onBeforeNavigate` events) to detect navigation start/end.
- On navigation start: animate the bar from 0% → 80% width (easing out).
- On navigation end: animate from current width → 100%, then fade out and reset.
- Use `position: fixed; top: 0; left: 0; z-index: 9999` so it's above everything.
- Use `bg-primary` to match the theme.
- Use CSS transitions for smooth animation (no external library needed).

Implementation approach using TanStack Router's `router.subscribe`:

```tsx
// src/components/TopProgressBar.tsx
import { useEffect, useState, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

export default function TopProgressBar() {
  const routerState = useRouterState();
  const isLoading = routerState.isLoading;
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (isLoading) {
      // Navigation started
      setVisible(true);
      setWidth(10);
      // Animate to 80% over 300ms
      timeoutRef.current = setTimeout(() => setWidth(80), 50);
    } else {
      // Navigation ended
      setWidth(100);
      // Wait for 100% animation to finish, then hide
      timeoutRef.current = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 z-[9999] h-1 w-full">
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
```

#### 2. Mount `TopProgressBar` in `src/routes/__root.tsx`

Add it inside the `<body>` tag, before the `<AuthProvider>`:

```tsx
<body className="font-sans antialiased wrap-anywhere">
  <TopProgressBar />
  <AuthProvider user={user ?? null} isLoading={false}>
    ...
  </AuthProvider>
  ...
</body>
```

---

## Layer 3 — Skeleton / Spinner Fallbacks on Individual Pages

### Why

The `defaultPendingComponent` (Layer 1) covers the **route transition** phase (loader resolving). But many pages also have **client-side queries** (`useQuery`) that fire after the route component mounts. For example, `dashboard.tsx` calls `getDashboardData()` in a `useQuery` inside the component. After the route loader resolves and the component renders, there's a second loading state while the client-side query fetches.

Currently, most pages handle this with a bare spinner:

```tsx
if (isLoading || !data) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
```

This works but is a bare, content-less void. Replacing these with **skeleton placeholders** that mimic the shape of the actual content (cards, table rows, chart areas) gives the user a stronger sense that the page is "assembling itself."

### Approach

For each page, replace the bare spinner with skeleton placeholders. Prioritize pages that are heaviest / most-affected:

#### Priority 1 — Heaviest pages (do first)

| Page                  | File                                      | Current loading pattern                                      | Skeleton shape                                             |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Dashboard             | `_layout/dashboard.tsx`                   | Spinner in `RoleGuard`                                       | 4 stat card skeletons + 2 chart skeletons + table skeleton |
| POS                   | `_layout/pos.tsx`                         | No client-side loading state (queries fire inside component) | Menu grid skeleton (5–6 card placeholders) + cart skeleton |
| Inventory             | `_layout/inventory/index.tsx`             | Uses `initialData` from loader, so less affected             | Table row skeletons (5 rows)                               |
| Purchase Requisitions | `_layout/purchase-requisitions/index.tsx` | Uses `initialData` from loader                               | Table row skeletons                                        |

#### Priority 2 — Medium pages

| Page           | File                               |
| -------------- | ---------------------------------- |
| Order History  | `_layout/order-history.tsx`        |
| Stock Opname   | `_layout/stock-opname/index.tsx`   |
| Waste          | `_layout/waste/index.tsx`          |
| Finance        | `_layout/finance/index.tsx`        |
| Delivery Notes | `_layout/delivery-notes/index.tsx` |
| SCM Invoices   | `_layout/scm-invoices/index.tsx`   |

#### Priority 3 — Lighter pages (do last or skip)

Admin CRUD pages (users, branches, brands, ingredients, recipes, etc.) tend to be lighter and use `initialData` from loaders. They benefit from Layer 1 already.

### Skeleton component

Create a reusable skeleton primitive in `src/components/ui/skeleton.tsx`:

```tsx
// src/components/ui/skeleton.tsx
import { cn } from "#/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
```

Then compose skeletons inline in each page. Example for a stats card:

```tsx
// Instead of:
<div className="flex items-center justify-center py-20">
  <div className="h-8 w-8 animate-spin ..." />
</div>

// Use:
<div className="grid grid-cols-1 gap-4 md:grid-cols-4">
  {Array.from({ length: 4 }).map((_, i) => (
    <div key={i} className="rounded-lg border p-4 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
    </div>
  ))}
</div>
```

---

## Files to Create

| File                                | Purpose                                         |
| ----------------------------------- | ----------------------------------------------- |
| `src/components/PageTransition.tsx` | Full-page spinner for `defaultPendingComponent` |
| `src/components/TopProgressBar.tsx` | Animated top progress bar                       |
| `src/components/ui/skeleton.tsx`    | Reusable skeleton primitive                     |

## Files to Modify

| File                                  | Change                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/router.tsx`                      | Add `defaultPendingComponent`, `pendingMs`, `pendingMinMs` |
| `src/routes/__root.tsx`               | Import and mount `<TopProgressBar />`                      |
| Each page route (priority list above) | Replace bare spinners with skeleton placeholders           |

---

## Implementation Order

1. **Create `PageTransition.tsx`** and **update `router.tsx`** — this alone solves 80% of the problem. One new file, one small edit.
2. **Create `TopProgressBar.tsx`** and **mount in `__root.tsx`** — adds the progress bar polish.
3. **Create `skeleton.tsx`** and **update pages one by one** — start with Dashboard and POS, then work through Priority 2 pages.

---

## Verification

After implementing Layers 1 + 2:

1. Run `vp dev` and log in.
2. Navigate between pages via the sidebar. Observe:
   - A progress bar appears at the top of the screen within ~50ms of clicking a nav link.
   - If the page takes > 200ms to load, a centered spinner with "Memuat..." text appears.
   - When the page finishes loading, the spinner and progress bar disappear smoothly.
3. Test on a slower network (Chrome DevTools → Network → Slow 3G) to confirm the feedback is visible and not flickering.
4. Test that fast navigations (< 200ms) do NOT show the spinner (no flash).

---

## Notes

- **Do NOT add `pendingComponent` to individual routes yet.** The global default is sufficient. Per-route overrides can be added later if specific pages need custom loading UIs.
- **Do NOT change any data fetching logic.** This plan is purely about UI feedback. The actual Supabase query performance is a separate concern.
- **The existing `isLoading` spinners inside page components should be kept** as a fallback, but enhanced with skeleton shapes (Layer 3). They handle the client-side `useQuery` loading state, which is separate from the route-level pending state.
- **`defaultPreload: "intent"` is already configured** in the router. This means TanStack Router preloads routes on hover/focus. Combined with `pendingMs: 200`, this means many navigations will be fast enough to skip the spinner entirely — which is the ideal UX.
