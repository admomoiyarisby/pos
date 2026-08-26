export type VoucherStatus = "Active" | "Inactive" | "Deleted";
export type VoucherLifecycleAction = "deactivate" | "delete";

export function voucherActionForStatus(status: VoucherStatus): VoucherLifecycleAction | null {
  if (status === "Active") return "deactivate";
  if (status === "Inactive") return "delete";
  return null;
}
