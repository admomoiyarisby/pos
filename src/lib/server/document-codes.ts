/**
 * Document code generator.
 *
 * Generates document codes following the format: <prefix>/<branch_code>/<ddmmyy>/<serial>
 * Example: INV/TGL/060726/01
 *
 * Serial numbers increment by 1 per day per branch, resetting daily.
 */

import { db } from "#/lib/server/db";
import { documentCodeSequences } from "#/db/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Format a date as ddmmyy (e.g., 060726 for July 6, 2026).
 */
function formatDateDDMMYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

/**
 * Generate a document code with the format: <prefix>/<branch_code>/<ddmmyy>/<serial>
 *
 * @param prefix - Document type prefix (e.g., "INV", "PR", "MT")
 * @param branchCode - Branch code (e.g., "TGL", "MLY")
 * @param date - Date for the code (defaults to now)
 * @returns The generated document code
 *
 * @example
 * // Returns "INV/TGL/060726/01"
 * await generateDocumentCode("INV", "TGL", new Date("2026-07-06"));
 */
export async function generateDocumentCode(
  prefix: string,
  branchCode: string,
  date: Date = new Date(),
): Promise<string> {
  const dateStr = formatDateDDMMYY(date);

  // Atomically increment the serial number
  const [result] = await db
    .insert(documentCodeSequences)
    .values({
      prefix,
      branchCode,
      date: dateStr,
      lastSerial: 1,
    })
    .onConflictDoUpdate({
      target: [
        documentCodeSequences.prefix,
        documentCodeSequences.branchCode,
        documentCodeSequences.date,
      ],
      set: {
        lastSerial: sql`${documentCodeSequences.lastSerial} + 1`,
      },
    })
    .returning({ lastSerial: documentCodeSequences.lastSerial });

  const serial = String(result.lastSerial).padStart(2, "0");
  return `${prefix}/${branchCode}/${dateStr}/${serial}`;
}

/**
 * Preview the next document code without incrementing the counter.
 * Useful for displaying what the next code will be.
 */
export async function previewNextDocumentCode(
  prefix: string,
  branchCode: string,
  date: Date = new Date(),
): Promise<string> {
  const dateStr = formatDateDDMMYY(date);

  const [existing] = await db
    .select({ lastSerial: documentCodeSequences.lastSerial })
    .from(documentCodeSequences)
    .where(
      and(
        eq(documentCodeSequences.prefix, prefix),
        eq(documentCodeSequences.branchCode, branchCode),
        eq(documentCodeSequences.date, dateStr),
      ),
    )
    .limit(1);

  const nextSerial = (existing?.lastSerial ?? 0) + 1;
  const serial = String(nextSerial).padStart(2, "0");
  return `${prefix}/${branchCode}/${dateStr}/${serial}`;
}
