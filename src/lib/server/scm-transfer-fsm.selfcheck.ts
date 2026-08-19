/**
 * Self-check for the Mutasi Stok FSM transition table (ADR 0006).
 *
 * Run with: `npx tsx src/lib/server/scm-transfer-fsm.selfcheck.ts`
 *
 * Validates:
 * - Every (state, event) pair listed in the ADR has the right `to` state and
 *   `actors` list
 * - Every terminal state has no outgoing transitions
 * - The `super_admin` override is implicit (not a separate row in the table)
 * - The `availableTransferEvents` helper returns the right events per (state, role)
 *
 * Does NOT require a database — pure logic check. For DB-backed integration
 * tests, see Phase 3.
 */

import {
  type ScmTransferEvent,
  type ScmTransferStatus,
  type TransferActorRole,
  availableTransferEvents,
  transferTransitions,
} from "./scm-transfer-fsm";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

// --- Spec: the (state, event) -> { to, actors } map per ADR 0006 ---

type Spec = Partial<{
  [state in ScmTransferStatus]: Partial<{
    [event in ScmTransferEvent]: { to: ScmTransferStatus; actors: string[] };
  }>;
}>;

const SPEC: Spec = {
  SuratJalanDraft: {
    submit: { to: "PendingAMReview", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["branch_admin"] },
  },
  PendingAMReview: {
    approve: { to: "Approved", actors: ["area_manager"] },
    reject: { to: "Rejected", actors: ["area_manager"] },
    withdraw: { to: "SuratJalanDraft", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["branch_admin", "area_manager"] },
  },
  Approved: {
    ship: { to: "InTransit", actors: ["branch_admin"] },
    withdraw: { to: "SuratJalanDraft", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["branch_admin", "area_manager"] },
  },
  InTransit: {
    "mark-delivered": { to: "Delivered", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["area_manager"] },
  },
  Delivered: {
    "open-receive": { to: "ReviewingSJ", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["area_manager"] },
  },
  ReviewingSJ: {
    "finish-receive": { to: "WaitingForPayment", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["area_manager"] },
  },
  WaitingForPayment: {
    "mark-paid": { to: "Finished", actors: ["branch_admin"] },
    cancel: { to: "Cancelled", actors: ["area_manager"] },
  },
  // Terminal states: no outgoing transitions.
  Rejected: {},
  Finished: {},
  Cancelled: {},
};

const ALL_STATES: ScmTransferStatus[] = [
  "SuratJalanDraft",
  "PendingAMReview",
  "Approved",
  "InTransit",
  "Delivered",
  "ReviewingSJ",
  "WaitingForPayment",
  "Finished",
  "Rejected",
  "Cancelled",
];

export type ScmTransferEventMarker = ScmTransferEvent[]; // type-only marker

console.log("\n=== Mutasi Stok FSM self-check ===\n");

// 1. Every (state, event) in the spec exists in the table with the right to/actors.
for (const state of ALL_STATES) {
  // SAFETY: SPEC keys are declared as ScmTransferEvent via the Spec type; the
  // table lookup below fails loudly if a key isn't a real event.
  const expectedEvents = Object.keys(SPEC[state] ?? {}) as ScmTransferEvent[];
  const actualRules = transferTransitions[state] ?? {};

  for (const event of expectedEvents) {
    const spec = SPEC[state]![event]!;
    const rule = actualRules[event];
    const label = `${state} -> ${event} -> ${spec.to}`;
    if (!rule) {
      check(label, false, "transition is missing from the table");
      continue;
    }
    check(label, rule.to === spec.to, `expected to=${spec.to}, got ${rule.to}`);

    // Every actor in the spec must be allowed
    for (const actor of spec.actors) {
      // SAFETY: rule.actors is TransferActorRole[]; actor comes from the Spec's
      // string list and the includes() call is a membership check that stays
      // truthful at runtime.
      check(`${label} allows ${actor}`, rule.actors.includes(actor as TransferActorRole));
    }
    // And no extra actors (strict)
    const expectedActorSet = new Set(spec.actors);
    const actualActorSet = new Set(rule.actors);
    const extra = [...actualActorSet].filter((a) => !expectedActorSet.has(a));
    check(`${label} has no extra actors`, extra.length === 0, `extras: ${extra.join(", ")}`);
  }
}

// 2. No (state, event) exists in the table that isn't in the spec.
for (const state of ALL_STATES) {
  // SAFETY: both key sets are declared as ScmTransferEvent (Spec type and
  // transferTransitions table); the membership check validates them against
  // each other.
  const expectedEvents = new Set(Object.keys(SPEC[state] ?? {}) as ScmTransferEvent[]);
  // SAFETY: the transitions table is keyed by ScmTransferEvent literals; the
  // loop below checks every key against the spec, failing loudly otherwise.
  const actualEvents = Object.keys(transferTransitions[state] ?? {}) as ScmTransferEvent[];
  for (const event of actualEvents) {
    check(
      `${state} -> ${event} is in the spec`,
      expectedEvents.has(event),
      `unexpected transition in the table`,
    );
  }
}

// 3. Terminal states have no outgoing transitions.
for (const terminal of ["Rejected", "Finished", "Cancelled"] as const) {
  const rules = transferTransitions[terminal] ?? {};
  check(`Terminal ${terminal} has no outgoing transitions`, Object.keys(rules).length === 0);
}

// 4. `availableTransferEvents` returns the right events per (state, role).
//    Plus `super_admin` is allowed on every transition.
console.log("\n--- availableTransferEvents checks ---\n");
for (const state of ALL_STATES) {
  for (const role of ["branch_admin", "area_manager", "super_admin", "admin_pusat"] as const) {
    const events = availableTransferEvents(state, role);
    // SAFETY: SPEC keys are declared as ScmTransferEvent via the Spec type; the
    // comparison below verifies them against availableTransferEvents output.
    const expectedEvents = new Set(Object.keys(SPEC[state] ?? {}) as ScmTransferEvent[]);

    if (role === "super_admin") {
      // super_admin is allowed on every transition
      check(
        `super_admin sees all events in ${state}`,
        events.length === expectedEvents.size,
        `expected ${expectedEvents.size}, got ${events.length}`,
      );
    } else if (role === "admin_pusat") {
      // admin_pusat is never an actor on Mutasi
      check(`admin_pusat sees no events in ${state}`, events.length === 0);
    } else {
      // role matches the spec
      // SAFETY: SPEC entries are declared as ScmTransferEvent keys via the Spec
      // type; entries() widens to strings but the event names are literal.
      const allowedForRole = (
        Object.entries(SPEC[state] ?? {}) as [ScmTransferEvent, { actors: string[] }][]
      )
        .filter(([, s]) => s.actors.includes(role))
        .map(([e]) => e);
      check(
        `${role} sees ${JSON.stringify(allowedForRole)} in ${state}`,
        events.length === allowedForRole.length && allowedForRole.every((e) => events.includes(e)),
        `expected ${JSON.stringify(allowedForRole)}, got ${JSON.stringify(events)}`,
      );
    }
  }
}

console.log(`\n=== ${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s) ===\n`);
if (failures > 0) {
  process.exit(1);
}
