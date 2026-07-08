/**
 * Self-check for schema additions (ID3-ID7).
 *
 * Run with: `npx tsx src/db/schema.selfcheck.ts`
 *
 * Validates:
 * - New enums are correctly defined
 * - New tables have expected columns
 * - New columns on existing tables are present
 *
 * Does NOT require a database — pure logic check.
 */

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
// Test the schema exports
// =============================================================================

async function testSchemaExports() {
  console.log("  Test: schema exports");

  const schema = await import("./schema");

  // ID3: employeePenalties table
  check("employeePenalties is exported", typeof schema.employeePenalties === "object");

  // ID4: stockOpnames has realizedAt and realizedBy
  check("stockOpnames is exported", typeof schema.stockOpnames === "object");

  // ID5: scmProcurements has requestSource
  check("scmProcurements is exported", typeof schema.scmProcurements === "object");

  // ID5: scmTransfers has requestSource
  check("scmTransfers is exported", typeof schema.scmTransfers === "object");

  // ID6: recipes has isStaffMeal
  check("recipes is exported", typeof schema.recipes === "object");

  // ID7: systemNotifications has priority
  check("systemNotifications is exported", typeof schema.systemNotifications === "object");

  // ID7: notificationPriorityEnum is exported
  check(
    "notificationPriorityEnum is exported",
    typeof schema.notificationPriorityEnum === "function" ||
      typeof schema.notificationPriorityEnum === "object",
  );

  // Relations
  check(
    "employeePenaltiesRelations is exported",
    typeof schema.employeePenaltiesRelations === "object" ||
      typeof schema.employeePenaltiesRelations === "function",
  );
}

// =============================================================================
// Test enum values
// =============================================================================

async function testEnumValues() {
  console.log("  Test: enum values");

  const schema = await import("./schema");

  // ID2: orderChannelEnum includes TikTok
  const orderChannelValues = schema.orderChannelEnum.enumValues;
  check("orderChannelEnum includes TikTok", orderChannelValues.includes("TikTok"));
  check("orderChannelEnum has 5 values", orderChannelValues.length === 5);

  // ID7: notificationPriorityEnum has normal and urgent
  const priorityValues = schema.notificationPriorityEnum.enumValues;
  check("notificationPriorityEnum includes normal", priorityValues.includes("normal"));
  check("notificationPriorityEnum includes urgent", priorityValues.includes("urgent"));
  check("notificationPriorityEnum has 2 values", priorityValues.length === 2);
}

// =============================================================================
// Test table column names
// =============================================================================

async function testTableColumns() {
  console.log("  Test: table column names");

  const schema = await import("./schema");

  // ID3: employeePenalties columns
  const epColumns = schema.employeePenalties;
  check("employeePenalties has id", "id" in epColumns);
  check("employeePenalties has branchId", "branchId" in epColumns);
  check("employeePenalties has stockOpnameId", "stockOpnameId" in epColumns);
  check("employeePenalties has userId", "userId" in epColumns);
  check("employeePenalties has amount", "amount" in epColumns);
  check("employeePenalties has reason", "reason" in epColumns);
  check("employeePenalties has createdBy", "createdBy" in epColumns);

  // ID4: stockOpnames realizedAt and realizedBy
  check("stockOpnames has realizedAt", "realizedAt" in schema.stockOpnames);
  check("stockOpnames has realizedBy", "realizedBy" in schema.stockOpnames);

  // ID5: scmProcurements requestSource
  check("scmProcurements has requestSource", "requestSource" in schema.scmProcurements);

  // ID5: scmTransfers requestSource
  check("scmTransfers has requestSource", "requestSource" in schema.scmTransfers);

  // ID6: recipes isStaffMeal
  check("recipes has isStaffMeal", "isStaffMeal" in schema.recipes);

  // ID7: systemNotifications priority
  check("systemNotifications has priority", "priority" in schema.systemNotifications);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("schema.selfcheck.ts");
  try {
    await testSchemaExports();
    await testEnumValues();
    await testTableColumns();
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

void main();
