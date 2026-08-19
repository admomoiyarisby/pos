// =============================================================================
// SCM Procurement notification fan-out.
//
// For each transition that has at least one external recipient, insert
// `systemNotifications` rows for the appropriate users. The matrix:
//
//   submit          → all admin_pusat + super_admin (urgent)
//   open-review     → requesting BA (normal)
//   accept-and-ship → requesting BA (normal)
//   mark-delivered  → all admin_pusat + super_admin (normal)
//   finish-receive  → all admin_pusat + super_admin (urgent)
//   mark-paid       → requesting BA (normal)
//   reject          → requesting BA (alert)
//   cancel          → the other party + admin_pusat (alert)
//   withdraw        → (none — self-action)
//   open-receive    → (none)
//
// The function is called from the same transaction as the FSM transition, so
// a notification failure rolls back the whole transition.
// =============================================================================

import { inArray } from "drizzle-orm";
import { db } from "./db";
import { systemNotifications, users, USER_ROLE_VALUES } from "#/db/schema";
import type { ScmProcurementEvent } from "./scm-fsm";

type NotificationEvent = ScmProcurementEvent;

interface NotifyArgs {
  procurement: {
    id: string;
    code: string;
    branchId: string;
    requestedById: string;
  };
  event: NotificationEvent;
  actorUserId: string;
}

interface NotificationTarget {
  userId: string;
  title: string;
  message: string;
  type: "info" | "warning" | "alert";
  priority: "normal" | "urgent";
}

/**
 * Compute the list of (userId, title, message, type, priority) notifications
 * for a given event. Does NOT insert — the caller inserts them in the same
 * transaction.
 */
export async function buildNotificationsForEvent(args: NotifyArgs): Promise<NotificationTarget[]> {
  const { procurement, event, actorUserId } = args;
  const actorId = actorUserId;

  switch (event) {
    case "submit": {
      // Notify all admin_pusat + super_admin (urgent — needs review)
      const targets = await userIdsForRoles(["admin_pusat", "super_admin"]);
      return targets
        .filter((uid) => uid !== actorId)
        .map((uid) => ({
          userId: uid,
          title: "Pengadaan Baru — Perlu Review",
          message: `Pengadaan "${procurement.code}" menunggu review Anda.`,
          type: "info" as const,
          priority: "urgent" as const,
        }));
    }

    case "open-review": {
      // Notify the requesting BA — review started
      return [
        {
          userId: procurement.requestedById,
          title: "Pengadaan — Sedang Direview",
          message: `Pengadaan "${procurement.code}" sedang direview oleh Admin Pusat.`,
          type: "info" as const,
          priority: "normal" as const,
        },
      ].filter((t) => t.userId !== actorId);
    }

    case "accept-and-ship": {
      // Notify the requesting BA — goods shipped
      return [
        {
          userId: procurement.requestedById,
          title: "Pengadaan — Sedang Dikirim",
          message: `Pengadaan "${procurement.code}" sedang dalam perjalanan ke cabang Anda.`,
          type: "info" as const,
          priority: "normal" as const,
        },
      ].filter((t) => t.userId !== actorId);
    }

    case "mark-delivered": {
      // Notify all admin_pusat + super_admin — branch confirmed delivery
      const targets = await userIdsForRoles(["admin_pusat", "super_admin"]);
      return targets
        .filter((uid) => uid !== actorId)
        .map((uid) => ({
          userId: uid,
          title: "Pengadaan — Diterima Cabang",
          message: `Pengadaan "${procurement.code}" telah dikonfirmasi diterima oleh cabang.`,
          type: "info" as const,
          priority: "normal" as const,
        }));
    }

    case "finish-receive": {
      // Notify all admin_pusat + super_admin (urgent — invoice generated, payment needed)
      const targets = await userIdsForRoles(["admin_pusat", "super_admin"]);
      return targets
        .filter((uid) => uid !== actorId)
        .map((uid) => ({
          userId: uid,
          title: "Pengadaan — Invoice Terbit",
          message: `Pengadaan "${procurement.code}" selesai diterima. Invoice telah diterbitkan, menunggu pembayaran.`,
          type: "warning" as const,
          priority: "urgent" as const,
        }));
    }

    case "mark-paid": {
      // Notify the requesting BA — payment confirmed
      return [
        {
          userId: procurement.requestedById,
          title: "Pengadaan — Lunas",
          message: `Pengadaan "${procurement.code}" telah dibayar. Terima kasih!`,
          type: "info" as const,
          priority: "normal" as const,
        },
      ].filter((t) => t.userId !== actorId);
    }

    case "reject": {
      // Notify the requesting BA — rejected
      return [
        {
          userId: procurement.requestedById,
          title: "Pengadaan — Ditolak",
          message: `Pengadaan "${procurement.code}" ditolak. Silakan periksa alasan dan buat ulang jika perlu.`,
          type: "alert" as const,
          priority: "normal" as const,
        },
      ].filter((t) => t.userId !== actorId);
    }

    case "cancel": {
      // Notify the other party + admin_pusat
      const targets = await userIdsForRoles(["admin_pusat", "super_admin"]);
      const recipientIds = new Set([...targets, procurement.requestedById]);
      return Array.from(recipientIds)
        .filter((uid) => uid !== actorId)
        .map((uid) => ({
          userId: uid,
          title: "Pengadaan — Dibatalkan",
          message: `Pengadaan "${procurement.code}" dibatalkan. Periksa alasan pembatalan.`,
          type: "alert" as const,
          priority: "normal" as const,
        }));
    }

    case "withdraw":
      // self-action; no external pings
      return [];

    case "open-receive":
      // internal step; no notification
      return [];
  }
}

/**
 * Insert all the notifications computed by `buildNotificationsForEvent`.
 * Use this from inside a transaction (e.g. the FSM transition) so a
 * notification failure rolls back the whole state change.
 */
export async function insertNotifications(
  targets: NotificationTarget[],
  tx?: { insert: typeof db.insert },
): Promise<void> {
  if (targets.length === 0) return;
  const inserter = (tx ?? db).insert(systemNotifications);
  await inserter.values(
    targets.map((t) => ({
      userId: t.userId,
      title: t.title,
      message: t.message,
      type: t.type,
      priority: t.priority,
    })),
  );
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Return all user IDs with one of the given roles.
 */
async function userIdsForRoles(roles: (typeof USER_ROLE_VALUES)[number][]): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.role, roles));
  return rows.map((r) => r.id);
}
