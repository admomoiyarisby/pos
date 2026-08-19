// =============================================================================
// Mutasi Stok FSM Errors (ADR 0006)
// =============================================================================

export class TransferNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Mutasi transfer ${id} not found`);
    this.name = "TransferNotFoundError";
  }
}

export class InvalidTransferTransitionError extends Error {
  constructor(
    public readonly fromState: string,
    public readonly event: string,
  ) {
    super(`Cannot ${event} a Mutasi transfer from ${fromState}`);
    this.name = "InvalidTransferTransitionError";
  }
}

export class TransferUnauthorizedError extends Error {
  constructor(
    public readonly actorRole: string,
    public readonly event: string,
  ) {
    super(`${actorRole} is not authorized to perform ${event} on a Mutasi transfer`);
    this.name = "TransferUnauthorizedError";
  }
}

export class InvalidTransferStateForEditError extends Error {
  constructor(
    public readonly state: string,
    public readonly editType: string,
  ) {
    super(`Cannot ${editType} on a Mutasi transfer in state ${state}`);
    this.name = "InvalidTransferStateForEditError";
  }
}

/**
 * Marker wrapper for errors thrown by Mutasi effect handlers (issue #90).
 * Mirrors `EffectFailedError` in `scm-fsm.ts`: the wrapper is thrown out of
 * the transaction callback (rolling back the transition) and converted into
 * a `{ success: false }` result by `transitionTransfer`.
 */
export class TransferEffectFailedError extends Error {
  constructor(err: Error) {
    super(err.message);
    this.name = err.name;
  }
}

/**
 * Thrown by the `ship` effect handler when the Sender's current inventory for
 * an ingredient is below the item's `quantity`. This is a strict invariant:
 * the FSM refuses to deduct inventory that isn't there. The caller (server fn)
 * maps this to a user-facing error message.
 *
 * Pengadaan has its own equivalent (`ProcurementInsufficientStockError` in
 * `scm-effects.ts`) thrown by `accept-and-ship` — the system tracks Central's
 * stock as a concrete quantity, so the same invariant applies there.
 */
export class InsufficientStockError extends Error {
  constructor(
    public readonly ingredientId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient stock for ingredient ${ingredientId}: requested ${requested}, available ${available}`,
    );
    this.name = "InsufficientStockError";
  }
}
