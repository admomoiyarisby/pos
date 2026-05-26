# Product

## Register

product

## Users

The system serves five distinct roles across a ghost kitchen operation:

- **Kasir (branch_admin)** — On the floor, serving customers. Their entire world is the POS screen, shift management, and daily stock intake. They work fast, often under pressure during rush hours, and need a UI that gets out of their way. One branch, one session.
- **Super Admin** — The business owner. Has full fiscal and system control: period management, analytics, HPP adjustments, voucher creation. They need strategic visibility across all branches and the confidence that every transaction is auditable.
- **Admin Pusat** — Warehouse and logistics back-office. Handles purchase requisitions, delivery notes, SCM invoicing, and master data. They're the bridge between suppliers and branches. No POS or dashboard — pure operational logistics.
- **Area Manager** — Supervisor and auditor across multiple branches. Triggers stock opnames, approves cancellations and stock mutations, investigates discrepancies. Their job is oversight and validation, not data entry.
- **Central Kitchen** — Production upstream. Manages yield tracking (raw-to-cooked conversion), raw material masters, and inventory at the central warehouse. They deal in weights, conversion factors, and BOM accuracy.

The app uses Indonesian throughout — all users are Indonesian-speaking food service workers.

## Product Purpose

Omoiyari POS is a unified Point of Sale and Deep Inventory Management system purpose-built for ghost kitchen operations running multiple food brands from a single physical kitchen.

It solves the fundamental tension of ghost kitchen accounting: shared physical inventory that must be tracked as logically separate brand P&Ls, with real-time stock accuracy, rigorous supply chain documentation, and airtight period control.

Success looks like: a kasir completes a cross-brand order in under 10 seconds, every BOM deduction is atomic and auditable, and the owner can close a period knowing the data is clean.

## Brand Personality

Efficient, Trustworthy, Calm.

- **Efficient** — Every interaction has a purpose. No decoration without function. The POS screen is optimized for tap speed, not visual flair.
- **Trustworthy** — Numbers are never ambiguous. Every transaction, approval, and stock movement leaves a permanent audit trail. Role-based access is absolute.
- **Calm** — The UI doesn't demand attention. It serves data clearly and lets the user do their job. No alarms, no flashing, no celebration animations. Confident quiet.

Emotional goal: operational confidence. The user should feel that the system has their back — that every stock count, every order, every period close is accurate and defensible.

## Anti-references

- Overly playful UI — no restaurant-themed decorations, food illustrations, playful icons, or gamification. This is a serious operational tool, not a consumer app.
- Generic SaaS dashboard clichés (hero metrics, gradient text, card grids).
- Any UI that could be mistaken for a food delivery or restaurant review app.

## Design Principles

- **Data integrity is absolute.** Every transaction, approval, stock movement, and HPP change leaves a permanent audit trail with user, timestamp, old value, and new value. There is no silent mutation.
- **Speed on the POS screen is paramount.** Kasir should tap, not type. The POS is the heart of daily operations — its latency, flow, and feedback determine whether the system helps or hinders.
- **Role-based opacity.** Each user role sees exactly what they need and nothing else. Data tables hide branch columns for branch admins. The dashboard doesn't exist for non-super-admin roles. Unauthorized actions are structurally impossible, not just hidden.
- **Blind verification where it counts.** Physical counts (stock opname, cash close) never show the system's expected value to the person doing the counting. Variance calculation is server-side, visible only to supervisors.

## Accessibility & Inclusion

- Works reliably in both bright (sunlit kitchen or outdoor takeaway counter) and dim (evening shift, mood-lit dine-in area) environments.
- The existing light/dark theme toggle serves this directly — both themes must have adequate contrast for their environment.
- Standard WCAG 2.1 AA contrast compliance as a baseline.
- Reduced motion respected — no layout animations, only purposeful opacity/transform transitions.
