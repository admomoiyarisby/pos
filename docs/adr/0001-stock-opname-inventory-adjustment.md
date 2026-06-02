# Stock Opname Inventory Adjustment Strategy

When a Stock Opname (SO) is approved, the system adjusts inventory to match the physical count by comparing physical stock against *current* inventory at approval time — not against the frozen system stock captured at trigger time.

## Context

The `systemStock` in SO items is frozen when the SO is triggered. However, inventory continues to change between trigger and approval (new SCM deliveries, order deductions, waste entries). If we adjusted inventory based on the frozen system stock, we would lose track of all intermediate movements.

**Example of the bug this prevents:**
- SO triggered: inventory = 100 kg, systemStock = 100
- New delivery arrives: inventory becomes 120 kg
- Physical count: 115 kg
- Naive approach (set inventory = physical): inventory = 115 (loses 20 kg delivery!)
- Correct approach (variance = 115 - 120 = -5): inventory = 120 - 5 = 115

## Decision

1. **Physical stock is the source of truth** upon approval. The formula is:
   - `variance = physicalStock - currentInventory`
   - `inventory = physicalStock`

2. **System stock is display-only.** It shows the supervisor what the system believed at trigger time, for investigation purposes. It is NOT used in inventory adjustment calculations.

3. **Status flow is supervisor-driven.** Submitting an SO does not automatically set "Under Investigation" for variance. The supervisor reviews and decides whether investigation is warranted.

4. **Investigation loop.** When status is "Under Investigation," Branch Admin can update counts. Supervisor reviews again. This loops until supervisor approves. All actions are logged in audit trail.

5. **Blind SO is role-based.** Branch Admin and Admin Pusat cannot see system stock or variance. Super Admin and Area Manager can see both.

6. **Countable items only.** Only ingredients with `countable === true` are included in SO. Uncountable items (opened packs, individual pcs) are excluded.

7. **Branch filtering is server-side enforced.** Admin Pusat can only see/trigger SO for Central Warehouse. Area Manager can only see/trigger SO for assigned branches.

## Considered Options

- **Frozen system stock for adjustment:** Rejected because it would lose intermediate inventory movements.
- **Auto "Under Investigation" on any variance:** Rejected because 0.1% variance shouldn't block approval. Supervisor should decide.
- **Per-item investigation notes:** Rejected in favor of per-SO notes for simplicity. Can be revisited if needed.

## Consequences

- Inventory adjustments may differ from what the system stock at trigger time would suggest. This is intentional — the physical count reflects reality.
- Supervisors must actively review all SO submissions rather than relying on automatic investigation flags.
- Audit logs are critical for tracking the investigation loop between Branch Admin and supervisor.
