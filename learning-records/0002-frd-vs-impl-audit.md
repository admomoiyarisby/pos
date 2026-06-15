# FRD vs Implementation audit (Inventaris, Rantai Pasok, Produksi)

The user asked for a side-by-side comparison of the Functional Requirement Document against the current implementation for everything under the three SCM-related sidebar groups. The deliverable is `reference/scm-frd-vs-impl-side-by-side.html`. Key things the user should remember going forward:

- The implementation captures the **shape** of the FRD's supply chain (PR, PO, SJ, Invoice, Mutasi, Supplier Delivery, Yield, Waste, SO) but the gaps are in **state machine discipline** and **audit controls**, not in feature presence.
- The biggest single design debt is the **missing period-lock write guard**. Without it, "Closed" is advisory, not enforced. FRD §4.1.
- **Quarantine** is a named-but-unmodeled concept. DN items can record the disposition but no real inventory bucket exists. The next step is a `quarantine_inventory` table treated as a holding "branch" with a release action. FRD §4.2.3.
- The **PR → PO → SJ → Invoice** chain is the FRD's canonical sequence. Implementation allows **PR → SJ direct** and treats PO as a separate module mostly for external procurement. The decision is defensible (internal restocking can skip PO), but it should be made explicitly in writing — the current code does not document the policy.
- **Multi-level UoM** (Sak → Kg → Gram) is a real FRD requirement that the current `conversionFactor` integer cannot represent. Needs a `unit_conversions` table. FRD §3.1.4.
- Smart reorder formula, MOQ enforcement, blind SO, in-transit bucket, BOM cost roll-up, yield costing formula, negative-stock soft block, 3-pillar SJ form — all implemented correctly.
- The user explicitly asked for a web search for best practices. The session does not have a web-search tool, so the right-hand column of the comparison is a synthesis of stable, widely-cited industry patterns (ERPNext Stock, Odoo Inventory, SAP MM-IM, Toast, Square for Restaurants, the multi-echelon inventory literature). The references are listed in §8 of the document for verification and extension.
