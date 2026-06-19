// Smoke test for the CSV + address parsers. Not part of `vp test` —
// run manually with: tsx scripts/migrate-csv/smoke-test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv, findColumn } from "./csv";
import { formatLocation, parseAddress } from "./address";

const CSV_PATH = resolve(process.cwd(), "docs/csv/Detail POS - List Cabang.csv");

const raw = readFileSync(CSV_PATH, "utf-8");
const table = parseCsv(raw);

console.log(`Parsed ${table.rows.length} rows. Header:`);
console.log(" ", table.header);

const nameCol = findColumn(table.header, "Brand - Outletname");
const addrCol = findColumn(table.header, "Outlet Location Address");
const telpCol = findColumn(table.header, "No telp");
const aduanCol = findColumn(table.header, "No Pengaduan");
console.log(`Columns: name=${nameCol} addr=${addrCol} telp=${telpCol} aduan=${aduanCol}`);

const expectedCodes: Record<string, string> = {
  "Omoiyari Wiyung": "WYG",
  "Omoiyari Darmo Permai": "DRM",
  "Omoiyari Tenggilis": "TGL",
  "Omoiyari Mulyorejo": "MLY",
  "Omoiyari Jambangan": "JMB",
  "Omoiyari Pucang": "PCG",
  "Omoiyari Siwalankerto": "SWL",
};

let pass = 0;
let fail = 0;

for (const [idx, row] of table.rows.entries()) {
  const name = (row[nameCol] ?? "").trim();
  const addr = row[addrCol] ?? "";
  const telp = (row[telpCol] ?? "").trim();
  const aduan = (row[aduanCol] ?? "").trim();
  const parsed = parseAddress(addr);
  const location = formatLocation(parsed);

  const expectCode = expectedCodes[name];
  const code = expectCode ? `${expectCode}-01` : "???";

  console.log(`\n[${idx + 1}] ${name}  →  ${code}`);
  console.log(`  raw address:`);
  for (const line of addr.split("\n")) console.log(`    | ${line}`);
  console.log(`  parsed:`);
  console.log(`    street:    ${parsed.street}`);
  console.log(`    kelurahan: ${parsed.kelurahan}`);
  console.log(`    kecamatan: ${parsed.kecamatan}`);
  console.log(`    kota:      ${parsed.kota}`);
  console.log(`  location:  ${location}`);
  console.log(`  phone:     ${telp}`);
  console.log(`  aduan:     ${aduan}`);

  if (expectCode && parsed.kota === "Surabaya" && parsed.kecamatan && parsed.kelurahan) {
    pass++;
  } else {
    fail++;
  }
}

console.log(`\nResults: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
