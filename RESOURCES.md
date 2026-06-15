# Omoiyari POS Supply Chain Resources

## Knowledge

- [Functional Requirement Document](docs/Functional%20Requirement%20Document.md)
  Product source of truth for the intended SCM, inventory, reordering, period close, and role behavior. Use for: deciding how the system is supposed to work.
- [SCM server implementation](src/lib/server/scm.ts)
  Current implementation of PR, PO, Surat Jalan, invoice, and stock transfer state transitions. Use for: understanding what the application actually does.
- [Database schema](src/db/schema.ts)
  Table definitions for inventory, in-transit inventory, ledger, PR, PO, delivery notes, and SCM invoices. Use for: tracing persistent state.
- [Smart reordering implementation](src/lib/server/reorder.ts)
  Current ROP/ROQ calculation and MOQ rounding behavior. Use for: understanding how recommendations become PR quantities.
- [In-transit inventory concept](https://en.wikipedia.org/wiki/Merge_in_transit)
  General logistics background that reinforces the project’s idea that goods can be neither source stock nor destination stock while travelling. Use lightly; local code is the authority for this app.

## Wisdom (Communities)

- Project maintainers and operators
  Best source for resolving policy choices not fully specified in the FRD, especially rejected goods, quarantine handling, and whether PO is required in internal distribution.

## Gaps

- No explicit local business decision document yet for whether PO is mandatory in the internal branch restocking path or optional alongside auto-created Surat Jalan.
- No explicit local decision document yet for how Quarantine inventory should be represented beyond delivery-note item fields and ledger notes.
