// ──────────────────────────────────────────
// Prototype data adapted for the current schema

function nDaysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function nHoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}
function dateAt(daysAgo: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}
// ──────────────────────────────────────────

// Post-migration test seed (mirrors the CSV-driven branches). For
// running `vp run seed` against a fresh DB to reproduce the post-migration
// state. Note: this file is no longer the live source of truth —
// `scripts/migrate-csv/` populates the DB from CSVs. This file is kept
// for schema-level testing and to reproduce the same shape via a
// TypeScript fixture. INGREDIENTS / RECIPES_DATA / ORDERS_DATA below
// are out of date relative to the CSV migrations; update them
// separately if you need a fully coherent seed snapshot.
export const BRANCHES = [
  {
    protoId: "br-central",
    code: "CENTRAL",
    name: "Central Warehouse",
    location: "Pusat",
    type: "Central" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-wyg-01",
    code: "WYG-01",
    name: "Omoiyari Wiyung",
    location: "Griya Babatan Mukti VI, Blok F no 20, Babatan, Wiyung, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-drm-01",
    code: "DRM-01",
    name: "Omoiyari Darmo Permai",
    location:
      "Jl Raya Darmo Permai, Selatan no 40 (Pujasera Alika), Sonokwijenan, Sukomanunggal, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-tgl-01",
    code: "TGL-01",
    name: "Omoiyari Tenggilis",
    location: "Pujasera Mas Bro, Jl. Tenggilis Mejoyo AI, No.33-34, Kalirungkut, Rungkut, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-mly-01",
    code: "MLY-01",
    name: "Omoiyari Mulyorejo",
    location: "Jl. Kalijudan Asri Indah, No.5-15, Kalijudan, Mulyorejo, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-jmb-01",
    code: "JMB-01",
    name: "Omoiyari Jambangan",
    location: "Jl. Pagesangan IV No.76, Pagesangan, Jambangan, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-pcg-01",
    code: "PCG-01",
    name: "Omoiyari Pucang",
    location:
      "Dekat Pukis & Bikang Payumas Tulungagung, Pucang Anom I No.2, Pucang Sewu, Gubeng, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-swl-01",
    code: "SWL-01",
    name: "Omoiyari Siwalankerto",
    location: "Jl Siwalankerto VIII no 2, Siwalankerto, Wonocolo, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
];

export const BRANDS = [{ code: "BRAND-1", name: "Omoiyari" }];

export const SUPPLIERS = [
  { code: "SUP-001", name: "PT Beras Makmur", contactPerson: "Budi", phone: "08123456789" },
  { code: "SUP-002", name: "CV Ayam Segar", contactPerson: "Siti", phone: "08123456780" },
  { code: "SUP-003", name: "Importir Sapi Jaya", contactPerson: "Joko", phone: "08123456781" },
  { code: "SUP-004", name: "PT Saus Nusantara", contactPerson: "Rina", phone: "08123456782" },
  { code: "SUP-005", name: "CV Seafood Prima", contactPerson: "Ahmad", phone: "08123456783" },
  {
    code: "SUP-006",
    name: "PT Sayur Segar Indonesia",
    contactPerson: "Dewi",
    phone: "08123456784",
  },
  { code: "SUP-007", name: "CV Bumbu Nusantara", contactPerson: "Eko", phone: "08123456785" },
  { code: "SUP-008", name: "PT Packaging Jaya", contactPerson: "Fitri", phone: "08123456786" },
];

export const USERS_TO_CREATE = [
  {
    email: "superadmin@omoiyari.net",
    password: "password123",
    name: "Super Admin",
    role: "super_admin" as const,
    pin: "1111",
  },
  {
    email: "pusat@omoiyari.net",
    password: "password123",
    name: "Admin Pusat",
    role: "admin_pusat" as const,
    pin: "2222",
  },
  {
    email: "manager.east@omoiyari.net",
    password: "password123",
    name: "Area Manager East Java",
    role: "area_manager" as const,
    pin: "3333",
  },
  {
    email: "andi.wiyung@omoiyari.net",
    password: "password123",
    name: "Andi",
    role: "branch_admin" as const,
    branchCode: "WYG-01",
    pin: "1234",
  },
  {
    email: "budi.darmo@omoiyari.net",
    password: "password123",
    name: "Budi",
    role: "branch_admin" as const,
    branchCode: "DRM-01",
    pin: "2345",
  },
  {
    email: "citra.tenggilis@omoiyari.net",
    password: "password123",
    name: "Citra",
    role: "branch_admin" as const,
    branchCode: "TGL-01",
    pin: "3456",
  },
  {
    email: "dewi.mulyorejo@omoiyari.net",
    password: "password123",
    name: "Dewi",
    role: "branch_admin" as const,
    branchCode: "MLY-01",
    pin: "4567",
  },
  {
    email: "eko.jambangan@omoiyari.net",
    password: "password123",
    name: "Eko",
    role: "branch_admin" as const,
    branchCode: "JMB-01",
    pin: "5678",
  },
  {
    email: "fitri.pucang@omoiyari.net",
    password: "password123",
    name: "Fitri",
    role: "branch_admin" as const,
    branchCode: "PCG-01",
    pin: "6789",
  },
  {
    email: "gilang.siwalankerto@omoiyari.net",
    password: "password123",
    name: "Gilang",
    role: "branch_admin" as const,
    branchCode: "SWL-01",
    pin: "7890",
  },
  {
    email: "ck@omoiyari.net",
    password: "password123",
    name: "Central Kitchen",
    role: "central_kitchen" as const,
    branchCode: "CENTRAL",
  },
];

export const AREA_MANAGER_BRANCHES = [
  "WYG-01",
  "DRM-01",
  "TGL-01",
  "MLY-01",
  "JMB-01",
  "PCG-01",
  "SWL-01",
];

export const INGREDIENTS = [
  {
    protoId: "ing001",
    code: "ING-001",
    name: "Susu",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing002",
    code: "ING-002",
    name: "Gula Halus",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 21,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing003",
    code: "ING-003",
    name: "Tepung Ketan",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 22,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing004",
    code: "ING-004",
    name: "Telor Ayam",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1800,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing005",
    code: "ING-005",
    name: "Vanili Pasta",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing006",
    code: "ING-006",
    name: "Margarin",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing007",
    code: "ING-007",
    name: "Thousand island",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 31,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing008",
    code: "ING-008",
    name: "Susu Fresh Milk",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 18,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing009",
    code: "ING-009",
    name: "Simple Syrup",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 16,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing010",
    code: "ING-010",
    name: "Bubuk Hojicha",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing011",
    code: "ING-011",
    name: "Susu Kental Manis",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 25,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing012",
    code: "ING-012",
    name: "Creamer Bubuk",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing013",
    code: "ING-013",
    name: "Es Batu",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing014",
    code: "ING-014",
    name: "Air",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing015",
    code: "ING-015",
    name: "Sedotan",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 100,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing016",
    code: "ING-016",
    name: "Strawberry Sauce",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 55,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing017",
    code: "ING-017",
    name: "Plastik Sealer Cup",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 30000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing018",
    code: "ING-018",
    name: "Tusuk sate",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 6500,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing019",
    code: "ING-019",
    name: "Bubuk Dark Coklat",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing020",
    code: "ING-020",
    name: "saus sambal sachet",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 184,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing021",
    code: "ING-021",
    name: "saus tomat sachet",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 163,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing022",
    code: "ING-022",
    name: "Cup gelas PP 12Oz",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 480,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing023",
    code: "ING-023",
    name: "Beras",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 16,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing024",
    code: "ING-024",
    name: "Daging Blackpepper",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 127,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing025",
    code: "ING-025",
    name: "Mirin Halal",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 44,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing026",
    code: "ING-026",
    name: "Kecap Manis",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing027",
    code: "ING-027",
    name: "Paha Ayam",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing028",
    code: "ING-028",
    name: "Dashi Halal",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 210,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing029",
    code: "ING-029",
    name: "Lada hitam",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing030",
    code: "ING-030",
    name: "Jahe Bubuk",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing031",
    code: "ING-031",
    name: "Kecap Asin",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing032",
    code: "ING-032",
    name: "Ajinomoto",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing033",
    code: "ING-033",
    name: "Saus Tiram",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing034",
    code: "ING-034",
    name: "Gula Pasir",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 19,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing035",
    code: "ING-035",
    name: "Gram",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing036",
    code: "ING-036",
    name: "Bawang Bombay",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing037",
    code: "ING-037",
    name: "Tepung Tapioka",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing038",
    code: "ING-038",
    name: "Tepung Terigu",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing039",
    code: "ING-039",
    name: "Sendok Makan",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing040",
    code: "ING-040",
    name: "Cocoa Powder",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing041",
    code: "ING-041",
    name: "Baking Powder",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing042",
    code: "ING-042",
    name: "Thinwall 300 ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 548,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing043",
    code: "ING-043",
    name: "Madu",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing044",
    code: "ING-044",
    name: "Bawang Putih Bubuk",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing045",
    code: "ING-045",
    name: "Cabe bubuk",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 50,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing046",
    code: "ING-046",
    name: "Condy lime",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing047",
    code: "ING-047",
    name: "Curry Pasta",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing048",
    code: "ING-048",
    name: "Garam Masala",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing049",
    code: "ING-049",
    name: "Thinwall 100 ml",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing050",
    code: "ING-050",
    name: "Ayam Cincang",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing051",
    code: "ING-051",
    name: "Saus Sambal Blibis",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing052",
    code: "ING-052",
    name: "Saus Manis Jepang",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 29,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing053",
    code: "ING-053",
    name: "Chili Oil",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing054",
    code: "ING-054",
    name: "Miso Pasta",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing055",
    code: "ING-055",
    name: "Wakame",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 336,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing056",
    code: "ING-056",
    name: "Bawang Putih",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing057",
    code: "ING-057",
    name: "Lada Putih Bubuk",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing058",
    code: "ING-058",
    name: "Daun Parsley",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 84,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing059",
    code: "ING-059",
    name: "Paper Bowl 650 ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1065,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing060",
    code: "ING-060",
    name: "Tutup Bowl 650 ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 375,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing061",
    code: "ING-061",
    name: "Wijen",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 48,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing062",
    code: "ING-062",
    name: "Daun Bawang",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing063",
    code: "ING-063",
    name: "Mayonaise",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing064",
    code: "ING-064",
    name: "Thinwall 25 ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 280,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing065",
    code: "ING-065",
    name: "Inner Tray Bowl",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing066",
    code: "ING-066",
    name: "Minyak Goreng",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 17,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing067",
    code: "ING-067",
    name: "Plastik Kresek 20",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pax",
    stockUnit: "pax",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing068",
    code: "ING-068",
    name: "Plastik Kresek 25",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pax",
    stockUnit: "pax",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing069",
    code: "ING-069",
    name: "Plastik Klip 100 Pcs",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1120,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing070",
    code: "ING-070",
    name: "Thinwall 500ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 880,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing071",
    code: "ING-071",
    name: "Kabel Ties",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 25,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing072",
    code: "ING-072",
    name: "Vaccum Pack 10 x 15",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing073",
    code: "ING-073",
    name: "Dada Ayam Mentah",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing074",
    code: "ING-074",
    name: "Tepung Panir Katsu Kuning",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing075",
    code: "ING-075",
    name: "Tepung Panir Katsu Putih",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing076",
    code: "ING-076",
    name: "Plastik 12 x 25",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 9000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing077",
    code: "ING-077",
    name: "Plastik 20 x 35",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 9000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing078",
    code: "ING-078",
    name: "Vaccum Pack 30 x 40",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing079",
    code: "ING-079",
    name: "Vaccum Pack 25 x 37",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing080",
    code: "ING-080",
    name: "Lada hitam bubuk halus",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing081",
    code: "ING-081",
    name: "Daun Teh Hitam",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing082",
    code: "ING-082",
    name: "Minyak Wijen",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing083",
    code: "ING-083",
    name: "Battery AAA",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 2492,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing084",
    code: "ING-084",
    name: "Tissue Jumbo",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 30000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing085",
    code: "ING-085",
    name: "Thinwall 150 ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing086",
    code: "ING-086",
    name: "Sendok Pudding",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 6300,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing087",
    code: "ING-087",
    name: "Kaldu Ayam Knorr",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing088",
    code: "ING-088",
    name: "Beras Ketan",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 31,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing089",
    code: "ING-089",
    name: "Cuka Nasi",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 40,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing090",
    code: "ING-090",
    name: "White Coin",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 130,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing091",
    code: "ING-091",
    name: "Tepung Maizena",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing092",
    code: "ING-092",
    name: "Pewarna Kuning Telor",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing093",
    code: "ING-093",
    name: "Cling Wrap",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "cm",
    stockUnit: "cm",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing094",
    code: "ING-094",
    name: "Bento Tray",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 2530,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing095",
    code: "ING-095",
    name: "Es Batu",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing096",
    code: "ING-096",
    name: "Edamame",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 40,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing097",
    code: "ING-097",
    name: "Jahe",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing098",
    code: "ING-098",
    name: "Lada Hitam Utuh",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing099",
    code: "ING-099",
    name: "Bayam",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing100",
    code: "ING-100",
    name: "Bubuk Matcha latte",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 1350,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing101",
    code: "ING-101",
    name: "Cup gelas PP 14Oz",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 548,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing102",
    code: "ING-102",
    name: "Mangkok soup 300ml",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing103",
    code: "ING-103",
    name: "Bowl Mangkok",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing104",
    code: "ING-104",
    name: "Tutup Mangkok",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing105",
    code: "ING-105",
    name: "Plastik Bawang 20",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 9500,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing106",
    code: "ING-106",
    name: "Plastik Bawang 25",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 9500,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing107",
    code: "ING-107",
    name: "Ayam Karage",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 49,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing108",
    code: "ING-108",
    name: "Hot Honey Sauce",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 32,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing109",
    code: "ING-109",
    name: "Curry Sauce",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 2200,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing110",
    code: "ING-110",
    name: "Spicy Sauce Ayam Cincang",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1650,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing111",
    code: "ING-111",
    name: "Miso Soup",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing112",
    code: "ING-112",
    name: "Choco Latte",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 121,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing113",
    code: "ING-113",
    name: "Tissue",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 7200,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing114",
    code: "ING-114",
    name: "Trash Bag",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 14200,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing115",
    code: "ING-115",
    name: "Katsu Chicken",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 4095,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing116",
    code: "ING-116",
    name: "Plastik Bawang 15",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pack",
    stockUnit: "pack",
    conversionFactor: 1,
    averageCost: 9000,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing117",
    code: "ING-117",
    name: "Roll Kertas Nota",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 2750,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing118",
    code: "ING-118",
    name: "Teh Wayang",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1890,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing119",
    code: "ING-119",
    name: "Spons Cuci",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 4600,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing120",
    code: "ING-120",
    name: "Isi Staples",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 1400,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing121",
    code: "ING-121",
    name: "Isolasi Bening",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing122",
    code: "ING-122",
    name: "Lakban Bening",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing123",
    code: "ING-123",
    name: "Pudding Caramel",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 2065,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing124",
    code: "ING-124",
    name: "Egg Roll",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "pcs",
    stockUnit: "pcs",
    conversionFactor: 1,
    averageCost: 440,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing125",
    code: "ING-125",
    name: "Garam",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 8,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing126",
    code: "ING-126",
    name: "Kubis Mentah",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing127",
    code: "ING-127",
    name: "Wortel Mentah",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing128",
    code: "ING-128",
    name: "Daging Beef Slice",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing129",
    code: "ING-129",
    name: "Cairan Cuci Piring",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "gr",
    stockUnit: "gr",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing130",
    code: "ING-130",
    name: "Super Pel",
    category: "Packaging" as const,
    skuType: "RM" as const,
    purchaseUnit: "ml",
    stockUnit: "ml",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-nasi",
    code: "ING-NASI",
    name: "Nasi Putih",
    category: "Fresh" as const,
    skuType: "FG" as const,
    purchaseUnit: "porsi",
    stockUnit: "porsi",
    conversionFactor: 1,
    averageCost: 0,
    rop: 0,
    moq: 1,
    countable: true,
    isNasi: true,
  },
];

export const MODIFIER_GROUPS_DATA = [
  {
    protoId: "mg-01",
    code: "MG-001",
    name: "Level Pedas",
    minSelection: 1,
    maxSelection: 1,
    modifiers: [
      {
        protoId: "mod-01",
        code: "MOD-001",
        name: "Original (Tidak Pedas)",
        price: 0,
        isExclusion: false,
      },
      {
        protoId: "mod-02",
        code: "MOD-002",
        name: "Level 1 (Sedang)",
        price: 0,
        isExclusion: false,
      },
      {
        protoId: "mod-03",
        code: "MOD-003",
        name: "Level 2 (Pedas)",
        price: 2000,
        isExclusion: false,
      },
      {
        protoId: "mod-04",
        code: "MOD-004",
        name: "Level 3 (Sangat Pedas)",
        price: 5000,
        isExclusion: false,
      },
    ],
  },
  {
    protoId: "mg-02",
    code: "MG-002",
    name: "Extra Topping",
    minSelection: 0,
    maxSelection: 5,
    modifiers: [
      {
        protoId: "mod-05",
        code: "MOD-005",
        name: "Extra Telur Mata Sapi",
        price: 5000,
        isExclusion: false,
        ingredients: [{ ingredientProtoId: "ing-sfg-012", quantity: 1 }],
      },
      {
        protoId: "mod-06",
        code: "MOD-006",
        name: "Extra Daging Ayam",
        price: 10000,
        isExclusion: false,
        ingredients: [{ ingredientProtoId: "ing-sfg-002", quantity: 50 }],
      },
      {
        protoId: "mod-07",
        code: "MOD-007",
        name: "Extra Keju Slice",
        price: 4000,
        isExclusion: false,
      },
    ],
  },
  {
    protoId: "mg-03",
    code: "MG-003",
    name: "Pilihan (Exclusion)",
    minSelection: 0,
    maxSelection: 3,
    modifiers: [
      {
        protoId: "mod-08",
        code: "MOD-008",
        name: "Tanpa Bawang Bombay",
        price: 0,
        isExclusion: true,
      },
      { protoId: "mod-09", code: "MOD-009", name: "Tanpa Wortel", price: 0, isExclusion: true },
      {
        protoId: "mod-10",
        code: "MOD-010",
        name: "Tanpa Kentang",
        price: 0,
        isExclusion: true,
      },
    ],
  },
  {
    protoId: "mg-04",
    code: "MG-004",
    name: "Minuman",
    minSelection: 0,
    maxSelection: 2,
    modifiers: [
      {
        protoId: "mod-11",
        code: "MOD-011",
        name: "Ocha (Hot)",
        price: 8000,
        isExclusion: false,
      },
      {
        protoId: "mod-12",
        code: "MOD-012",
        name: "Ocha (Cold)",
        price: 10000,
        isExclusion: false,
      },
      {
        protoId: "mod-13",
        code: "MOD-013",
        name: "Matcha Latte",
        price: 25000,
        isExclusion: false,
      },
    ],
  },
  {
    protoId: "mg-05",
    code: "MG-005",
    name: "Tambahan",
    minSelection: 0,
    maxSelection: 2,
    modifiers: [
      {
        protoId: "mod-14",
        code: "MOD-014",
        name: "Tambah Telur",
        price: 5000,
        isExclusion: false,
        ingredients: [{ ingredientProtoId: "ing004", quantity: 1 }],
      },
      {
        protoId: "mod-15",
        code: "MOD-015",
        name: "Tambah Cabe",
        price: 1000,
        isExclusion: false,
        ingredients: [{ ingredientProtoId: "ing045", quantity: 5 }],
      },
    ],
  },
];

export const RECIPES_DATA = [
  {
    protoId: "rec001",
    code: "REC-001",
    name: "Gyumeshi",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 33000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing024", quantity: 70 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing065", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
    ],
  },
  {
    protoId: "rec002",
    code: "REC-002",
    name: "Karage Don",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 27000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 130 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
    ],
  },
  {
    protoId: "rec003",
    code: "REC-003",
    name: "Hot Honey Karage Don",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 32000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 130 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing108", quantity: 20 },
    ],
  },
  {
    protoId: "rec004",
    code: "REC-004",
    name: "Gyuniku Ala Carte",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 49000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing024", quantity: 180 },
      { ingredientProtoId: "ing070", quantity: 1 },
    ],
  },
  {
    protoId: "rec005",
    code: "REC-005",
    name: "Karage Ala Carte",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 45000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 260 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
    ],
  },
  {
    protoId: "rec006",
    code: "REC-006",
    name: "Hot Honey Karage Ala Carte",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 49000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 260 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing108", quantity: 40 },
    ],
  },
  {
    protoId: "rec007",
    code: "REC-007",
    name: "Curry Karage Don",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 35000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 130 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing109", quantity: 1 },
    ],
  },
  {
    protoId: "rec008",
    code: "REC-008",
    name: "Miso Sup",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 10000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing111", quantity: 1 },
      { ingredientProtoId: "ing062", quantity: 1 },
      { ingredientProtoId: "ing055", quantity: 0.5 },
      { ingredientProtoId: "ing102", quantity: 1 },
    ],
  },
  {
    protoId: "rec009",
    code: "REC-009",
    name: "nasi putih",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 10000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing102", quantity: 1 },
    ],
  },
  {
    protoId: "rec010",
    code: "REC-010",
    name: "Curry Sauce",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 10000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing109", quantity: 1 }],
  },
  {
    protoId: "rec011",
    code: "REC-011",
    name: "Spicy Sauce",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 12000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing110", quantity: 1 }],
  },
  {
    protoId: "rec012",
    code: "REC-012",
    name: "extra 2pcs karage",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing107", quantity: 65 }],
  },
  {
    protoId: "rec013",
    code: "REC-013",
    name: "extra beef 50gr",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing024", quantity: 35 }],
  },
  {
    protoId: "rec014",
    code: "REC-014",
    name: "Chicken Katsu Don",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 24000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing115", quantity: 1 },
      { ingredientProtoId: "ing052", quantity: 10 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing062", quantity: 1 },
    ],
  },
  {
    protoId: "rec015",
    code: "REC-015",
    name: "Curry Katsu Don",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 32000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing115", quantity: 1 },
      { ingredientProtoId: "ing109", quantity: 1 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing062", quantity: 1 },
    ],
  },
  {
    protoId: "rec016",
    code: "REC-016",
    name: "Matcha Latte",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 28000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing100", quantity: 4 },
      { ingredientProtoId: "ing009", quantity: 15 },
      { ingredientProtoId: "ing014", quantity: 50 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing008", quantity: 125 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec017",
    code: "REC-017",
    name: "Matcha Tea",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 15000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing100", quantity: 1.5 },
      { ingredientProtoId: "ing009", quantity: 25 },
      { ingredientProtoId: "ing014", quantity: 175 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec018",
    code: "REC-018",
    name: "Ice Tea",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 8000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing081", quantity: 10 },
      { ingredientProtoId: "ing009", quantity: 20 },
      { ingredientProtoId: "ing014", quantity: 50 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec019",
    code: "REC-019",
    name: "Japanese Beef Curry Rice",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 36000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing024", quantity: 70 },
      { ingredientProtoId: "ing109", quantity: 1 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing065", quantity: 1 },
    ],
  },
  {
    protoId: "rec020",
    code: "REC-020",
    name: "BUY 1 GET 1 KATSU DON",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 50000,
    isBOGO: true,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec021",
    code: "REC-021",
    name: "saus tomat sachet",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec022",
    code: "REC-022",
    name: "saus sambal sachet",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec023",
    code: "REC-023",
    name: "cabe bubuk",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec024",
    code: "REC-024",
    name: "sendok plastik",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 0,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec025",
    code: "REC-025",
    name: "Caramel Pudding",
    category: "add_ons" as const,
    isSubRecipe: false,
    basePrice: 12000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
  },
  {
    protoId: "rec026",
    code: "REC-026",
    name: "Chicken Katsu Staff",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 4096,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing115", quantity: 1 },
      { ingredientProtoId: "ing052", quantity: 10 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing026", quantity: 1 },
    ],
  },
  {
    protoId: "rec027",
    code: "REC-027",
    name: "Chicken Karaage Staff",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 6370,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing107", quantity: 130 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
    ],
  },
  {
    protoId: "rec028",
    code: "REC-028",
    name: "Nasi Staff",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 1515,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
    ],
  },
  {
    protoId: "rec029",
    code: "REC-029",
    name: "Telor Staff",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 1750,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing004", quantity: 1 }],
  },
  {
    protoId: "rec030",
    code: "REC-030",
    name: "Choco Latte",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 21000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing112", quantity: 1 },
      { ingredientProtoId: "ing008", quantity: 125 },
      { ingredientProtoId: "ing014", quantity: 50 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing009", quantity: 15 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec031",
    code: "REC-031",
    name: "Hojicha Latte",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 28500,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing010", quantity: 1 },
      { ingredientProtoId: "ing008", quantity: 125 },
      { ingredientProtoId: "ing014", quantity: 50 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing009", quantity: 15 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec032",
    code: "REC-032",
    name: "Choco Ichigo Latte",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 25000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing112", quantity: 1 },
      { ingredientProtoId: "ing016", quantity: 20 },
      { ingredientProtoId: "ing008", quantity: 125 },
      { ingredientProtoId: "ing014", quantity: 50 },
      { ingredientProtoId: "ing013", quantity: 180 },
      { ingredientProtoId: "ing009", quantity: 15 },
      { ingredientProtoId: "ing101", quantity: 1 },
      { ingredientProtoId: "ing015", quantity: 1 },
    ],
  },
  {
    protoId: "rec033",
    code: "REC-033",
    name: "Curry Omurice",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 27700,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing065", quantity: 1 },
      { ingredientProtoId: "ing109", quantity: 1 },
      { ingredientProtoId: "ing004", quantity: 1 },
      { ingredientProtoId: "ing062", quantity: 1 },
    ],
  },
  {
    protoId: "rec034",
    code: "REC-034",
    name: "Japanese Caramel Pudding",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 7200,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing123", quantity: 1 },
      { ingredientProtoId: "ing008", quantity: 100 },
      { ingredientProtoId: "ing004", quantity: 1 },
      { ingredientProtoId: "ing005", quantity: 1 },
      { ingredientProtoId: "ing086", quantity: 1 },
      { ingredientProtoId: "ing022", quantity: 1 },
    ],
  },
  {
    protoId: "rec035",
    code: "REC-035",
    name: "Katsu Bento",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 31600,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    modifierGroupProtoIds: ["mg-05"],
    ingredients: [
      { ingredientProtoId: "ing115", quantity: 1 },
      { ingredientProtoId: "ing023", quantity: 67.5 },
      { ingredientProtoId: "ing088", quantity: 7.5 },
      { ingredientProtoId: "ing014", quantity: 117 },
      { ingredientProtoId: "ing089", quantity: 1.25 },
      { ingredientProtoId: "ing103", quantity: 1 },
      { ingredientProtoId: "ing104", quantity: 1 },
      { ingredientProtoId: "ing094", quantity: 1 },
      { ingredientProtoId: "ing096", quantity: 1 },
    ],
  },
];

// Exclusion modifier mappings
export const RECIPE_MODIFIER_EXCLUSIONS: {
  recipeProtoId: string;
  modifierProtoId: string;
  ingredientProtoId: string;
}[] = [
  { recipeProtoId: "rec001", modifierProtoId: "mod-09", ingredientProtoId: "ing015" },
  { recipeProtoId: "rec002", modifierProtoId: "mod-08", ingredientProtoId: "ing002" },
  { recipeProtoId: "rec003", modifierProtoId: "mod-10", ingredientProtoId: "ing008" },
  { recipeProtoId: "rec007", modifierProtoId: "mod-10", ingredientProtoId: "ing008" },
  { recipeProtoId: "rec008", modifierProtoId: "mod-10", ingredientProtoId: "ing008" },
];

// ──────────────────────────────────────────
// GENERATED ORDERS (150 orders)
// ──────────────────────────────────────────

const BRANCH_CODES = [
  "WYG-01",
  "DRM-01",
  "TGL-01",
  "MLY-01",
  "JMB-01",
  "SWL-01",
  "JMB-01",
  "PCG-01",
  "SWL-01",
];
const CHANNELS: Array<"Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in"> = [
  "Gofood",
  "Grabfood",
  "ShopeeFood",
  "Dine-in",
];
const ORDER_STATUSES: Array<
  "New" | "Processing" | "In Delivery" | "Completed" | "Void" | "Cancel Requested"
> = ["New", "Processing", "In Delivery", "Completed", "Void", "Cancel Requested"];
const RECIPE_PROTO_IDS = [
  "rec001",
  "rec002",
  "rec003",
  "rec004",
  "rec005",
  "rec006",
  "rec007",
  "rec008",
  "rec009",
  "rec010",
  "rec011",
  "rec012",
  "rec013",
  "rec014",
  "rec015",
  "rec016",
  "rec017",
  "rec018",
];
const RECIPE_PRICES: Record<string, number> = {
  rec001: 35000,
  rec002: 48000,
  rec003: 42000,
  rec004: 25000,
  rec005: 12000,
  rec006: 38000,
  rec007: 36000,
  rec008: 52000,
  rec009: 15000,
  rec010: 22000,
  rec011: 65000,
  rec012: 32000,
  rec013: 85000,
  rec014: 22000,
  rec015: 28000,
  rec016: 55000,
  rec017: 45000,
  rec018: 18000,
};

export const ORDERS_DATA = (() => {
  const orders: {
    idx: number;
    branchCode: string;
    channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
    status: "New" | "Processing" | "In Delivery" | "Completed" | "Void" | "Cancel Requested";
    subtotal: number;
    merchantDiscount: number;
    platformDiscount: number;
    taxAmount: number;
    totalAmount: number;
    totalCogs: number;
    mdrFee: number;
    netSales: number;
    orderCode: string;
    createdAt: Date;
    items: {
      recipeProtoId: string;
      quantity: number;
      price: number;
      cogsAtTransaction: number;
      brandProtoId: string;
    }[];
    voucherCode?: string;
    voucherDiscount?: number;
  }[] = [];

  for (let i = 1; i <= 150; i++) {
    const branchCode = BRANCH_CODES[(i - 1) % BRANCH_CODES.length];
    const channel = CHANNELS[(i - 1) % CHANNELS.length];
    const statusIdx = i % 20;
    let status: (typeof ORDER_STATUSES)[number];
    if (statusIdx < 3) status = "New";
    else if (statusIdx < 6) status = "Processing";
    else if (statusIdx < 8) status = "In Delivery";
    else if (statusIdx < 17) status = "Completed";
    else if (statusIdx < 19) status = "Void";
    else status = "Cancel Requested";

    // Days ago: spread across 60 days, more recent orders have more "New" status.
    // Ensure "New" and "Processing" orders always land on today (daysAgo: 0)
    // so the dashboard "Penjualan Hari Ini" shows non-zero sales.
    const daysAgo =
      status === "New" ? 0 : status === "Processing" ? 0 : Math.floor(Math.random() * 60);
    const hour = 8 + (i % 14);
    const minute = (i * 7) % 60;

    const numItems = 1 + (i % 3);
    const items: (typeof orders)[0]["items"] = [];
    let subtotal = 0;
    let totalCogs = 0;

    for (let j = 0; j < numItems; j++) {
      const rId = RECIPE_PROTO_IDS[(i + j) % RECIPE_PROTO_IDS.length];
      const price = RECIPE_PRICES[rId] || 35000;
      const qty = 1 + ((i + j) % 4);
      const cogs = Math.round(price * 0.4);
      items.push({
        recipeProtoId: rId,
        quantity: qty,
        price,
        cogsAtTransaction: cogs,
        brandProtoId: "brand-1",
      });
      subtotal += price * qty;
      totalCogs += cogs * qty;
    }

    const tax = Math.round(subtotal * 0.1);
    const mdrFee = channel === "Dine-in" ? 0 : Math.round(subtotal * 0.2);
    const netSales = subtotal - mdrFee;

    const chCode =
      channel === "Gofood"
        ? "GF"
        : channel === "Grabfood"
          ? "GR"
          : channel === "ShopeeFood"
            ? "SF"
            : "DI";
    const orderCode = `${chCode}-${20250000 + i}`;

    const voucherCode = i % 15 === 0 ? "PROMO10" : i % 23 === 0 ? "FREESHIP" : undefined;
    const voucherDiscount = voucherCode === "PROMO10" ? Math.round(subtotal * 0.1) : undefined;

    orders.push({
      idx: i,
      branchCode,
      channel,
      status,
      subtotal,
      merchantDiscount: 0,
      platformDiscount: 0,
      taxAmount: tax,
      totalAmount: subtotal + tax - (voucherDiscount || 0),
      totalCogs,
      mdrFee,
      netSales: netSales - (voucherDiscount || 0),
      orderCode,
      createdAt: dateAt(daysAgo, hour, minute),
      items,
      voucherCode,
      voucherDiscount,
    });
  }
  return orders;
})();

// ──────────────────────────────────────────
// PURCHASE REQUISITIONS
// ──────────────────────────────────────────

export const PURCHASE_REQUISITIONS_DATA = (() => {
  const prs: {
    code: string;
    branchCode: string;
    status: "Draft" | "Pending" | "Approved" | "Processed" | "Rejected" | "Fulfilled";
    requestedByEmail: string;
    approvedByEmail?: string;
    notes?: string;
    rejectionReason?: string;
    isAutoGenerated: boolean;
    createdAt: Date;
    items: { ingredientProtoId: string; quantity: number }[];
  }[] = [];
  const statuses: Array<"Draft" | "Pending" | "Approved" | "Processed" | "Rejected" | "Fulfilled"> =
    ["Draft", "Pending", "Approved", "Processed", "Rejected", "Fulfilled"];
  const prIngredients = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing005",
    "ing007",
    "ing012",
    "ing013",
  ];
  for (let i = 1; i <= 25; i++) {
    const status = statuses[i % statuses.length];
    prs.push({
      code: `PR-${2025}${String(i).padStart(3, "0")}`,
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      status,
      requestedByEmail:
        i % 3 === 0
          ? "andi.wiyung@omoiyari.net"
          : i % 3 === 1
            ? "citra.tenggilis@omoiyari.net"
            : "budi.darmo@omoiyari.net",
      approvedByEmail:
        status === "Approved" || status === "Processed" || status === "Fulfilled"
          ? "pusat@omoiyari.net"
          : undefined,
      notes: `Permintaan pembelian batch ${i}`,
      rejectionReason: status === "Rejected" ? "Stok masih mencukupi" : undefined,
      isAutoGenerated: i % 5 === 0,
      createdAt: nDaysAgo(i % 30),
      items: [
        { ingredientProtoId: prIngredients[i % prIngredients.length], quantity: 1000 + i * 500 },
        {
          ingredientProtoId: prIngredients[(i + 1) % prIngredients.length],
          quantity: 500 + i * 300,
        },
      ],
    });
  }
  return prs;
})();

// ──────────────────────────────────────────
// PURCHASE ORDERS
// ──────────────────────────────────────────

export const PURCHASE_ORDERS_DATA = (() => {
  const pos: {
    code: string;
    prCode?: string;
    supplierCode: string;
    fromBranchCode: string;
    toBranchCode: string;
    status: "Draft" | "Sent" | "Partial" | "Completed" | "Cancelled";
    notes?: string;
    createdByEmail: string;
    createdAt: Date;
    items: {
      ingredientProtoId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      receivedQuantity?: number;
    }[];
  }[] = [];
  const statuses: Array<"Draft" | "Sent" | "Partial" | "Completed" | "Cancelled"> = [
    "Draft",
    "Sent",
    "Partial",
    "Completed",
    "Cancelled",
  ];
  const poIngredients = ["ing001", "ing002", "ing003", "ing004", "ing005"];
  const suppliers = ["SUP-001", "SUP-002", "SUP-003", "SUP-004"];
  // For Partial POs, the % of ordered qty that has actually arrived (varies deterministically)
  const partialRatios = [0.6, 0.75, 0.8, 0.55];
  for (let i = 1; i <= 20; i++) {
    const qty = 1000 + i * 500;
    const unitPrice = 35000 + i * 2000;
    const status = statuses[i % statuses.length];
    const receivedQuantity =
      status === "Completed"
        ? qty
        : status === "Partial"
          ? Math.round(qty * partialRatios[i % partialRatios.length])
          : 0;
    pos.push({
      code: `PO-${2025}${String(i).padStart(3, "0")}`,
      prCode: i <= 15 ? `PR-${2025}${String(i).padStart(3, "0")}` : undefined,
      supplierCode: suppliers[i % suppliers.length],
      fromBranchCode: "CENTRAL",
      toBranchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      status,
      notes: `Purchase order untuk stok batch ${i}`,
      createdByEmail: "pusat@omoiyari.net",
      createdAt: nDaysAgo((i % 20) + 1),
      items: [
        {
          ingredientProtoId: poIngredients[i % poIngredients.length],
          quantity: qty,
          unitPrice,
          totalPrice: qty * unitPrice,
          receivedQuantity,
        },
      ],
    });
  }
  return pos;
})();

// ──────────────────────────────────────────
// DELIVERY NOTES
// ──────────────────────────────────────────

export const DELIVERY_NOTES_DATA = (() => {
  const dns: {
    code: string;
    prCode?: string;
    poCode?: string;
    fromBranchCode: string;
    toBranchCode: string;
    status: "Draft" | "Picking" | "In Transit" | "Received" | "Cancelled";
    driverName?: string;
    vehicleNumber?: string;
    createdAt: Date;
    items: {
      ingredientProtoId: string;
      quantity: number;
      readyQuantity?: number;
      pickedQuantity?: number;
      receivedQuantity?: number;
      rejectedQuantity?: number;
      rejectionDisposition?: "Return to Source" | "Scrap" | "Quarantine";
    }[];
  }[] = [];
  const statuses: Array<"Draft" | "Picking" | "In Transit" | "Received" | "Cancelled"> = [
    "Draft",
    "Picking",
    "In Transit",
    "Received",
    "Received",
    "Received",
    "Cancelled",
  ];
  const dnIngredients = ["ing001", "ing002", "ing003", "ing004", "ing005", "ing007", "ing012"];
  // Per-DN rejection pattern: 7 of 18 DNs have rejections with varied quantity
  // and a realistic disposition distribution (~57% Return to Source, ~29% Scrap, ~14% Quarantine)
  const rejectionPattern: Record<
    number,
    { quantity: number; disposition: "Return to Source" | "Scrap" | "Quarantine" }
  > = {
    7: { quantity: 30, disposition: "Return to Source" },
    10: { quantity: 50, disposition: "Scrap" },
    11: { quantity: 75, disposition: "Return to Source" },
    13: { quantity: 40, disposition: "Quarantine" },
    14: { quantity: 100, disposition: "Return to Source" },
    16: { quantity: 60, disposition: "Scrap" },
    17: { quantity: 80, disposition: "Return to Source" },
  };
  for (let i = 1; i <= 18; i++) {
    const status = statuses[i % statuses.length];
    const qty = 2000 + i * 400;
    const rej = rejectionPattern[i];
    dns.push({
      code: `SJ-${2025}${String(i).padStart(3, "0")}`,
      prCode: i <= 12 ? `PR-${2025}${String(i).padStart(3, "0")}` : undefined,
      poCode: i <= 15 ? `PO-${2025}${String(i).padStart(3, "0")}` : undefined,
      fromBranchCode: "CENTRAL",
      toBranchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      status,
      driverName: `Supir ${i}`,
      vehicleNumber: `L ${1234 + i} XYZ`,
      createdAt: nDaysAgo((i % 15) + 1),
      items: [
        {
          ingredientProtoId: dnIngredients[i % dnIngredients.length],
          quantity: qty,
          readyQuantity: status !== "Draft" ? qty : undefined,
          pickedQuantity: status === "In Transit" || status === "Received" ? qty : undefined,
          receivedQuantity: status === "Received" ? qty : undefined,
          rejectedQuantity: rej?.quantity ?? 0,
          rejectionDisposition: rej?.disposition,
        },
      ],
    });
  }
  return dns;
})();

// ──────────────────────────────────────────
// SCM INVOICES
// ──────────────────────────────────────────

export const SCM_INVOICES_DATA = (() => {
  const invs: {
    code: string;
    dnCode: string;
    fromBranchCode: string;
    toBranchCode: string;
    totalAmount: number;
    status: "Unpaid" | "Paid" | "Cancelled";
    dueDate: Date;
    paidAt?: Date;
  }[] = [];
  for (let i = 1; i <= 15; i++) {
    const amount = 1500000 + i * 250000;
    const status = i % 4 === 0 ? "Unpaid" : i % 7 === 0 ? "Cancelled" : "Paid";
    invs.push({
      code: `INV-SCM-${2025}${String(i).padStart(3, "0")}`,
      dnCode: `SJ-${2025}${String(i).padStart(3, "0")}`,
      fromBranchCode: "CENTRAL",
      toBranchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      totalAmount: amount,
      status,
      dueDate: nDaysAgo(-7),
      paidAt: status === "Paid" ? nDaysAgo(2) : undefined,
    });
  }
  return invs;
})();

// ──────────────────────────────────────────
// STOCK OPNAME
// ──────────────────────────────────────────

export const STOCK_OPNAME_DATA = (() => {
  const sos: {
    branchCode: string;
    date: string;
    status: "Submitted" | "Approved" | "Under Investigation";
    triggeredByEmail: string;
    submittedByEmail: string;
    approvedByEmail?: string;
    createdAt: Date;
    items: {
      ingredientProtoId: string;
      systemStock: number;
      physicalStock: number;
      variance: number;
      investigationNote?: string;
    }[];
  }[] = [];
  const statuses: Array<"Submitted" | "Approved" | "Under Investigation"> = [
    "Submitted",
    "Approved",
    "Under Investigation",
  ];
  const soIngredients = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing007",
    "ing012",
    "ing016",
    "ing017",
  ];
  for (let i = 1; i <= 20; i++) {
    const status = statuses[i % statuses.length];
    const branchCode = BRANCH_CODES[i % BRANCH_CODES.length];
    const items = [];
    for (let j = 0; j < 3; j++) {
      const sysStock = 5000 + j * 2000;
      const variance = (i + j) % 5 === 0 ? -200 : (i + j) % 3 === 0 ? 150 : 0;
      items.push({
        ingredientProtoId: soIngredients[(i + j) % soIngredients.length],
        systemStock: sysStock,
        physicalStock: sysStock + variance,
        variance,
        investigationNote: variance !== 0 ? `Selisih ${variance} butuh investigasi` : undefined,
      });
    }
    sos.push({
      branchCode,
      date: new Date(Date.now() - i * 86400000).toISOString().split("T")[0],
      status,
      triggeredByEmail: "superadmin@omoiyari.net",
      submittedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "citra.tenggilis@omoiyari.net",
      approvedByEmail: status === "Approved" ? "pusat@omoiyari.net" : undefined,
      createdAt: nDaysAgo(i),
      items,
    });
  }
  return sos;
})();

// ──────────────────────────────────────────
// PERIOD LOGS
// ──────────────────────────────────────────

export const PERIOD_LOGS_DATA = [
  {
    periodName: "Januari 2026",
    status: "Closed" as const,
    openedAt: new Date("2026-01-01T00:00:00Z"),
    closedAt: new Date("2026-01-31T23:59:59Z"),
    openedByEmail: "superadmin@omoiyari.net",
    closedByEmail: "superadmin@omoiyari.net",
  },
  {
    periodName: "Februari 2026",
    status: "Closed" as const,
    openedAt: new Date("2026-02-01T00:00:00Z"),
    closedAt: new Date("2026-02-28T23:59:59Z"),
    openedByEmail: "superadmin@omoiyari.net",
    closedByEmail: "superadmin@omoiyari.net",
  },
  {
    periodName: "Maret 2026",
    status: "Closed" as const,
    openedAt: new Date("2026-03-01T00:00:00Z"),
    closedAt: new Date("2026-03-31T23:59:59Z"),
    openedByEmail: "superadmin@omoiyari.net",
    closedByEmail: "superadmin@omoiyari.net",
  },
  {
    periodName: "April 2026",
    status: "Closed" as const,
    openedAt: new Date("2026-04-01T00:00:00Z"),
    closedAt: new Date("2026-04-30T23:59:59Z"),
    openedByEmail: "superadmin@omoiyari.net",
    closedByEmail: "superadmin@omoiyari.net",
  },
  {
    periodName: "Mei 2026",
    status: "Closed" as const,
    openedAt: new Date("2026-05-01T00:00:00Z"),
    closedAt: new Date("2026-05-31T23:59:59Z"),
    openedByEmail: "superadmin@omoiyari.net",
    closedByEmail: "superadmin@omoiyari.net",
  },
  {
    periodName: "Juni 2026",
    status: "Open" as const,
    openedAt: new Date("2026-06-01T00:00:00Z"),
    openedByEmail: "superadmin@omoiyari.net",
  },
];

// ──────────────────────────────────────────
// SYSTEM NOTIFICATIONS
// ──────────────────────────────────────────

export const SYSTEM_NOTIFICATIONS_DATA = (() => {
  const notifs: {
    userEmail: string;
    title: string;
    message: string;
    type: "info" | "warning" | "alert";
    isRead: boolean;
    createdAt: Date;
  }[] = [];
  const titles = [
    "Stok Rendah: Beras Premium",
    "Order Baru Masuk",
    "Transfer Stok Disetujui",
    "Periode Ditutup",
    "Penerimaan Barang Selesai",
    "Pembatalan Order",
    "Harga Bahan Naik",
    "Shift Dibuka",
    "SO Disetujui",
    "Invoice Jatuh Tempo",
  ];
  const messages = [
    "Stok Beras Premium di WYG-01 sudah di bawah ROP",
    "Ada order baru yang perlu diproses",
    "Transfer stok dari Pusat telah disetujui",
    "Periode bulan ini telah ditutup",
    "Barang dari supplier telah diterima",
    "Ada permintaan pembatalan order",
    "Harga bahan baku mengalami kenaikan",
    "Shift baru telah dibuka oleh kasir",
    "Stock opname telah disetujui oleh admin",
    "Ada invoice yang mendekati jatuh tempo",
  ];
  const userEmails = [
    "superadmin@omoiyari.net",
    "pusat@omoiyari.net",
    "andi.wiyung@omoiyari.net",
    "citra.tenggilis@omoiyari.net",
    "budi.darmo@omoiyari.net",
  ];
  for (let i = 1; i <= 40; i++) {
    notifs.push({
      userEmail: userEmails[i % userEmails.length],
      title: titles[i % titles.length],
      message: messages[i % messages.length],
      type: i % 5 === 0 ? "alert" : i % 3 === 0 ? "warning" : "info",
      isRead: i % 3 === 0,
      createdAt: nHoursAgo(i * 2),
    });
  }
  return notifs;
})();

// ──────────────────────────────────────────
// CANCEL REQUESTS
// ──────────────────────────────────────────

export const CANCEL_REQUESTS_DATA = (() => {
  const crs: {
    orderIdx: number;
    reason: "Stok Habis" | "Salah Input" | "Customer Cancel";
    detail?: string;
    requestedByEmail: string;
    approvedByEmail?: string;
    status: "Pending" | "Approved" | "Rejected";
    createdAt: Date;
  }[] = [];
  const reasons: Array<"Stok Habis" | "Salah Input" | "Customer Cancel"> = [
    "Stok Habis",
    "Salah Input",
    "Customer Cancel",
  ];
  for (let i = 1; i <= 12; i++) {
    const status = i % 3 === 0 ? "Pending" : i % 3 === 1 ? "Approved" : "Rejected";
    crs.push({
      orderIdx: 100 + i * 3,
      reason: reasons[i % reasons.length],
      detail: `Detail pembatalan order ${100 + i * 3}`,
      requestedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "citra.tenggilis@omoiyari.net",
      approvedByEmail: status !== "Pending" ? "superadmin@omoiyari.net" : undefined,
      status,
      createdAt: nDaysAgo(i % 10),
    });
  }
  return crs;
})();

// ──────────────────────────────────────────
// PRINT REQUESTS
// ──────────────────────────────────────────

export const PRINT_REQUESTS_DATA = (() => {
  const prs: {
    orderIdx: number;
    requestType: string;
    requestedByEmail: string;
    approvedByEmail?: string;
    status: "Pending" | "Approved" | "Rejected";
    createdAt: Date;
  }[] = [];
  const types = ["reprint_kitchen", "reprint_customer", "reprint_summary"];
  for (let i = 1; i <= 12; i++) {
    const status = i % 3 === 0 ? "Pending" : i % 3 === 1 ? "Approved" : "Rejected";
    prs.push({
      orderIdx: 100 + i * 4,
      requestType: types[i % types.length],
      requestedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "budi.darmo@omoiyari.net",
      approvedByEmail: status !== "Pending" ? "superadmin@omoiyari.net" : undefined,
      status,
      createdAt: nDaysAgo(i % 7),
    });
  }
  return prs;
})();

// ──────────────────────────────────────────
// MANUAL REVENUES
// ──────────────────────────────────────────

export const MANUAL_REVENUES_DATA = (() => {
  const mrs: {
    branchCode: string;
    date: string;
    amount: number;
    notes?: string;
    submittedByEmail: string;
    createdAt: Date;
  }[] = [];
  for (let i = 1; i <= 30; i++) {
    mrs.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      date: new Date(Date.now() - (i % 30) * 86400000).toISOString().split("T")[0],
      amount: 500000 + i * 75000,
      notes: `Pendapatan manual batch ${i}`,
      submittedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "citra.tenggilis@omoiyari.net",
      createdAt: nDaysAgo(i % 30),
    });
  }
  return mrs;
})();

// ──────────────────────────────────────────
// CHANNEL REVENUES
// ──────────────────────────────────────────

export const CHANNEL_REVENUES_DATA = (() => {
  const crs: {
    branchCode: string;
    date: string;
    channel: "Gofood" | "Grabfood" | "ShopeeFood" | "Dine-in";
    amount: number;
    notes?: string;
    submittedByEmail: string;
  }[] = [];
  for (let i = 1; i <= 40; i++) {
    crs.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      date: new Date(Date.now() - (i % 30) * 86400000).toISOString().split("T")[0],
      channel: CHANNELS[i % CHANNELS.length],
      amount: 2500000 + i * 125000,
      notes: `Revenue ${CHANNELS[i % CHANNELS.length]} batch ${i}`,
      submittedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "budi.darmo@omoiyari.net",
    });
  }
  return crs;
})();

// ──────────────────────────────────────────
// YIELD CONVERSIONS
// ──────────────────────────────────────────

export const YIELD_CONVERSIONS_DATA = (() => {
  const ycs: {
    branchCode: string;
    sourceIngredientProtoId: string;
    sourceQuantity: number;
    targetIngredientProtoId: string;
    targetQuantity: number;
    yieldPercentage: string;
    shrinkageQuantity: number;
    notes?: string;
    processedByEmail: string;
    createdAt: Date;
  }[] = [];
  const conversions = [
    {
      source: "ing001",
      target: "ing-sfg-001",
      srcQty: 5000,
      tgtQty: 4500,
      yield: "90.00",
      shrink: 500,
    },
    {
      source: "ing002",
      target: "ing-sfg-002",
      srcQty: 3000,
      tgtQty: 2700,
      yield: "90.00",
      shrink: 300,
    },
    {
      source: "ing003",
      target: "ing-sfg-003",
      srcQty: 2000,
      tgtQty: 1700,
      yield: "85.00",
      shrink: 300,
    },
    { source: "ing007", target: "ing-sfg-012", srcQty: 30, tgtQty: 28, yield: "93.33", shrink: 2 },
    {
      source: "ing018",
      target: "ing-sfg-001",
      srcQty: 1200,
      tgtQty: 1000,
      yield: "83.33",
      shrink: 200,
    },
  ];
  for (let i = 1; i <= 20; i++) {
    const conv = conversions[i % conversions.length];
    ycs.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      sourceIngredientProtoId: conv.source,
      sourceQuantity: conv.srcQty + i * 100,
      targetIngredientProtoId: conv.target,
      targetQuantity: conv.tgtQty + i * 90,
      yieldPercentage: conv.yield,
      shrinkageQuantity: conv.shrink + i * 10,
      notes: `Yield processing batch ${i}`,
      processedByEmail: i % 2 === 0 ? "ck@omoiyari.net" : "andi.wiyung@omoiyari.net",
      createdAt: nDaysAgo((i % 20) + 1),
    });
  }
  return ycs;
})();

// ──────────────────────────────────────────
// WASTE ENTRIES
// ──────────────────────────────────────────

export const WASTE_ENTRIES_DATA = (() => {
  const wastes: {
    branchCode: string;
    ingredientProtoId: string;
    quantity: number;
    category: "Beban Makan" | "Biaya Operasional" | "Spoiled";
    notes?: string;
    investigationNote?: string;
    submittedByEmail: string;
    createdAt: Date;
  }[] = [];
  const wasteIngredients = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing007",
    "ing012",
    "ing016",
    "ing017",
  ];
  const categories: Array<"Beban Makan" | "Biaya Operasional" | "Spoiled"> = [
    "Beban Makan",
    "Biaya Operasional",
    "Spoiled",
  ];
  for (let i = 1; i <= 35; i++) {
    const cat = categories[i % categories.length];
    wastes.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      ingredientProtoId: wasteIngredients[i % wasteIngredients.length],
      quantity: 50 + i * 25,
      category: cat,
      notes:
        cat === "Beban Makan"
          ? "Konsumsi karyawan"
          : cat === "Biaya Operasional"
            ? "Rusak saat proses"
            : `Kedaluwarsa batch ${i}`,
      investigationNote: i % 5 === 0 ? "Perlu investigasi lebih lanjut" : undefined,
      submittedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "citra.tenggilis@omoiyari.net",
      createdAt: nDaysAgo(i % 25),
    });
  }
  return wastes;
})();

// ──────────────────────────────────────────
// OPERATIONAL EXPENSES
// ──────────────────────────────────────────

export const OPERATIONAL_EXPENSES_DATA = (() => {
  const oes: {
    branchCode: string;
    category: string;
    amount: number;
    date: string;
    notes?: string;
    submittedByEmail: string;
  }[] = [];
  const categories = ["Listrik", "Air", "Gas", "Sewa", "Perbaikan", "ATK", "Transport"];
  for (let i = 1; i <= 25; i++) {
    oes.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      category: categories[i % categories.length],
      amount: 500000 + i * 100000,
      date: new Date(Date.now() - (i % 30) * 86400000).toISOString().split("T")[0],
      notes: `Biaya ${categories[i % categories.length]} bulan ini`,
      submittedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "budi.darmo@omoiyari.net",
    });
  }
  return oes;
})();

// ──────────────────────────────────────────
// STOCK TRANSFERS
// ──────────────────────────────────────────

export const STOCK_TRANSFERS_DATA = (() => {
  const sts: {
    code: string;
    fromBranchCode: string;
    toBranchCode: string;
    ingredientProtoId: string;
    quantity: number;
    status: "Pending Approval" | "Approved" | "Rejected" | "In Transit" | "Completed" | "Cancelled";
    requestedByEmail: string;
    approvedByEmail?: string;
    rejectionReason?: string;
    rejectedByEmail?: string;
    createdAt: Date;
  }[] = [];
  const statuses: Array<
    "Pending Approval" | "Approved" | "Rejected" | "In Transit" | "Completed" | "Cancelled"
  > = [
    "Pending Approval",
    "Pending Approval",
    "Approved",
    "In Transit",
    "Completed",
    "Completed",
    "Completed",
    "Rejected",
    "Cancelled",
  ];
  const tfIngredients = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing005",
    "ing007",
    "ing012",
    "ing016",
    "ing017",
  ];
  for (let i = 1; i <= 30; i++) {
    const status = statuses[i % statuses.length];
    sts.push({
      code: `TR-${2025}${String(i).padStart(3, "0")}`,
      fromBranchCode: "CENTRAL",
      toBranchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      ingredientProtoId: tfIngredients[i % tfIngredients.length],
      quantity: 1000 + i * 500,
      status,
      requestedByEmail: i % 2 === 0 ? "andi.wiyung@omoiyari.net" : "citra.tenggilis@omoiyari.net",
      approvedByEmail:
        status === "Approved" || status === "In Transit" || status === "Completed"
          ? "pusat@omoiyari.net"
          : undefined,
      rejectionReason: status === "Rejected" ? "Stok pusat tidak mencukupi" : undefined,
      rejectedByEmail: status === "Rejected" ? "pusat@omoiyari.net" : undefined,
      createdAt: nDaysAgo((i % 20) + 1),
    });
  }
  return sts;
})();

// ──────────────────────────────────────────
// SUPPLIER DELIVERIES
// ──────────────────────────────────────────

export const SUPPLIER_DELIVERIES_DATA = (() => {
  const sds: {
    supplierCode?: string;
    supplierName: string;
    ingredientProtoId: string;
    quantity: number;
    price: number;
    deliveryDate: Date;
    receivedByEmail: string;
    status: "Pending Invoice" | "Completed";
  }[] = [];
  const deliveries = [
    { supCode: "SUP-001", supName: "PT Beras Makmur", ing: "ing001", qty: 500000, price: 7000000 },
    { supCode: "SUP-002", supName: "CV Ayam Segar", ing: "ing002", qty: 50000, price: 2250000 },
    {
      supCode: "SUP-003",
      supName: "Importir Sapi Jaya",
      ing: "ing003",
      qty: 30000,
      price: 3450000,
    },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing004", qty: 25000, price: 600000 },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing005", qty: 25000, price: 675000 },
    { supCode: "SUP-005", supName: "CV Seafood Prima", ing: "ing028", qty: 15000, price: 2700000 },
    {
      supCode: "SUP-006",
      supName: "PT Sayur Segar Indonesia",
      ing: "ing009",
      qty: 50000,
      price: 750000,
    },
    { supCode: "SUP-007", supName: "CV Bumbu Nusantara", ing: "ing015", qty: 10000, price: 850000 },
    { supCode: "SUP-008", supName: "PT Packaging Jaya", ing: "ing016", qty: 5000, price: 7500000 },
    { supCode: "SUP-001", supName: "PT Beras Makmur", ing: "ing001", qty: 250000, price: 3500000 },
    { supCode: "SUP-002", supName: "CV Ayam Segar", ing: "ing002", qty: 30000, price: 1350000 },
    {
      supCode: "SUP-003",
      supName: "Importir Sapi Jaya",
      ing: "ing003",
      qty: 20000,
      price: 2300000,
    },
    {
      supCode: "SUP-006",
      supName: "PT Sayur Segar Indonesia",
      ing: "ing010",
      qty: 30000,
      price: 750000,
    },
    { supCode: "SUP-008", supName: "PT Packaging Jaya", ing: "ing017", qty: 3000, price: 1350000 },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing004", qty: 15000, price: 360000 },
  ];
  for (let i = 0; i < deliveries.length; i++) {
    const d = deliveries[i];
    sds.push({
      supplierCode: d.supCode,
      supplierName: d.supName,
      ingredientProtoId: d.ing,
      quantity: d.qty,
      price: d.price,
      deliveryDate: new Date(Date.now() - (i + 1) * 86400000),
      receivedByEmail: i % 2 === 0 ? "superadmin@omoiyari.net" : "pusat@omoiyari.net",
      status: i % 3 === 0 ? "Pending Invoice" : "Completed",
    });
  }
  // Add more deliveries with variations
  for (let i = 16; i <= 35; i++) {
    const d = deliveries[i % deliveries.length];
    sds.push({
      supplierCode: d.supCode,
      supplierName: d.supName,
      ingredientProtoId: d.ing,
      quantity: d.qty + i * 100,
      price: d.price + i * 10000,
      deliveryDate: new Date(Date.now() - i * 86400000),
      receivedByEmail: i % 2 === 0 ? "superadmin@omoiyari.net" : "pusat@omoiyari.net",
      status: i % 4 === 0 ? "Pending Invoice" : "Completed",
    });
  }
  return sds;
})();

// ──────────────────────────────────────────
// STOCK LEDGER
// ──────────────────────────────────────────

export const STOCK_LEDGER_DATA = (() => {
  const entries: {
    branchCode: string;
    ingredientProtoId: string;
    type: "IN" | "OUT";
    quantity: number;
    reference: string;
    notes?: string;
    dayAgo: number;
  }[] = [];
  const ledgerIngredients = [
    "ing001",
    "ing002",
    "ing003",
    "ing004",
    "ing007",
    "ing012",
    "ing016",
    "ing017",
  ];
  const refs = ["POS", "DELIVERY", "TRANSFER", "WASTE", "ADJUSTMENT", "YIELD"];
  for (let i = 1; i <= 100; i++) {
    const ref = refs[i % refs.length];
    // Assign IN/OUT based on reference type, not arbitrary index.
    // WASTE is always OUT; POS is always OUT; DELIVERY is always IN;
    // others alternate by index (transfer direction varies).
    let isIn: boolean;
    if (ref === "WASTE" || ref === "POS") isIn = false;
    else if (ref === "DELIVERY") isIn = true;
    else isIn = i % 3 === 0;
    entries.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      ingredientProtoId: ledgerIngredients[i % ledgerIngredients.length],
      type: isIn ? "IN" : "OUT",
      quantity: 100 + i * 50,
      reference: `${ref}-${20250000 + i}`,
      notes: `${isIn ? "Masuk" : "Keluar"} stok ${ledgerIngredients[i % ledgerIngredients.length]}`,
      dayAgo: i % 30,
    });
  }
  return entries;
})();

// ──────────────────────────────────────────
// SYSTEM LOGS
// ──────────────────────────────────────────

export const SYSTEM_LOGS_DATA = (() => {
  const logs: {
    action: string;
    detail: string;
    userName: string;
    status: "Success" | "Warning" | "Error";
    createdAt: Date;
  }[] = [
    {
      action: "Reset Database",
      detail: "Super Admin mereset seluruh data ke kondisi awal",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(60),
    },
    {
      action: "Pembaruan Resep",
      detail: "Resep Chicken Teriyaki Bowl diperbarui harganya",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(55),
    },
    {
      action: "Penambahan Cabang",
      detail: "Cabang baru Omoiyari Malang ditambahkan",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(50),
    },
    {
      action: "Penerimaan Barang",
      detail: "Penerimaan Beras Premium 500kg dari PT Beras Makmur",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(45),
    },
    {
      action: "Gagal Login",
      detail: "Percobaan login gagal dengan email tidak dikenal",
      userName: "unknown",
      status: "Warning",
      createdAt: nDaysAgo(40),
    },
    {
      action: "Buka Periode",
      detail: "Periode April 2026 dibuka oleh Super Admin",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(35),
    },
    {
      action: "Tutup Periode",
      detail: "Periode Maret 2026 ditutup oleh Super Admin",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(34),
    },
    {
      action: "Penyesuaian Stok",
      detail: "Stock Opname br-sub-01 disetujui",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(30),
    },
    {
      action: "Transfer Stok",
      detail: "Transfer 50kg Beras ke br-sub-01 selesai",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(28),
    },
    {
      action: "Input Pendapatan",
      detail: "Pendapatan manual br-sub-01 diinput",
      userName: "Hans",
      status: "Success",
      createdAt: nDaysAgo(25),
    },
    {
      action: "Hapus Order",
      detail: "Order GF-123 dihapus karena duplikat",
      userName: "Hans",
      status: "Warning",
      createdAt: nDaysAgo(22),
    },
    {
      action: "Update Harga",
      detail: "Harga Beef Yakiniku Bowl naik dari 45rb ke 48rb",
      userName: "Super Admin",
      status: "Success",
      createdAt: nDaysAgo(20),
    },
    {
      action: "Pembuatan PR",
      detail: "PR-001 dibuat oleh Hans untuk stok beras",
      userName: "Hans",
      status: "Success",
      createdAt: nDaysAgo(18),
    },
    {
      action: "Approval PR",
      detail: "PR-001 disetujui oleh Admin Pusat",
      userName: "Admin Pusat",
      status: "Success",
      createdAt: nDaysAgo(17),
    },
    {
      action: "Pembuatan PO",
      detail: "PO-001 dibuat untuk pembelian beras",
      userName: "Admin Pusat",
      status: "Success",
      createdAt: nDaysAgo(16),
    },
    {
      action: "Penerimaan SJ",
      detail: "SJ-001 diterima di WYG-01",
      userName: "Hans",
      status: "Success",
      createdAt: nDaysAgo(14),
    },
    {
      action: "Pembayaran Invoice",
      detail: "Invoice INV-SCM-001 dibayar",
      userName: "Admin Pusat",
      status: "Success",
      createdAt: nDaysAgo(12),
    },
    {
      action: "Input Waste",
      detail: "Waste entry 500gr ayam spoiled diinput",
      userName: "Hans",
      status: "Success",
      createdAt: nDaysAgo(10),
    },
    {
      action: "Yield Processing",
      detail: "Yield 5kg beras jadi 4.5kg nasi",
      userName: "Central Kitchen",
      status: "Success",
      createdAt: nDaysAgo(8),
    },
    {
      action: "Gagal Sync",
      detail: "Sinkronisasi data gagal ke server",
      userName: "System",
      status: "Error",
      createdAt: nDaysAgo(5),
    },
    {
      action: "Cancel Request",
      detail: "Permintaan cancel order GF-456 diajukan",
      userName: "Hans",
      status: "Warning",
      createdAt: nDaysAgo(3),
    },
    {
      action: "Print Request",
      detail: "Permintaan reprint struk GF-789",
      userName: "Siti",
      status: "Success",
      createdAt: nDaysAgo(2),
    },
    {
      action: "Login Berhasil",
      detail: "Hans login ke sistem POS",
      userName: "Hans",
      status: "Success",
      createdAt: nDaysAgo(1),
    },
    {
      action: "Shift Closed",
      detail: "Shift WYG-01 ditutup dengan selisih Rp 12.500",
      userName: "Hans",
      status: "Warning",
      createdAt: nDaysAgo(1),
    },
    {
      action: "Stock Alert",
      detail: "Stok Minyak Goreng DRM-01 di bawah ROP",
      userName: "System",
      status: "Warning",
      createdAt: nHoursAgo(12),
    },
    {
      action: "Order Baru",
      detail: "Order GF-20250150 masuk dari Gofood",
      userName: "System",
      status: "Success",
      createdAt: nHoursAgo(6),
    },
    {
      action: "Update Supplier",
      detail: "Data supplier PT Beras Makmur diperbarui",
      userName: "Super Admin",
      status: "Success",
      createdAt: nHoursAgo(3),
    },
    {
      action: "Rekon Finance",
      detail: "Rekonsiliasi keuangan Mei 2026 selesai",
      userName: "Admin Pusat",
      status: "Success",
      createdAt: nHoursAgo(1),
    },
  ];
  return logs;
})();

// ──────────────────────────────────────────
// RECIPE BRANCHES (per-branch recipe visibility)
// ──────────────────────────────────────────
// Tier rules (post-migration, 7 outlets + CENTRAL warehouse):
//   Core (rec001..rec008):  all 7 outlets                       → 56 rows
//   Mid  (rec009..rec013):  5 outlets (skip PCG-01, SWL-01)     → 25 rows
//   Premium (rec014..rec017): 5 outlets (WYG-01, MLY-01, JMB-01, PCG-01, SWL-01) → 20 rows
//   Snack (rec018):         all 7 outlets                       →  7 rows
//   Staff (rec026..rec029):  all 7 outlets                       → 28 rows
//   Family Pack / BOGO:     subset
// Central (warehouse) intentionally has no rows — it's not a POS.

const OUTLET_BRANCHES = [
  "br-wyg-01",
  "br-drm-01",
  "br-tgl-01",
  "br-mly-01",
  "br-jmb-01",
  "br-pcg-01",
  "br-swl-01",
];
const MID_TIER_BRANCHES = OUTLET_BRANCHES.filter((b) => b !== "br-pcg-01" && b !== "br-swl-01");
const PREMIUM_TIER_BRANCHES = ["br-wyg-01", "br-mly-01", "br-jmb-01", "br-pcg-01", "br-swl-01"];
const FAMILY_PACK_BRANCHES = ["br-wyg-01", "br-jmb-01", "br-swl-01"];
const BOGO_BRANCHES = ["br-wyg-01", "br-drm-01", "br-tgl-01", "br-mly-01"];

export const RECIPE_BRANCHES_DATA: { recipeProtoId: string; branchProtoId: string }[] = (() => {
  const rows: { recipeProtoId: string; branchProtoId: string }[] = [];
  // Core
  for (const r of [
    "rec001",
    "rec002",
    "rec003",
    "rec004",
    "rec005",
    "rec006",
    "rec007",
    "rec008",
  ]) {
    for (const b of OUTLET_BRANCHES) rows.push({ recipeProtoId: r, branchProtoId: b });
  }
  // Mid
  for (const r of ["rec009", "rec010", "rec011", "rec012", "rec013"]) {
    for (const b of MID_TIER_BRANCHES) rows.push({ recipeProtoId: r, branchProtoId: b });
  }
  // Premium
  for (const r of ["rec014", "rec015", "rec016", "rec017"]) {
    for (const b of PREMIUM_TIER_BRANCHES) rows.push({ recipeProtoId: r, branchProtoId: b });
  }
  // Snack (universal)
  for (const b of OUTLET_BRANCHES) rows.push({ recipeProtoId: "rec018", branchProtoId: b });
  // Family Pack
  for (const b of FAMILY_PACK_BRANCHES)
    rows.push({ recipeProtoId: "rec-bundle-01", branchProtoId: b });
  // BOGO (Surabaya pilot)
  for (const b of BOGO_BRANCHES) rows.push({ recipeProtoId: "rec-bogo-01", branchProtoId: b });
  return rows;
})();

// ──────────────────────────────────────────
// YIELD CONVERSION SOURCES (multi-source yield BOMs)
// ──────────────────────────────────────────
// 6 realistic multi-source yield cases (Q4, option A). The first source
// in each `sources` array populates the legacy single-source columns
// on `yield_conversions` (mirrors production behavior in yield.ts).
// All sources populate the `yield_conversion_sources` junction.

export const YIELD_CONVERSION_SOURCES_DATA: {
  branchCode: string;
  sourceIngredientProtoId: string;
  sourceQuantity: number;
  targetIngredientProtoId: string;
  targetQuantity: number;
  yieldPercentage: string;
  shrinkageQuantity: number;
  notes?: string;
  processedByEmail: string;
  createdAt: Date;
  sources: { ingredientProtoId: string; quantity: number }[];
}[] = [
  {
    branchCode: "CENTRAL",
    sourceIngredientProtoId: "ing008", // tulang ayam
    sourceQuantity: 2000,
    targetIngredientProtoId: "ing-sfg-012", // kaldu ayam
    targetQuantity: 4800,
    yieldPercentage: "80.00",
    shrinkageQuantity: 1200,
    notes: "Kaldu ayam: tulang + air + bawang merah (multi-source)",
    processedByEmail: "ck@omoiyari.net",
    createdAt: nDaysAgo(28),
    sources: [
      { ingredientProtoId: "ing008", quantity: 2000 }, // tulang ayam
      { ingredientProtoId: "ing013", quantity: 4000 }, // air
      { ingredientProtoId: "ing023", quantity: 200 }, // bawang merah
    ],
  },
  {
    branchCode: "CENTRAL",
    sourceIngredientProtoId: "ing004", // kecap
    sourceQuantity: 800,
    targetIngredientProtoId: "ing-sfg-004", // teriyaki base
    targetQuantity: 1900,
    yieldPercentage: "79.17",
    shrinkageQuantity: 500,
    notes: "Teriyaki base: kecap + mirin + saus (multi-source)",
    processedByEmail: "ck@omoiyari.net",
    createdAt: nDaysAgo(21),
    sources: [
      { ingredientProtoId: "ing004", quantity: 800 }, // kecap
      { ingredientProtoId: "ing006", quantity: 600 }, // mirin
      { ingredientProtoId: "ing005", quantity: 500 }, // saus
    ],
  },
  {
    branchCode: "CENTRAL",
    sourceIngredientProtoId: "ing028", // udang
    sourceQuantity: 1000,
    targetIngredientProtoId: "ing-sfg-015", // seafood mix
    targetQuantity: 2400,
    yieldPercentage: "80.00",
    shrinkageQuantity: 600,
    notes: "Mixed seafood: udang + cumi + ikan (multi-source)",
    processedByEmail: "ck@omoiyari.net",
    createdAt: nDaysAgo(14),
    sources: [
      { ingredientProtoId: "ing028", quantity: 1000 }, // udang
      { ingredientProtoId: "ing029", quantity: 1000 }, // cumi
      { ingredientProtoId: "ing030", quantity: 1000 }, // ikan
    ],
  },
  {
    branchCode: "CENTRAL",
    sourceIngredientProtoId: "ing021", // bawang putih
    sourceQuantity: 500,
    targetIngredientProtoId: "ing-sfg-010", // bumbu halus
    targetQuantity: 1000,
    yieldPercentage: "83.33",
    shrinkageQuantity: 200,
    notes: "Bumbu halus: bawang putih + jahe + bawang merah (multi-source)",
    processedByEmail: "ck@omoiyari.net",
    createdAt: nDaysAgo(7),
    sources: [
      { ingredientProtoId: "ing021", quantity: 500 }, // bawang putih
      { ingredientProtoId: "ing022", quantity: 300 }, // jahe
      { ingredientProtoId: "ing023", quantity: 400 }, // bawang merah
    ],
  },
  {
    branchCode: "WYG-01",
    sourceIngredientProtoId: "ing024", // wortel
    sourceQuantity: 600,
    targetIngredientProtoId: "ing-sfg-011", // slaw mix
    targetQuantity: 1100,
    yieldPercentage: "78.57",
    shrinkageQuantity: 300,
    notes: "Coleslaw mix: wortel + kol (multi-source)",
    processedByEmail: "andi.wiyung@omoiyari.net",
    createdAt: nDaysAgo(5),
    sources: [
      { ingredientProtoId: "ing024", quantity: 600 }, // wortel
      { ingredientProtoId: "ing025", quantity: 800 }, // kol
    ],
  },
  {
    branchCode: "WYG-01",
    sourceIngredientProtoId: "ing014", // garam
    sourceQuantity: 200,
    targetIngredientProtoId: "ing-sfg-013", // sachet bumbu
    targetQuantity: 1500,
    yieldPercentage: "83.33",
    shrinkageQuantity: 300,
    notes: "Seasoning sachet: garam + gula + kecap (multi-source)",
    processedByEmail: "andi.wiyung@omoiyari.net",
    createdAt: nDaysAgo(2),
    sources: [
      { ingredientProtoId: "ing014", quantity: 200 }, // garam
      { ingredientProtoId: "ing015", quantity: 800 }, // gula
      { ingredientProtoId: "ing004", quantity: 500 }, // kecap
    ],
  },
];
