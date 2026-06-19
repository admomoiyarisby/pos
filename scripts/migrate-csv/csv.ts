/**
 * Hand-rolled RFC 4180-ish CSV parser.
 *
 * Why hand-rolled: no `papaparse` / `csv-parse` dependency in this repo, the
 * input files are small (<10 KB), and the quirks of `docs/csv/*.csv`
 * (multi-line quoted fields, leading `*` on header names) are easier to
 * express here than to configure in a library.
 *
 * Handles:
 *   - Quoted fields containing commas, newlines, and "" escaped quotes
 *   - \r\n and \n line endings
 *   - Trailing blank rows (silently dropped)
 *
 * Does NOT handle:
 *   - Headers split across lines (none in our CSVs)
 */

export type CsvRow = string[];
export type CsvTable = {
  header: string[];
  rows: CsvRow[];
};

export function parseCsv(input: string): CsvTable {
  const rows: CsvRow[] = [];
  let current: CsvRow = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = "";
  };

  const pushRow = () => {
    pushField();
    // Drop rows that are entirely empty (single empty field).
    if (!(current.length === 1 && current[0] === "")) rows.push(current);
    current = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\r") {
      if (input[i + 1] === "\n") i++;
      pushRow();
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }
  // Flush trailing field/row if the file did not end with a newline.
  if (field !== "" || current.length > 0) {
    pushRow();
  }

  if (rows.length === 0) return { header: [], rows: [] };
  const header = rows[0]!;
  return { header, rows: rows.slice(1) };
}

/**
 * Find the column index whose header (with optional leading `*`) matches
 * the given logical name. Returns -1 if not found.
 */
export function findColumn(header: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return header.findIndex((h) => h.replace(/^\*/, "").trim().toLowerCase() === target);
}
