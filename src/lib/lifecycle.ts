// ============================================================
// Small, pure lifecycle helper.
//
// The big document machines (Pengadaan, Mutasi) have their own
// transaction-aware FSM modules because they run effects. The small
// machines — vouchers, recipes, ingredients, invoices, users, supplier
// deliveries, returns — only need an edge table plus one guard, and
// that is what this provides.
//
// `defineLifecycle` is typed: an edge can only target a declared state,
// and every state key is checked. The runtime test in lifecycles.test.ts
// adds reachability and terminal-state checks for every definition.
// ============================================================

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly event: string,
    message?: string,
  ) {
    super(message ?? `Cannot ${event} ${entity} from ${from}`);
    this.name = "LifecycleTransitionError";
  }
}

export interface LifecycleDefinition<State extends string, Event extends string> {
  /** Human label used in the default error message, e.g. "voucher". */
  entity: string;
  states: readonly State[];
  /** Every event this machine can fire. Listed so `Event` is inferable from
   *  the call site (mapped-type keys alone infer as `never`). */
  events: readonly Event[];
  /** States a new record may start in (used by the self-check). */
  initialStates: readonly State[];
  transitions: {
    [state in State]?: {
      [event in Event]?: State;
    };
  };
}

export interface Lifecycle<State extends string, Event extends string> {
  readonly entity: string;
  readonly states: readonly State[];
  readonly events: readonly Event[];
  readonly initialStates: readonly State[];
  /** True when the edge exists. */
  can(from: State, event: Event): boolean;
  /** Target state for the edge, or undefined when it does not exist. */
  to(from: State, event: Event): State | undefined;
  /**
   * Target state for the edge, throwing when it does not exist.
   * `message` overrides the default error for callers with better copy.
   */
  assert(from: State, event: Event, message?: string): State;
  eventsFrom(from: State): Event[];
  targetsFrom(from: State): State[];
  isTerminal(from: State): boolean;
}

export function defineLifecycle<State extends string, Event extends string>(
  definition: LifecycleDefinition<State, Event>,
): Lifecycle<State, Event> {
  const { entity, states, events, initialStates, transitions } = definition;

  function rule(from: State, event: Event): State | undefined {
    return transitions[from]?.[event];
  }

  return {
    entity,
    states,
    events,
    initialStates,

    can(from, event) {
      return rule(from, event) !== undefined;
    },

    to(from, event) {
      return rule(from, event);
    },

    assert(from, event, message) {
      const target = rule(from, event);
      if (target === undefined) throw new LifecycleTransitionError(entity, from, event, message);
      return target;
    },

    eventsFrom(from) {
      // SAFETY: the transition map is typed with State keys and Event keys; the
      // cast restores the event key type that Object.keys widens to string.
      return Object.keys(transitions[from] ?? {}) as Event[];
    },

    targetsFrom(from) {
      // SAFETY: same typed table; every value is a declared State.
      return Object.values(transitions[from] ?? {}) as State[];
    },

    isTerminal(from) {
      return Object.keys(transitions[from] ?? {}).length === 0;
    },
  };
}
