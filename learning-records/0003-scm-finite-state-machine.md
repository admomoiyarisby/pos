# SCM Finite State Machine Learning Record

The user clarified their redesigned SCM process as a formal finite state machine with distinct states, transition events, and actor ownership. This is a refinement beyond both the FRD and the current implementation — it adds a `Under Review` state that the FRD and code both skip over.

Key takeaways:
- The redesigned flow has **9 states** (Draft → Pending → Under Review → Rejected/In Transit → Delivered → Reviewing SJ → Waiting for Payment → Finished)
- Every transition is owned by exactly **one actor** — either BA or CA (Superadmin can do both)
- The "giant interactive table" pattern is reused at two states: `Under Review` (CA reviews PR items) and `Reviewing SJ` (BA receives SJ items)
- Real-time visibility (BA watching CA review) is a read-only render of the same table component, driven by `(state, actor)`
- The code should use a lookup-table FSM: `transitions[currentState][event] = { to, actor[], effects[] }`
- The invoice shows both accepted and rejected line items in one document
- The user explicitly agreed that the FSM table is the "single source of truth" and that each state × actor combination maps to a specific UI component
