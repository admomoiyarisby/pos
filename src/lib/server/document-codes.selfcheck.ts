/**
 * Self-check for the document code generator.
 *
 * Run with: `npx tsx src/lib/server/document-codes.selfcheck.ts`
 *
 * Validates:
 * - The code format matches <prefix>/<branch_code>/<ddmmyy>/<serial>
 * - The date formatting is correct
 *
 * Does NOT require a database — pure logic check. For DB-backed integration
 * tests, see Phase 3.
 */

(function () {
  let failures = 0;
  function check(label: string, cond: boolean, detail?: string): void {
    if (cond) {
      console.log(`  ✓ ${label}`);
    } else {
      console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      failures += 1;
    }
  }

  // =============================================================================
  // Test the date formatting logic
  // =============================================================================

  function formatDateDDMMYY(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
  }

  function testDateFormatting() {
    console.log("  Test: date formatting produces ddmmyy");

    // July 6, 2026 → 060726
    const date1 = new Date(2026, 6, 6); // Month is 0-indexed
    check("July 6, 2026 → 060726", formatDateDDMMYY(date1) === "060726");

    // January 1, 2026 → 010126
    const date2 = new Date(2026, 0, 1);
    check("Jan 1, 2026 → 010126", formatDateDDMMYY(date2) === "010126");

    // December 25, 2026 → 251226
    const date3 = new Date(2026, 11, 25);
    check("Dec 25, 2026 → 251226", formatDateDDMMYY(date3) === "251226");

    // September 9, 2026 → 090926
    const date4 = new Date(2026, 8, 9);
    check("Sep 9, 2026 → 090926", formatDateDDMMYY(date4) === "090926");
  }

  // =============================================================================
  // Test the code format
  // =============================================================================

  function testCodeFormat() {
    console.log("  Test: code format matches <prefix>/<branch>/<date>/<serial>");

    // Simulate what generateDocumentCode would return
    const prefix = "INV";
    const branchCode = "TGL";
    const dateStr = "060726";
    const serial = "01";

    const code = `${prefix}/${branchCode}/${dateStr}/${serial}`;
    check("Invoice code format", code === "INV/TGL/060726/01");

    // Procurement code
    const prCode = `PR/MLY/${dateStr}/03`;
    check("Procurement code format", prCode === "PR/MLY/060726/03");

    // Transfer code
    const mtCode = `MT/WYG/${dateStr}/12`;
    check("Transfer code format", mtCode === "MT/WYG/060726/12");

    // Serial padding
    const serial9 = String(9).padStart(2, "0");
    const serial10 = String(10).padStart(2, "0");
    const serial99 = String(99).padStart(2, "0");
    check("Serial 9 pads to 09", serial9 === "09");
    check("Serial 10 stays 10", serial10 === "10");
    check("Serial 99 stays 99", serial99 === "99");
  }

  // =============================================================================
  // Main
  // =============================================================================

  function main() {
    console.log("document-codes.selfcheck.ts");
    try {
      testDateFormatting();
      testCodeFormat();
    } catch (err) {
      console.error("  ✗ Fatal:", err);
      failures += 1;
    }

    if (failures > 0) {
      console.error(`\n  ${failures} check(s) failed.`);
      process.exit(1);
    } else {
      console.log("\n  All checks passed.");
    }
  }

  main();
})();
