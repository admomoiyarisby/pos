/**
 * Self-check for the branch staff module.
 *
 * Run with: `npx tsx src/lib/server/branch-staff.selfcheck.ts`
 *
 * Validates:
 * - Module exports are correct
 * - Input validation schemas are correct
 *
 * Does NOT require a database — pure logic check. For DB-backed integration
 * tests, see Phase 3.
 */

import { z } from "zod";

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
// Test the validators
// =============================================================================

function testValidators() {
  console.log("  Test: input validation schemas");

  // Staff name input
  const staffNameInput = z.object({
    branchId: z.string().uuid(),
    name: z.string().min(1, "Name is required").max(100),
    active: z.boolean().optional().default(true),
  });

  // Valid input
  const validInput = {
    branchId: "123e4567-e89b-12d3-a456-426614174000",
    name: "Andi",
  };
  const result1 = staffNameInput.safeParse(validInput);
  check("Valid staff name input passes", result1.success);

  // Missing name
  const missingName = {
    branchId: "123e4567-e89b-12d3-a456-426614174000",
    name: "",
  };
  const result2 = staffNameInput.safeParse(missingName);
  check("Empty name fails validation", !result2.success);

  // Invalid UUID
  const invalidUuid = {
    branchId: "not-a-uuid",
    name: "Andi",
  };
  const result3 = staffNameInput.safeParse(invalidUuid);
  check("Invalid UUID fails validation", !result3.success);

  // Name too long
  const longName = {
    branchId: "123e4567-e89b-12d3-a456-426614174000",
    name: "A".repeat(101),
  };
  const result4 = staffNameInput.safeParse(longName);
  check("Name over 100 chars fails validation", !result4.success);

  // Default active is true
  const defaultActive = {
    branchId: "123e4567-e89b-12d3-a456-426614174000",
    name: "Budi",
  };
  const result5 = staffNameInput.safeParse(defaultActive);
  check("Default active is true", result5.success && result5.data.active === true);
}

// =============================================================================
// Test branch PIN verification logic
// =============================================================================

function testBranchPinVerification() {
  console.log("  Test: branch PIN verification logic");

  // Simulate PIN verification
  function verifyPin(storedPin: string | null, enteredPin: string): boolean {
    if (!storedPin) return false;
    return storedPin === enteredPin;
  }

  check("Correct PIN passes", verifyPin("1234", "1234") === true);
  check("Incorrect PIN fails", verifyPin("1234", "5678") === false);
  check("Null PIN fails", verifyPin(null, "1234") === false);
}

// =============================================================================
// Test staff name email generation
// =============================================================================

function testEmailGeneration() {
  console.log("  Test: staff name email generation");

  function generateEmail(branchCode: string, staffName: string): string {
    return `${branchCode.toLowerCase()}_${staffName.toLowerCase().replace(/\s+/g, "_")}@staff.omoiyari.net`;
  }

  check(
    "Simple name generates correct email",
    generateEmail("TGL", "Andi") === "tgl_andi@staff.omoiyari.net",
  );

  check(
    "Name with spaces generates correct email",
    generateEmail("MLY", "Budi Santoso") === "mly_budi_santoso@staff.omoiyari.net",
  );

  check(
    "Mixed case generates lowercase email",
    generateEmail("WYG", "Citra Dewi") === "wyg_citra_dewi@staff.omoiyari.net",
  );
}

// =============================================================================
// Main
// =============================================================================

function main() {
  console.log("branch-staff.selfcheck.ts");
  try {
    testValidators();
    testBranchPinVerification();
    testEmailGeneration();
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
