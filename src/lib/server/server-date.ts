import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth";
import { todayDateInputValue } from "#/lib/utils";

/**
 * The server's Jakarta calendar day, as a `<input type="date">` value.
 *
 * Forms that ask for a day must not derive "today" from the device clock: a
 * tablet whose date runs ahead pre-fills tomorrow and the operator has to
 * correct it on every submission (Mulyorejo, Nov 2026). Defaulting from here —
 * and re-reading it when the form opens, since a tab can stay open across
 * midnight — keeps a broken device from choosing the day.
 */
export const getServerToday = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth();
  return todayDateInputValue();
});
