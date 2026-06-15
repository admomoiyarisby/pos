# NOTES

## User preferences

- **Lessons should include Mermaid charts** showing the current (implemented) flow alongside the intended (FRD) flow. Charts are the primary way the user wants to spot the gap between spec and code. Apply to every new lesson; retrofit existing lessons when relevant.

- **Output style for the SCM learning workspace:** the user is the Business Owner of Omoiyari. They want supply-chain lessons that are grounded in the local FRD and codebase first, not in generic theory. Use the FRD section numbers as the citation key (e.g., "FRD §4.2.2"). When the implementation diverges from the FRD, name the divergence explicitly and link to the exact file/line.

- **Best-practice column** on comparisons is acceptable as a synthesis of widely-cited industry patterns (ERPNext, Odoo, SAP MM-IM, Toast, Square for Restaurants, the multi-echelon inventory literature) when a web search is not available. The user values transparency about the source. Label the column as "Industry Pattern" or "Best Practice (synthesized)" — never imply a live web search happened.

- **Reference documents over lessons** for the audit-style comparisons. Lessons are for the iterative learning loop. The big side-by-side audits belong in `reference/`.
