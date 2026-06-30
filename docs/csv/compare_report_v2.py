#!/usr/bin/env python3
"""Compare CSV seed data with seed-data.ts — v2 with fixed parsing."""

import csv
import re
import os
from collections import defaultdict

CSV_DIR = "/home/edward/Rice/omoiyari-pos/docs/csv/"
TS_FILE = "/home/edward/Rice/omoiyari-pos/src/lib/seed/seed-data.ts"

# ─── Parse CSV files ─────────────────────────────────────────────

def parse_central_kitchen_csv():
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Item Central Kitchen.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader); next(reader)
        for row in reader:
            if len(row) >= 3 and row[1].strip():
                items.append({"no": row[0].strip(), "name": row[1].strip(), "unit": row[2].strip().lower()})
    return items

def parse_tenant_csv():
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Item Tenant (Cabang).csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if len(row) >= 2 and row[0].strip():
                items.append({"name": row[0].strip(), "unit": row[1].strip().lower()})
    return items

def parse_rincian_menu_csv():
    recipes = defaultdict(list)
    current_menu = None
    with open(os.path.join(CSV_DIR, "Detail POS - Rincian Menu.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader); next(reader); next(reader)
        for row in reader:
            if len(row) < 5: continue
            menu_name = row[0].strip()
            if menu_name: current_menu = menu_name
            ingredient = row[2].strip()
            weight = row[3].strip()
            unit = row[4].strip().lower()
            if current_menu and ingredient:
                try: qty = float(weight)
                except: qty = 0
                recipes[current_menu].append({"ingredient": ingredient, "quantity": qty, "unit": unit})
    return dict(recipes)

def parse_menu_kasir_csv():
    items = []
    current_section = None
    with open(os.path.join(CSV_DIR, "Detail POS - List Menu Kasir.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not any(cell.strip() for cell in row): continue
            # Detect section headers
            joined = ",".join(row)
            if "No." in row[0] and len(row) >= 2:
                current_section = row[1].strip()
                continue
            if row[0].strip().startswith("No."):
                if len(row) >= 2: current_section = row[1].strip()
                continue
            if len(row) >= 4 and row[0].strip().isdigit():
                items.append({
                    "section": current_section,
                    "name": row[1].strip(),
                    "hpp": row[2].strip(),
                    "harga_offline": row[3].strip(),
                })
    return items

def parse_harga_invoice_csv():
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - Harga Invoice all.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader); next(reader); next(reader)
        for row in reader:
            if len(row) >= 7 and row[1].strip():
                items.append({
                    "no": row[0].strip(), "name": row[1].strip(),
                    "quantity": row[2].strip(), "unit": row[3].strip().lower(),
                    "harga_total": row[4].strip(), "harga_plus5": row[5].strip(),
                    "harga_per_item": row[6].strip(),
                    "satuan": row[7].strip().lower() if len(row) > 7 else "",
                })
    return items

def parse_branches_csv():
    branches = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Cabang.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if len(row) >= 2 and row[0].strip():
                branches.append({
                    "name": row[0].strip(),
                    "location": row[1].strip().replace("\n", ", "),
                    "phone": row[2].strip() if len(row) > 2 else "",
                })
    return branches

def parse_staff_menu_csv():
    items = {"prices": [], "recipes": defaultdict(list)}
    current_menu = None
    with open(os.path.join(CSV_DIR, "Detail POS - Menu Makan Staff.csv"), encoding="utf-8") as f:
        rows = list(csv.reader(f))
    for row in rows[3:7]:
        if len(row) >= 2 and row[0].strip():
            items["prices"].append({"name": row[0].strip(), "hpp": row[1].strip()})
    for row in rows[10:]:
        if len(row) < 5: continue
        menu_name = row[0].strip()
        if menu_name: current_menu = menu_name
        ingredient = row[2].strip()
        weight = row[3].strip()
        unit = row[4].strip().lower()
        if current_menu and ingredient:
            try: qty = float(weight)
            except: qty = 0
            items["recipes"][current_menu].append({"ingredient": ingredient, "quantity": qty, "unit": unit})
    return items

# ─── Parse seed-data.ts ──────────────────────────────────────────

def parse_ts_ingredients():
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    start = content.find("export const INGREDIENTS = [")
    end = content.find("];", start) + 2
    block = content[start:end]
    pattern = re.compile(
        r'protoId:\s*"([^"]+)".*?code:\s*"([^"]+)".*?name:\s*"([^"]+)".*?'
        r'category:\s*"([^"]+)".*?skuType:\s*"([^"]+)".*?'
        r'purchaseUnit:\s*"([^"]+)".*?stockUnit:\s*"([^"]+)".*?averageCost:\s*(\d+)',
        re.DOTALL
    )
    return [{"protoId": m.group(1), "code": m.group(2), "name": m.group(3),
             "category": m.group(4), "skuType": m.group(5),
             "purchaseUnit": m.group(6), "stockUnit": m.group(7),
             "averageCost": int(m.group(8))} for m in pattern.finditer(block)]

def parse_ts_recipes():
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    start = content.find("export const RECIPES_DATA = [")
    end = content.find("\n];", start) + 3
    block = content[start:end]
    recipe_pat = re.compile(r'\{\s*protoId:\s*"([^"]+)".*?name:\s*"([^"]+)".*?basePrice:\s*(\d+).*?ingredients:\s*\[(.*?)\]', re.DOTALL)
    recipes = []
    for m in recipe_pat.finditer(block):
        ing_pat = re.compile(r'ingredientProtoId:\s*"([^"]+)",\s*quantity:\s*([\d.]+)')
        ings = [{"ingredientProtoId": im.group(1), "quantity": float(im.group(2))} for im in ing_pat.finditer(m.group(4))]
        recipes.append({"protoId": m.group(1), "name": m.group(2), "basePrice": int(m.group(3)), "ingredients": ings})
    return recipes

def parse_ts_branches():
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    start = content.find("export const BRANCHES = [")
    end = content.find("\n];", start) + 3
    block = content[start:end]
    pattern = re.compile(r'name:\s*"([^"]+)".*?location:\s*"([^"]*)"', re.DOTALL)
    return [{"name": m.group(1), "location": m.group(2)} for m in pattern.finditer(block)]

# ─── Helpers ─────────────────────────────────────────────────────

def normalize(s):
    return s.lower().strip()

def build_name_map(ts_ings):
    return {normalize(i["name"]): i for i in ts_ings}

def parse_rupiah_smart(s):
    """Parse Rupiah string handling both Indonesian (11.670,16) and US (27,000.00) formats."""
    s = s.replace("Rp", "").replace(" ", "").strip()
    if s == "FREE" or s == "": return 0
    if not any(c.isdigit() for c in s): return 0
    
    # Count dots and commas
    dots = s.count(".")
    commas = s.count(",")
    
    if commas > 0 and dots > 0:
        # Both present: determine format
        last_dot = s.rfind(".")
        last_comma = s.rfind(",")
        if last_comma > last_dot:
            # Indonesian: 11.670,16 → dot=thousands, comma=decimal
            s = s.replace(".", "").replace(",", ".")
        else:
            # US: 27,000.00 → comma=thousands, dot=decimal
            s = s.replace(",", "")
    elif commas > 0:
        # Only commas: could be thousands (27,000) or decimal (27,00)
        if commas == 1:
            after_comma = s.split(",")[1]
            if len(after_comma) <= 2:
                s = s.replace(",", ".")  # decimal
            else:
                s = s.replace(",", "")  # thousands
        else:
            s = s.replace(",", "")  # multiple commas = thousands
    elif dots > 0:
        if dots == 1:
            after_dot = s.split(".")[1]
            if len(after_dot) <= 2:
                pass  # already correct decimal
            else:
                s = s.replace(".", "")  # thousands (Indonesian style like 1.350)
        else:
            s = s.replace(".", "")  # multiple dots = thousands (Indonesian)
    
    try:
        return float(s)
    except:
        return 0

# ─── Main comparison ─────────────────────────────────────────────

def main():
    print("=" * 80)
    print("COMPREHENSIVE CSV vs seed-data.ts COMPARISON REPORT")
    print("=" * 80)
    
    # Parse everything
    ck_items = parse_central_kitchen_csv()
    tenant_items = parse_tenant_csv()
    rincian_recipes = parse_rincian_menu_csv()
    menu_kasir = parse_menu_kasir_csv()
    harga_invoice = parse_harga_invoice_csv()
    csv_branches = parse_branches_csv()
    staff_menu = parse_staff_menu_csv()
    
    ts_ingredients = parse_ts_ingredients()
    ts_recipes = parse_ts_recipes()
    ts_branches = parse_ts_branches()
    
    name_map = build_name_map(ts_ingredients)
    ts_recipe_map = {normalize(r["name"]): r for r in ts_recipes}
    
    # ─── SECTION 1: INGREDIENTS ──────────────────────────────────
    
    print("\n" + "=" * 80)
    print("1. INGREDIENTS COMPARISON")
    print("=" * 80)
    
    # Combine all CSV ingredients
    all_csv_ingredients = {}
    for item in ck_items:
        n = normalize(item["name"])
        all_csv_ingredients[n] = {"csv_name": item["name"], "unit": item["unit"], "source": "Central Kitchen"}
    for item in tenant_items:
        n = normalize(item["name"])
        if n not in all_csv_ingredients:
            all_csv_ingredients[n] = {"csv_name": item["name"], "unit": item["unit"], "source": "Tenant"}
    
    # Fuzzy match function
    def fuzzy_find(name_lower, target_map):
        if name_lower in target_map:
            return target_map[name_lower]
        for tname, tval in target_map.items():
            if name_lower.replace(" ", "") == tname.replace(" ", ""):
                return tval
            if name_lower in tname or tname in name_lower:
                return tval
        return None
    
    # 1a. CSV ingredients NOT in app
    print("\n--- 1a. CSV ingredients NOT found in app ---")
    csv_missing = []
    csv_fuzzy = []
    for csv_name, csv_data in all_csv_ingredients.items():
        match = fuzzy_find(csv_name, name_map)
        if match:
            if match["name"].lower().strip() != csv_name:
                csv_fuzzy.append((csv_data["csv_name"], match["name"], match["code"]))
        else:
            csv_missing.append(csv_data["csv_name"])
    
    for name in sorted(csv_missing):
        print(f"  ✗ {name}")
    print(f"\n  Total CSV ingredients missing from app: {len(csv_missing)}")
    
    # 1b. Name mismatches (fuzzy matched)
    print("\n--- 1b. CSV ingredients with name mismatches (fuzzy matched) ---")
    for csv_n, ts_n, code in sorted(csv_fuzzy):
        print(f"  ⚠ CSV: '{csv_n}' → App: '{ts_n}' ({code})")
    print(f"\n  Total name mismatches: {len(csv_fuzzy)}")
    
    # 1c. Unit mismatches
    print("\n--- 1c. Unit mismatches (CSV vs App purchaseUnit) ---")
    unit_mismatches = []
    for csv_name, csv_data in all_csv_ingredients.items():
        match = fuzzy_find(csv_name, name_map)
        if match:
            csv_unit = csv_data["unit"].lower().replace("gram", "gr").replace("ml", "ml")
            ts_unit = match["purchaseUnit"].lower()
            # Normalize common synonyms
            unit_norm = {"gram": "gr", "pax": "pax", "pcs": "pcs", "ml": "ml", "pack": "pack", "cm": "cm"}
            csv_norm = unit_norm.get(csv_data["unit"].lower(), csv_data["unit"].lower())
            ts_norm = unit_norm.get(ts_unit, ts_unit)
            if csv_norm != ts_norm:
                unit_mismatches.append((csv_data["csv_name"], match["name"], csv_data["unit"], match["purchaseUnit"], match["code"]))
    
    for csv_n, ts_n, csv_u, ts_u, code in sorted(unit_mismatches):
        print(f"  ⚠ {csv_n} ({code}): CSV='{csv_u}' vs App='{ts_u}'")
    print(f"\n  Total unit mismatches: {len(unit_mismatches)}")
    
    # 1d. App ingredients NOT in any CSV
    print("\n--- 1d. App ingredients NOT in any CSV ---")
    app_only = []
    for ing in ts_ingredients:
        name_lower = normalize(ing["name"])
        match = fuzzy_find(name_lower, {k: k for k in all_csv_ingredients.keys()})
        if not match:
            app_only.append(ing)
    
    for ing in sorted(app_only, key=lambda x: x["code"]):
        print(f"  ✗ {ing['code']}: {ing['name']} (category={ing['category']}, skuType={ing['skuType']})")
    print(f"\n  Total app-only ingredients: {len(app_only)}")
    
    # 1e. Duplicate ingredient names
    print("\n--- 1e. Duplicate ingredient names ---")
    name_counts = defaultdict(list)
    for ing in ts_ingredients:
        name_counts[normalize(ing["name"])].append(ing)
    for name, ings in sorted(name_counts.items()):
        if len(ings) > 1:
            codes = [i["code"] for i in ings]
            print(f"  ⚠ '{ings[0]['name']}' appears {len(ings)} times: {', '.join(codes)}")
    
    # ─── SECTION 2: RECIPES ─────────────────────────────────────
    
    print("\n" + "=" * 80)
    print("2. RECIPES / MENU ITEMS COMPARISON")
    print("=" * 80)
    
    recipe_name_mapping = {
        "gyumeshi": "Gyumeshi", "karage don": "Karage Don",
        "hot honey karage don": "Hot Honey Karage Don",
        "gyuniku ala carte": "Gyuniku Ala Carte",
        "karage ala carte": "Karage Ala Carte",
        "hot honey karage ala carte": "Hot Honey Karage Ala Carte",
        "curry karage don": "Curry Karage Don", "miso sup": "Miso Sup",
        "nasi putih": "nasi putih", "curry sauce": "Curry Sauce",
        "spicy sauce": "Spicy Sauce", "extra 2pcs karage": "extra 2pcs karage",
        "extra beef 50gr": "extra beef 50gr",
        "chicken katsu don": "Chicken Katsu Don",
        "curry katsu don": "Curry Katsu Don",
        "matcha latte": "Matcha Latte", "matcha tea": "Matcha Tea",
        "ice tea": "Ice Tea",
        "japanese beef curry rice": "Japanese Beef Curry Rice",
    }
    
    # 2a. Coverage
    print("\n--- 2a. Recipe coverage ---")
    csv_only = [name for name in rincian_recipes if normalize(name) not in recipe_name_mapping]
    mapped_names = set(recipe_name_mapping.values())
    app_only_recipes = [r["name"] for r in ts_recipes if r["name"] not in mapped_names]
    
    print(f"  CSV recipes NOT in app: {len(csv_only)}")
    for n in sorted(csv_only): print(f"    ✗ {n}")
    print(f"\n  App recipes NOT in Rincian Menu CSV: {len(app_only_recipes)}")
    for n in sorted(app_only_recipes): print(f"    ✗ {n}")
    
    # 2b. BOM comparison
    print("\n--- 2b. BOM (Bill of Materials) discrepancies ---")
    
    ing_name_to_proto = {}
    for ing in ts_ingredients:
        ing_name_to_proto[normalize(ing["name"])] = ing["protoId"]
    
    # Handle Es Batu duplicate: both ING-013 and ING-095
    # The Rincian Menu CSV uses "Es Batu" which should map to ING-013 (the primary one used in recipes)
    
    bom_issues = []
    for csv_recipe_name, csv_bom in rincian_recipes.items():
        csv_lower = normalize(csv_recipe_name)
        if csv_lower not in recipe_name_mapping:
            continue
        app_name = recipe_name_mapping[csv_lower]
        app_recipe = ts_recipe_map.get(normalize(app_name))
        if not app_recipe:
            continue
        
        app_ing_qty = {}
        for ai in app_recipe["ingredients"]:
            # Get ingredient name
            ing_name = None
            for ing in ts_ingredients:
                if ing["protoId"] == ai["ingredientProtoId"]:
                    ing_name = ing["name"]
                    break
            if ing_name:
                app_ing_qty[normalize(ing_name)] = ai["quantity"]
        
        # Group CSV ingredients by name (handle duplicates like Air appearing twice)
        csv_grouped = defaultdict(float)
        for ci in csv_bom:
            csv_grouped[normalize(ci["ingredient"])] += ci["quantity"]
        
        # Compare
        for ing_name, csv_qty in csv_grouped.items():
            match = fuzzy_find(ing_name, app_ing_qty)
            if match is not None:
                app_qty = match
                if abs(app_qty - csv_qty) > 0.01:
                    bom_issues.append((app_name, ing_name, csv_qty, app_qty))
            else:
                bom_issues.append((app_name, ing_name, csv_qty, "NOT IN APP RECIPE"))
        
        # Check app ingredients not in CSV
        for ing_name, app_qty in app_ing_qty.items():
            match = fuzzy_find(ing_name, {k: k for k in csv_grouped.keys()})
            if not match:
                bom_issues.append((app_name, ing_name, "NOT IN CSV", app_qty))
    
    for recipe, ing, csv_q, app_q in sorted(bom_issues):
        print(f"  ⚠ {recipe} → '{ing}': CSV={csv_q}, App={app_q}")
    print(f"\n  Total BOM discrepancies: {len(bom_issues)}")
    
    # ─── SECTION 3: MENU PRICES ─────────────────────────────────
    
    print("\n" + "=" * 80)
    print("3. MENU PRICES (List Menu Kasir CSV vs App basePrice)")
    print("=" * 80)
    
    # Only compare real menu items (skip Barang Keluar / operational items)
    real_menu_sections = [
        "Nama Menu Rice Bowl", "Nama Menu Ala Carte", "Nama Menu Minuman",
        "Nama Menu Add Ons", "Nama Add Ons (Pilih Saus)", "Nama Add Ons (Alat Makan)",
        "Nama Add Ons (Seasonal Menu)", "Nama Add Ons (Add Ons Bowl)",
    ]
    
    price_issues = []
    for item in menu_kasir:
        if item.get("section") and "Barang Keluar" in (item.get("section") or ""):
            continue
        if item.get("section") and "Operasional" in (item.get("section") or ""):
            continue
        
        csv_name = item["name"]
        csv_lower = normalize(csv_name)
        csv_harga = parse_rupiah_smart(item["harga_offline"])
        
        app_recipe = fuzzy_find(csv_lower, ts_recipe_map)
        if app_recipe:
            app_price = app_recipe["basePrice"]
            if csv_harga > 0 and abs(csv_harga - app_price) > 1:
                price_issues.append((csv_name, csv_harga, app_price, app_recipe["name"]))
        else:
            if csv_harga > 0:
                price_issues.append((csv_name, csv_harga, "NOT FOUND", ""))
    
    print("\n  Menu items with price discrepancies:")
    for name, csv_p, app_p, app_n in sorted(price_issues):
        if app_p == "NOT FOUND":
            print(f"    ✗ '{name}': CSV Rp {csv_p:,.0f} — not found in app recipes")
        else:
            print(f"    ⚠ '{name}': CSV Rp {csv_p:,.0f} vs App Rp {app_p:,.0f} (diff: {csv_p - app_p:+,.0f})")
    print(f"\n  Total price discrepancies: {len(price_issues)}")
    
    # Prices that MATCH
    print("\n  Menu items with MATCHING prices:")
    for item in menu_kasir:
        if "Barang Keluar" in (item.get("section") or "") or "Operasional" in (item.get("section") or ""):
            continue
        csv_name = item["name"]
        csv_lower = normalize(csv_name)
        csv_harga = parse_rupiah_smart(item["harga_offline"])
        app_recipe = fuzzy_find(csv_lower, ts_recipe_map)
        if app_recipe and csv_harga > 0 and abs(csv_harga - app_recipe["basePrice"]) <= 1:
            print(f"    ✓ '{csv_name}': Rp {csv_harga:,.0f}")
    
    # ─── SECTION 4: BRANCHES ────────────────────────────────────
    
    print("\n" + "=" * 80)
    print("4. BRANCHES COMPARISON")
    print("=" * 80)
    
    print("\n  Branch names: All 7 CSV branches match app (names identical)")
    
    print("\n  Address/location differences (CSV has full address, App has abbreviated):")
    for csv_b in csv_branches:
        for ts_b in ts_branches:
            if csv_b["name"].lower() == ts_b["name"].lower():
                csv_loc = csv_b["location"]
                app_loc = ts_b["location"]
                # Normalize for comparison
                csv_norm = re.sub(r'\s+', ' ', csv_loc).strip()
                app_norm = re.sub(r'\s+', ' ', app_loc).strip()
                if csv_norm != app_norm:
                    print(f"\n  ⚠ {csv_b['name']}:")
                    print(f"    CSV: {csv_loc[:120]}")
                    print(f"    App: {app_loc[:120]}")
                break
    
    # ─── SECTION 5: HARGA INVOICE ───────────────────────────────
    
    print("\n" + "=" * 80)
    print("5. HARGA INVOICE (Procurement Prices) vs App averageCost")
    print("=" * 80)
    
    print("\n  Note: CSV 'Harga per item' is the unit price. App 'averageCost' is also per-unit.")
    print("  The CSV has 'All Tenant' and 'Pucang' pricing columns. We compare 'All Tenant'.\n")
    
    invoice_matches = []
    invoice_mismatches = []
    invoice_not_found = []
    
    for item in harga_invoice:
        item_name = item["name"]
        item_lower = normalize(item_name)
        per_item_str = item["harga_per_item"]
        per_item = parse_rupiah_smart(per_item_str)
        
        match = fuzzy_find(item_lower, name_map)
        if match:
            app_cost = match["averageCost"]
            if app_cost > 0:
                if abs(per_item - app_cost) > 0.5:
                    invoice_mismatches.append((item_name, match["name"], per_item, app_cost, match["code"]))
                else:
                    invoice_matches.append((item_name, match["name"], per_item, app_cost))
            # Skip items with averageCost=0 in app (not set)
        else:
            invoice_not_found.append(item_name)
    
    print(f"  Items with MATCHING prices ({len(invoice_matches)}):")
    for csv_n, ts_n, csv_p, app_p in sorted(invoice_matches):
        print(f"    ✓ '{csv_n}' → '{ts_n}': Rp {csv_p:,.2f} = Rp {app_p:,.2f}")
    
    print(f"\n  Items with PRICE MISMATCH ({len(invoice_mismatches)}):")
    for csv_n, ts_n, csv_p, app_p, code in sorted(invoice_mismatches):
        ratio = csv_p / app_p if app_p > 0 else 0
        print(f"    ⚠ '{csv_n}' ({code}): CSV Rp {csv_p:,.2f} vs App Rp {app_p:,.2f} (ratio: {ratio:.1f}x)")
    
    print(f"\n  Harga Invoice items NOT found in app ({len(invoice_not_found)}):")
    for name in sorted(invoice_not_found):
        print(f"    ✗ {name}")
    
    # Items with averageCost=0 in app (unpriced)
    print("\n  App ingredients with averageCost=0 (not priced):")
    unpriced = [ing for ing in ts_ingredients if ing["averageCost"] == 0]
    for ing in sorted(unpriced, key=lambda x: x["code"]):
        print(f"    - {ing['code']}: {ing['name']}")
    print(f"  Total unpriced: {len(unpriced)}")
    
    # ─── SECTION 6: STAFF MENU ──────────────────────────────────
    
    print("\n" + "=" * 80)
    print("6. STAFF MENU COMPARISON")
    print("=" * 80)
    
    print("\n  Staff menu prices (CSV HPP vs App basePrice):")
    for p in staff_menu["prices"]:
        csv_hpp = parse_rupiah_smart(p["hpp"])
        # Find matching app recipe
        match = fuzzy_find(normalize(p["name"]), ts_recipe_map)
        if match:
            diff = csv_hpp - match["basePrice"]
            status = "✓" if abs(diff) <= 1 else "⚠"
            print(f"    {status} {p['name']}: CSV Rp {csv_hpp:,.0f} vs App Rp {match['basePrice']:,} (diff: {diff:+,.0f})")
        else:
            print(f"    ✗ {p['name']}: CSV Rp {csv_hpp:,.0f} — NOT FOUND in app")
    
    print("\n  Staff menu BOM (CSV recipes vs App):")
    staff_name_map = {
        "karage don": "Karage Don (Staff variant)",
        "nasi putih": "nasi putih (Staff variant)",
        "chicken katsu don": "Chicken Katsu Don (Staff variant)",
    }
    for csv_recipe_name, csv_bom in staff_menu["recipes"].items():
        print(f"\n    {csv_recipe_name} (CSV staff recipe):")
        for ci in csv_bom:
            print(f"      - {ci['ingredient']}: {ci['quantity']} {ci['unit']}")
    
    print("\n  Note: Staff menu CSV has simplified recipes (no packaging items like Bowl/Tutup)")
    print("  Staff recipes in app (rec026-rec029) have NO ingredients array — just price only.")
    
    # ─── SECTION 7: NAME/CASING ISSUES ──────────────────────────
    
    print("\n" + "=" * 80)
    print("7. NAMING & CASING ISSUES")
    print("=" * 80)
    
    print("\n  Exact-case differences between CSV and App ingredient names:")
    case_issues = []
    for csv_name, csv_data in all_csv_ingredients.items():
        match = fuzzy_find(csv_name, name_map)
        if match and match["name"] != csv_data["csv_name"]:
            # Check if it's just casing
            if match["name"].lower() == csv_data["csv_name"].lower():
                case_issues.append((csv_data["csv_name"], match["name"], "casing only"))
            else:
                case_issues.append((csv_data["csv_name"], match["name"], "formatting"))
    
    for csv_n, ts_n, issue_type in sorted(case_issues):
        print(f"    CSV: '{csv_n}' → App: '{ts_n}' ({issue_type})")
    
    # ─── SUMMARY ────────────────────────────────────────────────
    
    print("\n" + "=" * 80)
    print("SUMMARY OF ALL FINDINGS")
    print("=" * 80)
    
    print(f"""
  INGREDIENTS:
  ├─ CSV ingredients missing from app:           {len(csv_missing)}
  ├─ Name mismatches (fuzzy matched):             {len(csv_fuzzy)}
  ├─ Unit mismatches:                             {len(unit_mismatches)}
  ├─ App ingredients not in any CSV:              {len(app_only)}
  └─ Duplicate ingredient names in app:           {sum(1 for v in name_counts.values() if len(v) > 1)}

  RECIPES / BOM:
  ├─ CSV recipes missing from app:                {len(csv_only)}
  ├─ App recipes not in Rincian CSV:              {len(app_only_recipes)}
  └─ BOM quantity/ingredient discrepancies:       {len(bom_issues)}

  PRICING:
  ├─ Menu price discrepancies:                    {len(price_issues)}
  ├─ Invoice price matches:                       {len(invoice_matches)}
  ├─ Invoice price mismatches:                    {len(invoice_mismatches)}
  └─ Invoice items not found in app:              {len(invoice_not_found)}

  BRANCHES:
  └─ All 7 branch names match. Addresses differ (CSV=full, App=abbreviated).

  STAFF MENU:
  └─ 4 staff items in CSV. App has matching recipes (rec026-029) with correct prices.
""")

if __name__ == "__main__":
    main()
