import type { UserRole } from "./auth";

/**
 * Who may adjust current stock, and over which branches (ADR 0010).
 *
 * Super Admin is unrestricted. Area Manager is limited to the branches in
 * `area_manager_branches`; Admin Pusat is limited to Central-type branches,
 * the warehouse side of the business. Both limits are enforced server-side so
 * the modal's branch picker is a convenience, not the guard.
 */
export const STOCK_ADJUSTMENT_ROLES: UserRole[] = ["super_admin", "admin_pusat", "area_manager"];

export function assertAdjustmentBranchScope(
  actor: { role: UserRole; assignedBranches?: string[] | null },
  branchIds: string[],
  centralBranchIds: string[],
): void {
  if (actor.role === "super_admin") return;

  if (actor.role === "area_manager") {
    const assigned = actor.assignedBranches ?? [];
    if (assigned.length === 0) {
      throw new Error("Area Manager belum ditugaskan ke cabang mana pun");
    }
    const assignedSet = new Set(assigned);
    if (branchIds.some((id) => !assignedSet.has(id))) {
      throw new Error("Area Manager hanya bisa menyesuaikan stok cabang yang ditugaskan");
    }
    return;
  }

  if (actor.role === "admin_pusat") {
    const centralSet = new Set(centralBranchIds);
    if (centralSet.size === 0) {
      throw new Error("Belum ada Central Warehouse; penyesuaian stok tidak tersedia");
    }
    if (branchIds.some((id) => !centralSet.has(id))) {
      throw new Error("Admin Pusat hanya bisa menyesuaikan stok Central Warehouse");
    }
    return;
  }

  throw new Error(`Forbidden: role "${actor.role}" tidak boleh menyesuaikan stok`);
}
