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
    protoId: "br-sub-01",
    code: "SBY-01",
    name: "Omoiyari Surabaya Pusat",
    location: "Tegalsari, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-sub-02",
    code: "SBY-02",
    name: "Omoiyari Surabaya Barat",
    location: "Sambikerep, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: false,
  },
  {
    protoId: "br-sub-03",
    code: "SBY-03",
    name: "Omoiyari Surabaya Timur",
    location: "Mulyorejo, Surabaya",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-sub-04",
    code: "SBY-04",
    name: "Omoiyari Sidoarjo",
    location: "Waru, Sidoarjo",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-mlg-01",
    code: "MLG-01",
    name: "Omoiyari Malang",
    location: "Lowokwaru, Malang",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-grs-01",
    code: "GRS-01",
    name: "Omoiyari Gresik",
    location: "Kebomas, Gresik",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-jkt-01",
    code: "JKT-01",
    name: "Omoiyari Jakarta Selatan",
    location: "Tebet, Jakarta",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-jkt-02",
    code: "JKT-02",
    name: "Omoiyari Jakarta Barat",
    location: "Puri, Jakarta",
    type: "Outlet" as const,
    active: true,
    isOnline: true,
  },
  {
    protoId: "br-bdg-01",
    code: "BDG-01",
    name: "Omoiyari Bandung",
    location: "Dago, Bandung",
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
    name: "Area Manager East",
    role: "area_manager" as const,
    pin: "3333",
  },
  {
    email: "hans@omoiyari.net",
    password: "password123",
    name: "Hans",
    role: "branch_admin" as const,
    branchCode: "SBY-01",
    pin: "1234",
  },
  {
    email: "siti@omoiyari.net",
    password: "password123",
    name: "Siti",
    role: "branch_admin" as const,
    branchCode: "SBY-02",
    pin: "2345",
  },
  {
    email: "budi@omoiyari.net",
    password: "password123",
    name: "Budi",
    role: "branch_admin" as const,
    branchCode: "SBY-03",
    pin: "3456",
  },
  {
    email: "rina@omoiyari.net",
    password: "password123",
    name: "Rina",
    role: "branch_admin" as const,
    branchCode: "SBY-04",
    pin: "4567",
  },
  {
    email: "dewi@omoiyari.net",
    password: "password123",
    name: "Dewi",
    role: "branch_admin" as const,
    branchCode: "MLG-01",
    pin: "5678",
  },
  {
    email: "ck@omoiyari.net",
    password: "password123",
    name: "Central Kitchen",
    role: "central_kitchen" as const,
    branchCode: "CENTRAL",
  },
];

export const AREA_MANAGER_BRANCHES = ["SBY-01", "SBY-02", "SBY-03", "SBY-04"];

export const INGREDIENTS = [
  {
    protoId: "ing-01",
    code: "ING-001",
    name: "Beras Premium",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Karung 25kg",
    stockUnit: "Gram",
    conversionFactor: 25000,
    averageCost: 350000,
    rop: 50000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-02",
    code: "ING-002",
    name: "Daging Ayam Fillet",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 45000,
    rop: 5000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-03",
    code: "ING-003",
    name: "Daging Sapi Slice",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 115000,
    rop: 3000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-04",
    code: "ING-004",
    name: "Saus Teriyaki",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Jerigen 5L",
    stockUnit: "Ml",
    conversionFactor: 5000,
    averageCost: 120000,
    rop: 10000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-05",
    code: "ING-005",
    name: "Saus Yakiniku",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Jerigen 5L",
    stockUnit: "Ml",
    conversionFactor: 5000,
    averageCost: 135000,
    rop: 10000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-06",
    code: "ING-006",
    name: "Curry Roux",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Box 1kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 180000,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-07",
    code: "ING-007",
    name: "Telur Ayam",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Tray 30pcs",
    stockUnit: "Pcs",
    conversionFactor: 30,
    averageCost: 60000,
    rop: 90,
    moq: 3,
    countable: true,
  },
  {
    protoId: "ing-08",
    code: "ING-008",
    name: "Kentang",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 180000,
    rop: 5000,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-09",
    code: "ING-009",
    name: "Wortel",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 15000,
    rop: 3000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-10",
    code: "ING-010",
    name: "Bawang Bombay",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 25000,
    rop: 3000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-11",
    code: "ING-011",
    name: "Tepung Panko",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 28000,
    rop: 5000,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-12",
    code: "ING-012",
    name: "Minyak Goreng",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pouch 2L",
    stockUnit: "Ml",
    conversionFactor: 2000,
    averageCost: 35000,
    rop: 10000,
    moq: 6,
    countable: true,
  },
  {
    protoId: "ing-13",
    code: "ING-013",
    name: "Kulit Gyoza",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pack 50pcs",
    stockUnit: "Pcs",
    conversionFactor: 50,
    averageCost: 20000,
    rop: 200,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-14",
    code: "ING-014",
    name: "Daging Ayam Cincang",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 42000,
    rop: 5000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-15",
    code: "ING-015",
    name: "Miso Paste",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Tub 1kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 85000,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-19",
    code: "ING-016",
    name: "Tepung Karaage",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 45000,
    rop: 5000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-21",
    code: "ING-017",
    name: "Nori (Rumput Laut)",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pack 50 sheets",
    stockUnit: "Pcs",
    conversionFactor: 50,
    averageCost: 65000,
    rop: 100,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-22",
    code: "ING-018",
    name: "Daging Ayam Utuh (Mentah)",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Ekor",
    stockUnit: "Gram",
    conversionFactor: 1200,
    averageCost: 40000,
    rop: 20000,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-23",
    code: "ING-019",
    name: "Minyak Wijen",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Botol 1L",
    stockUnit: "Ml",
    conversionFactor: 1000,
    averageCost: 55000,
    rop: 2000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-24",
    code: "ING-020",
    name: "Kecap Asin",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Botol 2L",
    stockUnit: "Ml",
    conversionFactor: 2000,
    averageCost: 45000,
    rop: 4000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-25",
    code: "ING-021",
    name: "Garam",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pack 1Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 15000,
    rop: 5000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-26",
    code: "ING-022",
    name: "Gula",
    category: "Dry" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pack 1Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 18000,
    rop: 5000,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-27",
    code: "ING-023",
    name: "Bawang Putih",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 40000,
    rop: 3000,
    moq: 3,
    countable: true,
  },
  {
    protoId: "ing-28",
    code: "ING-042",
    name: "Ikan Salmon Fillet",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 180000,
    rop: 2000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-29",
    code: "ING-043",
    name: "Udang Besar",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Kg",
    stockUnit: "Gram",
    conversionFactor: 1000,
    averageCost: 95000,
    rop: 2000,
    moq: 2,
    countable: true,
  },
  {
    protoId: "ing-30",
    code: "ING-044",
    name: "Keju Mozzarella",
    category: "Fresh" as const,
    skuType: "RM" as const,
    purchaseUnit: "Pack 250g",
    stockUnit: "Gram",
    conversionFactor: 250,
    averageCost: 45000,
    rop: 500,
    moq: 4,
    countable: true,
  },
  // Packaging (FG)
  {
    protoId: "ing-16",
    code: "ING-024",
    name: "Paper Bowl 650ml",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 50pcs",
    stockUnit: "Pcs",
    conversionFactor: 50,
    averageCost: 1500,
    rop: 250,
    moq: 20,
    countable: true,
  },
  {
    protoId: "ing-17",
    code: "ING-025",
    name: "Sumpit & Sendok Set",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 100pcs",
    stockUnit: "Pcs",
    conversionFactor: 100,
    averageCost: 450,
    rop: 500,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-18",
    code: "ING-026",
    name: "Kantong Plastik",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 50pcs",
    stockUnit: "Pcs",
    conversionFactor: 50,
    averageCost: 300,
    rop: 250,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-20",
    code: "ING-027",
    name: "Tusuk Sate",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 100pcs",
    stockUnit: "Pcs",
    conversionFactor: 100,
    averageCost: 100,
    rop: 500,
    moq: 5,
    countable: true,
  },
  {
    protoId: "ing-31",
    code: "ING-045",
    name: "Cup Plastik 16oz",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 50pcs",
    stockUnit: "Pcs",
    conversionFactor: 50,
    averageCost: 1200,
    rop: 200,
    moq: 10,
    countable: true,
  },
  {
    protoId: "ing-32",
    code: "ING-046",
    name: "Tissue Bungkus",
    category: "Packaging" as const,
    skuType: "FG" as const,
    purchaseUnit: "Pack 100pcs",
    stockUnit: "Pcs",
    conversionFactor: 100,
    averageCost: 250,
    rop: 300,
    moq: 5,
    countable: true,
  },
  // Semi-Finished Goods (SFG)
  {
    protoId: "ing-sfg-01",
    code: "ING-028",
    name: "Nasi Putih Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 15,
    rop: 5000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-02",
    code: "ING-029",
    name: "Ayam Teriyaki Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 65,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-03",
    code: "ING-030",
    name: "Beef Yakiniku Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 145,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-04",
    code: "ING-031",
    name: "Chicken Katsu Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 8000,
    rop: 50,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-05",
    code: "ING-032",
    name: "Saus Curry Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Ml",
    stockUnit: "Ml",
    conversionFactor: 1,
    averageCost: 45,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-06",
    code: "ING-033",
    name: "Gyoza Goreng",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 4000,
    rop: 100,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-07",
    code: "ING-034",
    name: "Miso Soup Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Ml",
    stockUnit: "Ml",
    conversionFactor: 1,
    averageCost: 25,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-08",
    code: "ING-035",
    name: "Oyakodon Topping Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Porsi",
    stockUnit: "Porsi",
    conversionFactor: 1,
    averageCost: 12000,
    rop: 30,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-09",
    code: "ING-036",
    name: "Chicken Karaage Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 55,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-10",
    code: "ING-037",
    name: "Tamagoyaki Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 3000,
    rop: 50,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-11",
    code: "ING-038",
    name: "Yakitori Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 5000,
    rop: 50,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-12",
    code: "ING-039",
    name: "Telur Mata Sapi Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 3000,
    rop: 50,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-13",
    code: "ING-040",
    name: "Daging Sapi Slice Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 155,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-14",
    code: "ING-041",
    name: "Potongan Ayam Karaage Mentah",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 50,
    rop: 2000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-15",
    code: "ING-047",
    name: "Salmon Teriyaki Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 185,
    rop: 1000,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-16",
    code: "ING-048",
    name: "Ebi Furai Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Pcs",
    stockUnit: "Pcs",
    conversionFactor: 1,
    averageCost: 11000,
    rop: 30,
    moq: 1,
    countable: true,
  },
  {
    protoId: "ing-sfg-17",
    code: "ING-049",
    name: "Unagi Matang",
    category: "Fresh" as const,
    skuType: "SFG" as const,
    purchaseUnit: "Gram",
    stockUnit: "Gram",
    conversionFactor: 1,
    averageCost: 250,
    rop: 500,
    moq: 1,
    countable: true,
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
        ingredients: [{ ingredientProtoId: "ing-sfg-12", quantity: 1 }],
      },
      {
        protoId: "mod-06",
        code: "MOD-006",
        name: "Extra Daging Ayam",
        price: 10000,
        isExclusion: false,
        ingredients: [{ ingredientProtoId: "ing-sfg-02", quantity: 50 }],
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
];

export const RECIPES_DATA = [
  {
    protoId: "rec-01",
    code: "REC-001",
    name: "Chicken Teriyaki Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 35000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-02", quantity: 150 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
    modifierGroupProtoIds: ["mg-01", "mg-02", "mg-03"],
  },
  {
    protoId: "rec-02",
    code: "REC-002",
    name: "Beef Yakiniku Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 48000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-03", quantity: 150 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
    modifierGroupProtoIds: ["mg-01", "mg-02", "mg-03"],
  },
  {
    protoId: "rec-03",
    code: "REC-003",
    name: "Chicken Katsu Curry",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 42000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-04", quantity: 1 },
      { ingredientProtoId: "ing-sfg-05", quantity: 100 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-bundle-01",
    code: "REC-004",
    name: "Family Pack (2 Chicken + 1 Beef)",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 100000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing-18", quantity: 1 }],
    childRecipes: [
      { recipeProtoId: "rec-01", quantity: 2 },
      { recipeProtoId: "rec-02", quantity: 1 },
    ],
  },
  {
    protoId: "rec-bogo-01",
    code: "REC-005",
    name: "PROMO: BOGO Chicken Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 45000,
    isBOGO: true,
    brandProtoIds: ["brand-1"],
    ingredients: [],
    childRecipes: [{ recipeProtoId: "rec-01", quantity: 2 }],
  },
  {
    protoId: "rec-04",
    code: "REC-006",
    name: "Gyoza (5pcs)",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 25000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-06", quantity: 5 },
      { ingredientProtoId: "ing-18", quantity: 1 },
    ],
  },
  {
    protoId: "rec-05",
    code: "REC-007",
    name: "Miso Soup",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 12000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-07", quantity: 200 },
      { ingredientProtoId: "ing-16", quantity: 1 },
    ],
  },
  {
    protoId: "rec-06",
    code: "REC-008",
    name: "Oyakodon",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 38000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-08", quantity: 1 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-07",
    code: "REC-009",
    name: "Chicken Karaage Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 36000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-09", quantity: 150 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-08",
    code: "REC-010",
    name: "Beef Curry Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 52000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-03", quantity: 100 },
      { ingredientProtoId: "ing-sfg-05", quantity: 100 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-09",
    code: "REC-011",
    name: "Tamagoyaki (4pcs)",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 15000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-10", quantity: 4 },
      { ingredientProtoId: "ing-18", quantity: 1 },
    ],
  },
  {
    protoId: "rec-10",
    code: "REC-012",
    name: "Yakitori Set (3pcs)",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 22000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-11", quantity: 3 },
      { ingredientProtoId: "ing-20", quantity: 3 },
      { ingredientProtoId: "ing-18", quantity: 1 },
    ],
  },
  {
    protoId: "rec-11",
    code: "REC-013",
    name: "Salmon Teriyaki Bowl",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 65000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-15", quantity: 100 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-12",
    code: "REC-014",
    name: "Ebi Furai (3pcs)",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 32000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-16", quantity: 3 },
      { ingredientProtoId: "ing-18", quantity: 1 },
    ],
  },
  {
    protoId: "rec-13",
    code: "REC-015",
    name: "Unagi Bowl",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 85000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-sfg-17", quantity: 100 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-14",
    code: "REC-016",
    name: "Green Tea Latte",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 22000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing-31", quantity: 1 }],
  },
  {
    protoId: "rec-15",
    code: "REC-017",
    name: "Mango Smoothie",
    category: "minuman" as const,
    isSubRecipe: false,
    basePrice: 28000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing-31", quantity: 1 }],
  },
  {
    protoId: "rec-16",
    code: "REC-018",
    name: "Chicken Teriyaki Bento",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 55000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 250 },
      { ingredientProtoId: "ing-sfg-02", quantity: 150 },
      { ingredientProtoId: "ing-sfg-10", quantity: 2 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
      { ingredientProtoId: "ing-18", quantity: 1 },
    ],
  },
  {
    protoId: "rec-17",
    code: "REC-019",
    name: "Tempura Udon",
    category: "makanan" as const,
    isSubRecipe: false,
    basePrice: 45000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [
      { ingredientProtoId: "ing-sfg-01", quantity: 200 },
      { ingredientProtoId: "ing-16", quantity: 1 },
      { ingredientProtoId: "ing-17", quantity: 1 },
    ],
  },
  {
    protoId: "rec-18",
    code: "REC-020",
    name: "Matcha Ice Cream",
    category: "snack" as const,
    isSubRecipe: false,
    basePrice: 18000,
    isBOGO: false,
    brandProtoIds: ["brand-1"],
    ingredients: [{ ingredientProtoId: "ing-16", quantity: 1 }],
  },
];

// Exclusion modifier mappings
export const RECIPE_MODIFIER_EXCLUSIONS: {
  recipeProtoId: string;
  modifierProtoId: string;
  ingredientProtoId: string;
}[] = [
  { recipeProtoId: "rec-01", modifierProtoId: "mod-09", ingredientProtoId: "ing-15" },
  { recipeProtoId: "rec-02", modifierProtoId: "mod-08", ingredientProtoId: "ing-02" },
  { recipeProtoId: "rec-03", modifierProtoId: "mod-10", ingredientProtoId: "ing-08" },
  { recipeProtoId: "rec-07", modifierProtoId: "mod-10", ingredientProtoId: "ing-08" },
  { recipeProtoId: "rec-08", modifierProtoId: "mod-10", ingredientProtoId: "ing-08" },
];

// ──────────────────────────────────────────
// GENERATED ORDERS (150 orders)
// ──────────────────────────────────────────

const BRANCH_CODES = [
  "SBY-01",
  "SBY-02",
  "SBY-03",
  "SBY-04",
  "MLG-01",
  "GRS-01",
  "JKT-01",
  "JKT-02",
  "BDG-01",
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
  "rec-01",
  "rec-02",
  "rec-03",
  "rec-04",
  "rec-05",
  "rec-06",
  "rec-07",
  "rec-08",
  "rec-09",
  "rec-10",
  "rec-11",
  "rec-12",
  "rec-13",
  "rec-14",
  "rec-15",
  "rec-16",
  "rec-17",
  "rec-18",
];
const RECIPE_PRICES: Record<string, number> = {
  "rec-01": 35000,
  "rec-02": 48000,
  "rec-03": 42000,
  "rec-04": 25000,
  "rec-05": 12000,
  "rec-06": 38000,
  "rec-07": 36000,
  "rec-08": 52000,
  "rec-09": 15000,
  "rec-10": 22000,
  "rec-11": 65000,
  "rec-12": 32000,
  "rec-13": 85000,
  "rec-14": 22000,
  "rec-15": 28000,
  "rec-16": 55000,
  "rec-17": 45000,
  "rec-18": 18000,
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

    // Days ago: spread across 60 days, more recent orders have more "New" status
    const daysAgo =
      status === "New" ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 60);
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
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-05",
    "ing-07",
    "ing-12",
    "ing-13",
  ];
  for (let i = 1; i <= 25; i++) {
    const status = statuses[i % statuses.length];
    prs.push({
      code: `PR-${2025}${String(i).padStart(3, "0")}`,
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      status,
      requestedByEmail:
        i % 3 === 0 ? "hans@omoiyari.net" : i % 3 === 1 ? "budi@omoiyari.net" : "siti@omoiyari.net",
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
    items: { ingredientProtoId: string; quantity: number; unitPrice: number; totalPrice: number }[];
  }[] = [];
  const statuses: Array<"Draft" | "Sent" | "Partial" | "Completed" | "Cancelled"> = [
    "Draft",
    "Sent",
    "Partial",
    "Completed",
    "Cancelled",
  ];
  const poIngredients = ["ing-01", "ing-02", "ing-03", "ing-04", "ing-05"];
  const suppliers = ["SUP-001", "SUP-002", "SUP-003", "SUP-004"];
  for (let i = 1; i <= 20; i++) {
    const qty = 1000 + i * 500;
    const unitPrice = 35000 + i * 2000;
    pos.push({
      code: `PO-${2025}${String(i).padStart(3, "0")}`,
      prCode: i <= 15 ? `PR-${2025}${String(i).padStart(3, "0")}` : undefined,
      supplierCode: suppliers[i % suppliers.length],
      fromBranchCode: "CENTRAL",
      toBranchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      status: statuses[i % statuses.length],
      notes: `Purchase order untuk stok batch ${i}`,
      createdByEmail: "pusat@omoiyari.net",
      createdAt: nDaysAgo((i % 20) + 1),
      items: [
        {
          ingredientProtoId: poIngredients[i % poIngredients.length],
          quantity: qty,
          unitPrice,
          totalPrice: qty * unitPrice,
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
  const dnIngredients = ["ing-01", "ing-02", "ing-03", "ing-04", "ing-05", "ing-07", "ing-12"];
  for (let i = 1; i <= 18; i++) {
    const status = statuses[i % statuses.length];
    const qty = 2000 + i * 400;
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
          rejectedQuantity: i % 7 === 0 ? 50 : 0,
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
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-07",
    "ing-12",
    "ing-16",
    "ing-17",
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
      submittedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "budi@omoiyari.net",
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
    status: "Open" as const,
    openedAt: new Date("2026-05-01T00:00:00Z"),
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
    "Stok Beras Premium di SBY-01 sudah di bawah ROP",
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
    "hans@omoiyari.net",
    "budi@omoiyari.net",
    "siti@omoiyari.net",
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
      requestedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "budi@omoiyari.net",
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
      requestedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "siti@omoiyari.net",
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
      submittedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "budi@omoiyari.net",
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
      submittedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "siti@omoiyari.net",
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
      source: "ing-01",
      target: "ing-sfg-01",
      srcQty: 5000,
      tgtQty: 4500,
      yield: "90.00",
      shrink: 500,
    },
    {
      source: "ing-02",
      target: "ing-sfg-02",
      srcQty: 3000,
      tgtQty: 2700,
      yield: "90.00",
      shrink: 300,
    },
    {
      source: "ing-03",
      target: "ing-sfg-03",
      srcQty: 2000,
      tgtQty: 1700,
      yield: "85.00",
      shrink: 300,
    },
    { source: "ing-07", target: "ing-sfg-12", srcQty: 30, tgtQty: 28, yield: "93.33", shrink: 2 },
    {
      source: "ing-18",
      target: "ing-sfg-01",
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
      processedByEmail: i % 2 === 0 ? "ck@omoiyari.net" : "hans@omoiyari.net",
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
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-07",
    "ing-12",
    "ing-16",
    "ing-17",
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
      submittedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "budi@omoiyari.net",
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
      submittedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "siti@omoiyari.net",
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
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-05",
    "ing-07",
    "ing-12",
    "ing-16",
    "ing-17",
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
      requestedByEmail: i % 2 === 0 ? "hans@omoiyari.net" : "budi@omoiyari.net",
      approvedByEmail:
        status === "Approved" || status === "In Transit" || status === "Completed"
          ? "pusat@omoiyari.net"
          : undefined,
      rejectionReason: status === "Rejected" ? "Stok pusat tidak mencukupi" : undefined,
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
    { supCode: "SUP-001", supName: "PT Beras Makmur", ing: "ing-01", qty: 500000, price: 7000000 },
    { supCode: "SUP-002", supName: "CV Ayam Segar", ing: "ing-02", qty: 50000, price: 2250000 },
    {
      supCode: "SUP-003",
      supName: "Importir Sapi Jaya",
      ing: "ing-03",
      qty: 30000,
      price: 3450000,
    },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing-04", qty: 25000, price: 600000 },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing-05", qty: 25000, price: 675000 },
    { supCode: "SUP-005", supName: "CV Seafood Prima", ing: "ing-28", qty: 15000, price: 2700000 },
    {
      supCode: "SUP-006",
      supName: "PT Sayur Segar Indonesia",
      ing: "ing-09",
      qty: 50000,
      price: 750000,
    },
    { supCode: "SUP-007", supName: "CV Bumbu Nusantara", ing: "ing-15", qty: 10000, price: 850000 },
    { supCode: "SUP-008", supName: "PT Packaging Jaya", ing: "ing-16", qty: 5000, price: 7500000 },
    { supCode: "SUP-001", supName: "PT Beras Makmur", ing: "ing-01", qty: 250000, price: 3500000 },
    { supCode: "SUP-002", supName: "CV Ayam Segar", ing: "ing-02", qty: 30000, price: 1350000 },
    {
      supCode: "SUP-003",
      supName: "Importir Sapi Jaya",
      ing: "ing-03",
      qty: 20000,
      price: 2300000,
    },
    {
      supCode: "SUP-006",
      supName: "PT Sayur Segar Indonesia",
      ing: "ing-10",
      qty: 30000,
      price: 750000,
    },
    { supCode: "SUP-008", supName: "PT Packaging Jaya", ing: "ing-17", qty: 3000, price: 1350000 },
    { supCode: "SUP-004", supName: "PT Saus Nusantara", ing: "ing-04", qty: 15000, price: 360000 },
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
    "ing-01",
    "ing-02",
    "ing-03",
    "ing-04",
    "ing-07",
    "ing-12",
    "ing-16",
    "ing-17",
  ];
  const refs = ["POS", "DELIVERY", "TRANSFER", "WASTE", "ADJUSTMENT", "YIELD"];
  for (let i = 1; i <= 100; i++) {
    const isIn = i % 3 === 0;
    entries.push({
      branchCode: BRANCH_CODES[i % BRANCH_CODES.length],
      ingredientProtoId: ledgerIngredients[i % ledgerIngredients.length],
      type: isIn ? "IN" : "OUT",
      quantity: 100 + i * 50,
      reference: `${refs[i % refs.length]}-${20250000 + i}`,
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
      detail: "SJ-001 diterima di SBY-01",
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
      detail: "Shift SBY-01 ditutup dengan selisih Rp 12.500",
      userName: "Hans",
      status: "Warning",
      createdAt: nDaysAgo(1),
    },
    {
      action: "Stock Alert",
      detail: "Stok Minyak Goreng SBY-02 di bawah ROP",
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
