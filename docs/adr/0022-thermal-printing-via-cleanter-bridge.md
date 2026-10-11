# Thermal printing goes through the Cleanter HTTP bridge

## Context

The POS prints three documents: the customer receipt (struk), the
pre-checkout bill, and the SCM invoice. All three were built as HTML
documents opened in a popup and handed to `window.print()`. That works on a
desktop, where the browser can reach an installed printer. The client runs the
POS on an **Android tablet** with a **Bluetooth thermal printer**, and that path
does not work there:

- Android's print dialog has no route to a thermal ESC/POS printer, so the
  print preview either offers nothing sensible or sends a scaled A4 page.
- Web Bluetooth cannot substitute: it speaks Bluetooth **LE**, while thermal
  receipt printers are Bluetooth **Classic (SPP)**. The browser has no API for
  SPP at all, and none is coming.

So the failure was never in the receipt layout — it was in the transport. Some
native layer has to own the Bluetooth connection, and the page has to reach it
somehow.

## Decision

**Print thermal documents through Cleanter, an Android app that runs a
localhost-only HTTP bridge, and keep the browser print dialog as the fallback.**

1. `src/lib/print-bridge.ts` is the whole transport: a `POST` of a JSON
   document to `http://localhost:9100/print`. Cleanter converts the content
   blocks into ESC/POS bytes and sends them to a printer already paired in
   Android settings. No SDK, no driver, no cloud; the page never touches
   Bluetooth itself. A refused connection (nothing listening) is the normal
   desktop case, and `/print` uses a long timeout so a slow print head can
   never be mistaken for "no bridge".
2. Layouts are built as **content blocks** — `text`, `row`, `divider`,
   `feed` — in `src/lib/pos-print.ts`, because a roll of paper has no page to
   style. `row` lets Cleanter pad the columns; we only supply content and clip
   our own text to the printable width (48 characters at 80mm, 32 at 58mm).
   Receipt and bill go on 58mm, matching the existing 57mm HTML page; the
   invoice goes on 80mm, since a four-column A4 invoice cannot be squeezed
   onto 58mm — each item becomes a name line plus a quantity/total line.
3. **Bridge first, browser dialog second.** `printReceipt`, `printBill` and
   `printSCMInvoice` now await `printViaBridge` and fall back to the unchanged
   HTML popup only when the call never connected. When Cleanter answers `503`
   (printer off, out of paper, Bluetooth off) the app does **not** fall back:
   the browser dialog cannot print either, and opening it would invite the
   cashier to press print again. Instead the toast shows Cleanter's own `fix`
   sentence, which is written for the person at the counter.
4. `printSuratJalan` stays on the A4 browser path — it is a delivery document
   printed on office paper, not a roll.

The constraint the client owns: the bridge and the web app must run on the
**same tablet**, because Cleanter binds to `localhost`. Nothing in the app
depends on Cleanter being present — a browser without it gets exactly today's
behaviour.

## Consequences

- Tablet + Bluetooth Classic printer now prints directly, with no cloud
  service, no tablet app integration work per document, and no Wi-Fi.
- The two layouts per document (blocks and HTML) are now maintained in
  parallel, in the same file. That is the cost of keeping the desktop fallback.
- HTTPS works: Cleanter 1.1.0+ answers Chrome's Private Network Access
  preflight, so the production `https://` POS can call `localhost` as-is. On an
  older Cleanter the request fails and the app silently takes the browser path.
- iPadOS is not covered. It has no Bluetooth Classic API for the browser and no
  equivalent bridge app; if a client shows up with an iPad, it needs a
  networked printer or a different transport.
- Not yet done: the logo is dropped on thermal prints. Embedding it would mean
  rasterising a PNG into the payload and a thermal head renders transparency as
  a black block unless the image is pre-flattened and dithered — worth doing
  only if the client cares.
- Tests in `src/lib/pos-print.test.ts` assert the posted payload (paper width,
  cut, reference, block order, HPP hiding) and the fallback contract, so a
  layout regression fails loudly instead of producing unreadable receipts.
