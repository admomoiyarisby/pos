# Unsaved Draft Client-Side Persistence

Screens that collect bulk, non-reconstructable data (physical stock counts, hand-keyed line items before the first server save) must persist their in-progress state to `localStorage` so that a browser crash, tab close, or page navigation does not lose the user's work. The persistence is a client-side buffer only — the server remains the source of truth once the user submits.

## Context

The Stock Opname detail page (`stock-opname/$soId`) was the first screen to need this: a counter physically walks a warehouse and types 100+ physical counts that exist nowhere else. Losing them means re-walking the warehouse. The page already had an inlined `loadSoCache`/`saveSoCache`/`clearSoCache` implementation. This ADR generalises that pattern to other qualifying screens and extracts a shared hook.

## Qualifying Criterion

A screen gets client-side persistence only if it meets **both** tests:

1. **Bulk client-only entry** — many rows or a large form held only in component state until an explicit submit.
2. **Non-reconstructable** — the data cannot be re-fetched or re-derived (physical counts, hand observations), as distinct from data transcribed from a source document (e.g. recipe specs, which can be re-entered from paper).

Screens where each edit is already server-backed (e.g. procurement detail review, where `readyQuantity` persists per-keystroke) or where the entry is a single quick record (e.g. waste entry, manual adjustment) do not qualify.

## Status

Accepted

## Considered Options

**D1 — Storage mechanism**

- **localStorage (CHOSEN)** — synchronous, trivial API, already proven in the SO page. Payloads are small (SO ~5 KB, creation forms <1 KB); the 5 MB quota is never touched.
- _IndexedDB_ — async, structured clone, handles large blobs. Overkill for our payloads and would force async loading plumbing into every consumer.

**D2 — Cache key for creation forms (no server ID)**

- **`draft:${userId}:${routePath}` — one slot per route per user (CHOSEN)** — stable across reload and tab-close. A user gets exactly one pending creation-draft per creation route; starting a new attempt when an old draft exists triggers a restore/discard prompt.
- _Route-path + sessionStorage nonce_ — a per-attempt nonce in `sessionStorage` gives each attempt its own slot, but `sessionStorage` dies on tab-close, defeating the purpose.
- _(implicitly rejected)_ Server-side draft IDs — turning "new" into "create empty draft on server, edit it" is a larger architecture change out of scope here.

For entity-detail screens (SO detail), the key is the entity ID: `so-edit-${soId}`. One draft per entity, stable and unique.

**D3 — Restore UX**

- **Creation forms: prompt with explicit consent (CHOSEN)** — on cold load, if a draft exists, show a dismissable banner: "Anda memiliki draft sebelumnya yang belum disimpan. Pulihkan? [Ya] [Buang]". The user explicitly confirms the data is from a previous attempt, not a fresh default.
- **Entity-detail screens (SO): silent restore (CHOSEN)** — the entity identity is fixed; the draft is unambiguously "your work on this SO". No prompt needed.
- _Silent restore everywhere_ — risk of the user submitting a stale creation draft without realising it's from a previous attempt.
- _Start blank + "Restore" button_ — least surprising but the button is easy to miss, defeating the purpose.

After the user picks "restore" (or starts typing) and reloads mid-session, the restore is silent — the prompt appears only on cold load, tracked by a `useRef` flag in the hook.

**D4 — Eviction / TTL**

- **7-day TTL, checked on read (CHOSEN)** — each draft record stores `updatedAt`; on read, if older than 7 days, the draft is silently discarded. Applies to both creation and SO detail drafts. An SO sitting in "Submitted" or "Under Investigation" for more than a week likely has stale counts (stock has moved); re-prompting with ancient numbers is a footgun.
- _No TTL, clear on successful save only_ — a draft from months ago still triggers the restore prompt. Confusing, especially on shared/kiosk machines.
- _TTL + cap on number of drafts_ — with one slot per route per user and ~3 qualifying routes, a user has at most a handful of drafts (~20 KB total). A cap adds complexity for no real protection.

**D5 — Stale-data reconciliation**

- **Creation forms: reconcile + warn (CHOSEN)** — on restore, filter the draft's `items` against the live `getIngredients` list. Drop items whose `ingredientId` no longer exists and show a visible notice (e.g. `toast.warning`) listing what was removed, so the user can re-add a replacement.
- **SO detail: no explicit reconciliation** — `physicalInputs` is keyed by `item.id` and rendered from the server's `detail.items`. New server items show empty + untouched; orphaned cache entries are never rendered and excluded from the submit payload. Naturally resilient.
- _Restore as-is, let server reject on submit_ — user hits a confusing error at submit time instead of learning upfront what changed.

**D6 — Shared hook vs. inlined per screen**

- **Extract `useUnsavedDraft<T>(key, fallback)` shared hook (CHOSEN)** — owns debounce (300 ms), TTL check, quota-guarded read/write/clear, and a `hasRestoredDraft` flag for the restore prompt. Each screen provides its own key, shape `T`, and clear triggers. The SO page is refactored onto it too, so there is exactly one pattern (mirroring how `useTableSearch()` was extracted in ADR 0008).
- _Keep inlined per screen_ — three+ copies of debounce + TTL + quota logic that drift independently.

**D7 — Explicit "clear draft" button on creation forms**

- **No explicit clear button (CHOSEN)** — the existing "Hapus Semua Bahan" (procurement) and per-item trash buttons (mutasi) already let users bulk-clear items; the debounced save persists the emptied state. The restore/discard prompt (D3) is the only explicit draft-management affordance.
- _Add "Bersihkan Draft" button_ — more UI clutter for a rare action already covered by existing delete controls.

## Scope

Three screens qualify today:

1. **Stock Opname detail** (`stock-opname/$soId`) — already implemented; refactored onto the shared hook.
2. **Procurement creation** (`scm-procurements/new`) — items, notes, requestSource in local state until "Simpan sebagai Draft".
3. **Mutasi Stok creation** (`scm-transfers/new`) — items, fromBranchId, toBranchId, notes in local state until create.

**Out of scope:**

- **Recipe creation** (`RecipeWizard`) — 4-step, ~15 fields, bulk client-only entry (test 1 ✅) but the data is transcribed from a product spec / recipe card, not captured from physical reality (test 2 ❌). If the multi-step cost is the real concern, the better fix is per-step "Simpan" (`onSavePage` already provides this in edit mode), not localStorage persistence.
- **Procurement/Mutasi detail review forms** — each `readyQuantity` edit already hits the server per-keystroke.
- **Waste entry, manual stock adjustment, POS cart** — single quick records; loss is annoying, not catastrophic.
- **Recipe/ingredient/modifier-group detail editing** — small forms, re-derivable from source.

## Consequences

- New shared hook: `src/hooks/useUnsavedDraft.ts` (generic over `T`, owns debounce/TTL/quota/prompt-flag).
- New shared component: `<RestoreDraftBanner>` (or inline in each creation form) for the restore/discard prompt.
- The SO detail page's `loadSoCache`/`saveSoCache`/`clearSoCache` module-level functions are replaced by `useUnsavedDraft` — the `physicalInputs`/`touchedItems` split stays in the component; the hook persists/restores the combined blob.
- All drafts include an `updatedAt` timestamp; reads check the 7-day TTL and silently discard expired entries.
- Creation forms gain a reconcile-and-warn step on restore: draft items are filtered against the live ingredient list, and dropped items are surfaced via `toast.warning()`.
- `localStorage` reads must treat `QuotaExceededError` as "no draft" (not a crash); writes are wrapped in try/catch (the SO page already does this).
