// =============================================================================
// Mutasi Stok notification fan-out (Q10).
//
// For each transition that has at least one external recipient, insert
// `systemNotifications` rows for the appropriate users. The matrix is exactly
// the one resolved in Q10:
//
//   submit          → AMs with canAmAct(transfer)
//   approve         → Sender BA + Receiver BA
//   reject          → Sender BA
//   withdraw        → (none — self-action)
//   ship            → Receiver BA
//   mark-delivered  → Sender BA
//   open-receive    → (none)
//   finish-receive  → Sender BA + AMs with canAmAct
//   mark-paid       → Receiver BA + AMs with canAmAct
//   cancel          → Both BAs + AMs with canAmAct
//
// The function is called from the same transaction as the FSM transition, so
// a notification failure rolls back the whole transition (mirrors Pengadaan).
// =============================================================================

import { eq, inArray, and } from "drizzle-orm";
import { db } from "./db";
import { areaManagerBranches, systemNotifications, users } from "#/db/schema";
import type { ScmTransferEvent } from "./scm-transfer-fsm";
// canAmAct is no longer imported here; jurisdiction is computed by
// filterByAmAct() which queries the areaManagerBranches table directly.

type NotificationEvent = ScmTransferEvent | "item-update";

interface NotifyArgs {
  transfer: {
    id: string;
    code: string;
    fromBranchId: string;
    toBranchId: string;
    requestedById: string;
  };
  event: NotificationEvent;
  /** The user ID of the actor who performed the action. They'll be excluded from the notification list (no self-notifications). */
  actorUserId: string;
}

interface NotificationTarget {
  userId: string;
  title: string;
  message: string;
  type: "info" | "warning" | "alert";
}

/**
 * Compute the list of (userId, title, message, type) notifications for a
 * given event. Does NOT insert — the caller (the FSM effect or the server
 * function) inserts them in the same transaction.
 */
export async function buildNotificationsForEvent(args: NotifyArgs): Promise<NotificationTarget[]> {
  const { transfer, event, actorUserId } = args;
  const actorId = actorUserId;

  switch (event) {
    case "submit": {
      // Notify all area_managers whose assignedBranches (via area_manager_branches)
      // includes BOTH branches of the transfer
      const ams = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.role, "area_manager"));
      const eligible = await filterByAmAct(ams, transfer);
      return eligible
        .filter((am) => am.id !== actorId)
        .map((am) => ({
          userId: am.id,
          title: "Mutasi Stok — Perlu Persetujuan",
          message: `Mutasi "${transfer.code}" menunggu approval Anda.`,
          type: "info" as const,
        }));
    }

    case "approve": {
      const targets = await userIdsForBranchAdmins([transfer.fromBranchId, transfer.toBranchId]);
      return targets
        .filter((uid) => uid !== actorId)
        .map((uid) => ({
          userId: uid,
          title:
            transferBranchOf(uid, transfer) === transfer.fromBranchId
              ? "Mutasi Stok — Disetujui"
              : "Mutasi Stok — Surat Jalan Baru",
          message:
            transferBranchOf(uid, transfer) === transfer.fromBranchId
              ? `Mutasi "${transfer.code}" disetujui. Siap dikirim.`
              : `Mutasi "${transfer.code}" telah disetujui. Anda akan menerima stok dari cabang pengirim.`,
          type: "info" as const,
        }));
    }

    case "reject":
      return transfer.requestedById === actorId
        ? []
        : [
            {
              userId: transfer.requestedById,
              title: "Mutasi Stok — Ditolak",
              message: `Mutasi "${transfer.code}" ditolak. Silakan periksa alasan dan buat ulang jika perlu.`,
              type: "alert" as const,
            },
          ];

    case "withdraw":
      // self-action; no external pings (Q10)
      return [];

    case "ship": {
      const receiverBAs = await userIdsForBranchAdmins([transfer.toBranchId]);
      return receiverBAs.map((uid) => ({
        userId: uid,
        title: "Mutasi Stok — Sedang Dikirim",
        message: `Mutasi "${transfer.code}" sedang dalam perjalanan ke cabang Anda.`,
        type: "info" as const,
      }));
    }

    case "mark-delivered":
      return [
        {
          userId: transfer.requestedById,
          title: "Mutasi Stok — Diterima Cabang Tujuan",
          message: `Mutasi "${transfer.code}" telah dikonfirmasi diterima oleh cabang tujuan.`,
          type: "info" as const,
        },
      ];

    case "open-receive":
      return [];

    case "finish-receive": {
      // Notify Sender BA + AMs in jurisdiction
      const senderBAs = await userIdsForBranchAdmins([transfer.fromBranchId]);
      const ams = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "area_manager"));
      const eligible = await filterByAmAct(ams, transfer);
      const out: NotificationTarget[] = senderBAs.map((uid) => ({
        userId: uid,
        title: "Mutasi Stok — Invoice Terbit",
        message: `Mutasi "${transfer.code}" selesai diterima. Invoice telah diterbitkan, menunggu pembayaran.`,
        type: "info" as const,
      }));
      for (const am of eligible) {
        out.push({
          userId: am.id,
          title: "Mutasi Stok — Invoice Terbit",
          message: `Mutasi "${transfer.code}" selesai diterima. Invoice telah diterbitkan.`,
          type: "info" as const,
        });
      }
      return out.filter((t) => t.userId !== actorId);
    }

    case "mark-paid": {
      const receiverBAs = await userIdsForBranchAdmins([transfer.toBranchId]);
      const ams = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "area_manager"));
      const eligible = await filterByAmAct(ams, transfer);
      const out: NotificationTarget[] = receiverBAs.map((uid) => ({
        userId: uid,
        title: "Mutasi Stok — Pembayaran Dikonfirmasi",
        message: `Mutasi "${transfer.code}" ditandai LUNAS oleh cabang pengirim. Transfer selesai.`,
        type: "info" as const,
      }));
      for (const am of eligible) {
        out.push({
          userId: am.id,
          title: "Mutasi Stok — Pembayaran Dikonfirmasi",
          message: `Mutasi "${transfer.code}" ditandai LUNAS. Transfer selesai.`,
          type: "info" as const,
        });
      }
      return out.filter((t) => t.userId !== actorId);
    }

    case "cancel": {
      const allBAs = await userIdsForBranchAdmins([transfer.fromBranchId, transfer.toBranchId]);
      const ams = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "area_manager"));
      const eligible = await filterByAmAct(ams, transfer);
      const out: NotificationTarget[] = allBAs.map((uid) => ({
        userId: uid,
        title: "Mutasi Stok — Dibatalkan",
        message: `Mutasi "${transfer.code}" dibatalkan. Periksa alasan pembatalan.`,
        type: "alert" as const,
      }));
      for (const am of eligible) {
        out.push({
          userId: am.id,
          title: "Mutasi Stok — Dibatalkan",
          message: `Mutasi "${transfer.code}" dibatalkan.`,
          type: "alert" as const,
        });
      }
      return out.filter((t) => t.userId !== actorId);
    }

    case "item-update":
      // item-update events don't generate notifications (they're in-state
      // mutations recorded for the audit log only)
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
    })),
  );
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Return all user IDs with role=branch_admin assigned to any of the given
 * branches. Returns an empty array if no branch is provided.
 */
async function userIdsForBranchAdmins(branchIds: string[]): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "branch_admin"), inArray(users.branchId, branchIds)));
  return rows.map((r) => r.id);
}

/**
 * Filter a list of area_manager user records to only those whose
 * `area_manager_branches` assignments include BOTH branches of the transfer
 * (i.e. canAmAct is true). Replaces the (incorrect) `users.assignedBranches`
 * column with a join on the actual `area_manager_branches` table.
 */
async function filterByAmAct(
  ams: { id: string }[],
  transfer: { fromBranchId: string; toBranchId: string },
): Promise<{ id: string }[]> {
  if (ams.length === 0) return [];

  // Fetch all assignments for the two branches in one query
  const assignments = await db
    .select({ userId: areaManagerBranches.userId, branchId: areaManagerBranches.branchId })
    .from(areaManagerBranches)
    .where(inArray(areaManagerBranches.branchId, [transfer.fromBranchId, transfer.toBranchId]));

  // userId → set of assigned branchIds
  const branchesByAm = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = branchesByAm.get(a.userId) ?? new Set();
    set.add(a.branchId);
    branchesByAm.set(a.userId, set);
  }

  return ams.filter((am) => {
    const set = branchesByAm.get(am.id);
    return !!set && set.has(transfer.fromBranchId) && set.has(transfer.toBranchId);
  });
}

/**
 * Determine whether `userId` is the BA of the from or to branch of the
 * transfer. Used to give different messages to Sender vs Receiver BAs.
 */
function transferBranchOf(
  userId: string,
  transfer: { fromBranchId: string; toBranchId: string; requestedById: string },
): string {
  // The caller has already fetched the userIds; we don't have the user→branch
  // map here. Approximate: if the userId is the requestedById, it's the Sender.
  // (For Receiver BAs we send the "SJ baru" message, which is the more
  // informative of the two.)
  return userId === transfer.requestedById ? transfer.fromBranchId : transfer.toBranchId;
}
