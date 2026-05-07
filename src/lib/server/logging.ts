import { db } from "#/db/index";
import { systemLogs, auditLogs } from "#/db/schema";
import type { AppUser } from "./auth";

export async function logSystemAction(
  user: AppUser | null,
  action: string,
  detail: string,
  status: "Success" | "Warning" | "Error" = "Success",
) {
  await db.insert(systemLogs).values({
    action,
    detail,
    userId: user?.id ?? null,
    userName: user?.name ?? "System",
    status,
  });
}

export async function logAudit(
  user: AppUser | null,
  tableName: string,
  recordId: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE",
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    tableName,
    recordId,
    action,
    oldValues: oldValues ?? null,
    newValues: newValues ?? null,
    userId: user?.id ?? null,
  });
}
