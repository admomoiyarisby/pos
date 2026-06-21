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
 * Thrown by the `ship` effect handler when the Sender's current inventory for
 * an ingredient is below the item's `quantity`. This is a strict invariant:
 * the FSM refuses to deduct inventory that isn't there. The caller (server fn)
 * maps this to a user-facing error message.
 *
 * This error is unique to Mutasi (vs. Pengadaan) because the Sender is a
 * branch with bounded inventory. Central warehouses in Pengadaan have
 * theoretically unbounded stock, so the same check is unnecessary.
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
