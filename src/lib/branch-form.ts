import { z } from "zod";
import { formText } from "./utils";

/**
 * Payload builders for the branch edit sheet.
 *
 * The sheet's tabs each render their own <form>, so each needs its own builder:
 * a builder may only read fields its form actually renders. Reading a field from
 * the other tab yields "", which is harmless for the optional contact strings but
 * throws on the required `type` enum — and a throw inside a submit handler means
 * the mutation never runs and the button looks dead.
 */

const BRANCH_TYPES = ["Central", "Outlet"] as const;

export function branchInfoPayload(branchId: string, fd: FormData) {
  return {
    id: branchId,
    code: formText(fd, "code"),
    name: formText(fd, "name"),
    location: formText(fd, "location"),
    type: z.enum(BRANCH_TYPES).parse(formText(fd, "type")),
  };
}

export function branchContactPayload(branchId: string, fd: FormData) {
  // Omitting a field (rather than sending "") leaves the stored value untouched:
  // the server filters null/undefined out of the update.
  return {
    id: branchId,
    pin: formText(fd, "pin").trim() || undefined,
    phone: formText(fd, "phone").trim() || undefined,
    complaintPhone: formText(fd, "complaintPhone").trim() || undefined,
  };
}
