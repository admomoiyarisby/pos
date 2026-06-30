#!/usr/bin/env python3
"""Compare CSV seed data with seed-data.ts and generate a discrepancy report."""

import csv
import re
import os
from collections import defaultdict

CSV_DIR = "/home/edward/Rice/omoiyari-pos/docs/csv/"
TS_FILE = "/home/edward/Rice/omoiyari-pos/src/lib/seed/seed-data.ts"

# ─── Parse CSV files ─────────────────────────────────────────────

def parse_central_kitchen_csv():
    """Parse Central Kitchen ingredients CSV (101 items)."""
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Item Central Kitchen.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)  # skip header row 1
        header2 = next(reader)  # skip header row 2
        for row in reader:
            if len(row) >= 3 and row[1].strip():
                items.append({
                    "no": row[0].strip(),
                    "name": row[1].strip(),
                    "unit": row[2].strip().lower(),
                })
    return items

def parse_tenant_csv():
    """Parse Tenant/Outlet ingredients CSV (71 items)."""
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Item Tenant (Cabang).csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)  # skip header
        for row in reader:
            if len(row) >= 2 and row[0].strip():
                items.append({
                    "name": row[0].strip(),
                    "unit": row[1].strip().lower(),
                })
    return items

def parse_rincian_menu_csv():
    """Parse recipe BOM CSV (102 rows)."""
    recipes = defaultdict(list)
    current_menu = None
    with open(os.path.join(CSV_DIR, "Detail POS - Rincian Menu.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        header1 = next(reader)
        header2 = next(reader)
        header3 = next(reader)
        for row in reader:
            if len(row) < 5:
                continue
            menu_name = row[0].strip()
            if menu_name:
                current_menu = menu_name
            ingredient = row[2].strip()
            weight = row[3].strip()
            unit = row[4].strip().lower()
            if current_menu and ingredient:
                try:
                    qty = float(weight)
                except:
                    qty = 0
                recipes[current_menu].append({
                    "ingredient": ingredient,
                    "quantity": qty,
                    "unit": unit,
                })
    return dict(recipes)

def parse_menu_kasir_csv():
    """Parse menu prices CSV."""
    sections = {}
    current_section = None
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Menu Kasir.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not any(cell.strip() for cell in row):
                continue
            # Detect section headers
            if len(row) >= 3 and row[1].strip() and row[0].strip().startswith("No"):
                current_section = row[1].strip()
                continue
            if row[0].strip().startswith("No"):
                if len(row) >= 2:
                    current_section = row[1].strip()
                continue
            if len(row) >= 4 and row[0].strip().isdigit():
                name = row[1].strip()
                hpp = row[2].strip()
                harga = row[3].strip()
                items.append({
                    "section": current_section,
                    "name": name,
                    "hpp": hpp,
                    "harga_offline": harga,
                })
    return items

def parse_harga_invoice_csv():
    """Parse procurement pricing CSV."""
    items = []
    with open(os.path.join(CSV_DIR, "Detail POS - Harga Invoice all.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        header1 = next(reader)
        header2 = next(reader)
        header3 = next(reader)
        for row in reader:
            if len(row) >= 7 and row[1].strip():
                items.append({
                    "no": row[0].strip(),
                    "name": row[1].strip(),
                    "quantity": row[2].strip(),
                    "unit": row[3].strip().lower(),
                    "harga": row[4].strip(),
                    "harga_per_item": row[6].strip(),
                    "satuan": row[7].strip().lower() if len(row) > 7 else "",
                })
    return items

def parse_branches_csv():
    """Parse branches CSV."""
    branches = []
    with open(os.path.join(CSV_DIR, "Detail POS - List Cabang.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if len(row) >= 2 and row[0].strip():
                branches.append({
                    "name": row[0].strip(),
                    "location": row[1].strip().replace("\n", ", "),
                    "phone": row[2].strip() if len(row) > 2 else "",
                    "complaint_phone": row[3].strip() if len(row) > 3 else "",
                })
    return branches

def parse_staff_menu_csv():
    """Parse staff meal menu CSV."""
    items = {"prices": [], "recipes": defaultdict(list)}
    current_menu = None
    with open(os.path.join(CSV_DIR, "Detail POS - Menu Makan Staff.csv"), encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)
    
    # Parse prices (rows 3-6)
    for row in rows[3:7]:
        if len(row) >= 2 and row[0].strip():
            items["prices"].append({
                "name": row[0].strip(),
                "hpp": row[1].strip(),
            })
    
    # Parse recipes (rows 11+)
    for row in rows[10:]:
        if len(row) < 5:
            continue
        menu_name = row[0].strip()
        if menu_name:
            current_menu = menu_name
        ingredient = row[2].strip()
        weight = row[3].strip()
        unit = row[4].strip().lower()
        if current_menu and ingredient:
            try:
                qty = float(weight)
            except:
                qty = 0
            items["recipes"][current_menu].append({
                "ingredient": ingredient,
                "quantity": qty,
                "unit": unit,
            })
    return items

# ─── Parse seed-data.ts ──────────────────────────────────────────

def parse_ts_ingredients():
    """Extract INGREDIENTS array from seed-data.ts."""
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    
    # Find the INGREDIENTS array
    start = content.find("export const INGREDIENTS = [")
    end = content.find("];", start) + 2
    ing_block = content[start:end]
    
    ingredients = []
    # Parse each ingredient entry
    pattern = re.compile(
        r'protoId:\s*"([^"]+)".*?'
        r'code:\s*"([^"]+)".*?'
        r'name:\s*"([^"]+)".*?'
        r'category:\s*"([^"]+)".*?'
        r'skuType:\s*"([^"]+)".*?'
        r'purchaseUnit:\s*"([^"]+)".*?'
        r'stockUnit:\s*"([^"]+)".*?'
        r'averageCost:\s*(\d+)',
        re.DOTALL
    )
    
    for match in pattern.finditer(ing_block):
        ingredients.append({
            "protoId": match.group(1),
            "code": match.group(2),
            "name": match.group(3),
            "category": match.group(4),
            "skuType": match.group(5),
            "purchaseUnit": match.group(6),
            "stockUnit": match.group(7),
            "averageCost": int(match.group(8)),
        })
    
    return ingredients

def parse_ts_recipes():
    """Extract RECIPES_DATA array from seed-data.ts."""
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    
    start = content.find("export const RECIPES_DATA = [")
    end = content.find("\n];", start) + 3
    rec_block = content[start:end]
    
    recipes = []
    # Find each recipe block
    recipe_pattern = re.compile(r'\{\s*protoId:\s*"([^"]+)".*?name:\s*"([^"]+)".*?basePrice:\s*(\d+).*?ingredients:\s*\[(.*?)\]', re.DOTALL)
    
    for match in recipe_pattern.finditer(rec_block):
        proto_id = match.group(1)
        name = match.group(2)
        base_price = int(match.group(3))
        ingredients_str = match.group(4)
        
        # Parse ingredients
        ing_pattern = re.compile(r'ingredientProtoId:\s*"([^"]+)",\s*quantity:\s*([\d.]+)')
        ingredients = []
        for ing_match in ing_pattern.finditer(ingredients_str):
            ingredients.append({
                "ingredientProtoId": ing_match.group(1),
                "quantity": float(ing_match.group(2)),
            })
        
        recipes.append({
            "protoId": proto_id,
            "name": name,
            "basePrice": base_price,
            "ingredients": ingredients,
        })
    
    return recipes

def parse_ts_branches():
    """Extract BRANCHES array from seed-data.ts."""
    with open(TS_FILE, encoding="utf-8") as f:
        content = f.read()
    
    start = content.find("export const BRANCHES = [")
    end = content.find("\n];", start) + 3
    branch_block = content[start:end]
    
    branches = []
    pattern = re.compile(r'name:\s*"([^"]+)".*?location:\s*"([^"]*)"', re.DOTALL)
    
    for match in pattern.finditer(branch_block):
        branches.append({
            "name": match.group(1),
            "location": match.group(2),
        })
    
    return branches

# ─── Build name-to-protoId mapping ───────────────────────────────

def build_name_map(ts_ingredients):
    """Build a case-insensitive name -> ingredient mapping."""
    name_map = {}
    for ing in ts_ingredients:
        name_lower = ing["name"].lower().strip()
        name_map[name_lower] = ing
    return name_map

def normalize_name(name):
    """Normalize ingredient name for comparison."""
    return name.lower().strip()

# ─── Main comparison ─────────────────────────────────────────────

def main():
    print("=" * 80)
    print("COMPREHENSIVE CSV vs seed-data.ts COMPARISON REPORT")
    print("=" * 80)
    print()
    
    # Parse all data
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
    
    # ─── SECTION 1: INGREDIENTS ──────────────────────────────────
    
    print("=" * 80)
    print("1. INGREDIENTS COMPARISON")
    print("=" * 80)
    print()
    
    # 1a. Central Kitchen CSV vs App
    print("─" * 60)
    print("1a. Central Kitchen CSV (101 items) vs App INGREDIENTS (127 items)")
    print("─" * 60)
    
    ck_names = set()
    ck_missing_in_app = []
    ck_unit_mismatches = []
    ck_name_mismatches = []
    
    for item in ck_items:
        name_lower = normalize_name(item["name"])
        ck_names.add(name_lower)
        
        if name_lower in name_map:
            ts_ing = name_map[name_lower]
            # Check unit
            csv_unit = item["unit"]
            ts_unit = ts_ing["purchaseUnit"].lower()
            if csv_unit != ts_unit:
                ck_unit_mismatches.append({
                    "csv_name": item["name"],
                    "ts_name": ts_ing["name"],
                    "csv_unit": csv_unit,
                    "ts_unit": ts_unit,
                    "ts_code": ts_ing["code"],
                })
        else:
            # Try fuzzy matching
            found = False
            for ts_name, ts_ing in name_map.items():
                if (name_lower in ts_name or ts_name in name_lower or
                    name_lower.replace(" ", "") == ts_name.replace(" ", "")):
                    ck_name_mismatches.append({
                        "csv_name": item["name"],
                        "ts_name": ts_ing["name"],
                        "ts_code": ts_ing["code"],
                    })
                    found = True
                    break
            if not found:
                ck_missing_in_app.append(item["name"])
    
    print(f"\n  CSV items NOT found in app ({len(ck_missing_in_app)}):")
    for name in ck_missing_in_app:
        print(f"    ✗ {name}")
    
    print(f"\n  CSV items with NAME mismatch (fuzzy match found) ({len(ck_name_mismatches)}):")
    for m in ck_name_mismatches:
        print(f"    ⚠ CSV: '{m['csv_name']}' → App: '{m['ts_name']}' ({m['ts_code']})")
    
    print(f"\n  CSV items with UNIT mismatch ({len(ck_unit_mismatches)}):")
    for m in ck_unit_mismatches:
        print(f"    ⚠ {m['csv_name']}: CSV={m['csv_unit']} vs App={m['ts_unit']} ({m['ts_code']})")
    
    # 1b. Tenant CSV vs App
    print()
    print("─" * 60)
    print("1b. Tenant/Outlet CSV (71 items) vs App INGREDIENTS")
    print("─" * 60)
    
    tenant_missing_in_app = []
    tenant_unit_mismatches = []
    tenant_name_mismatches = []
    
    for item in tenant_items:
        name_lower = normalize_name(item["name"])
        
        if name_lower in name_map:
            ts_ing = name_map[name_lower]
            csv_unit = item["unit"]
            ts_unit = ts_ing["purchaseUnit"].lower()
            if csv_unit != ts_unit:
                tenant_unit_mismatches.append({
                    "csv_name": item["name"],
                    "ts_name": ts_ing["name"],
                    "csv_unit": csv_unit,
                    "ts_unit": ts_unit,
                    "ts_code": ts_ing["code"],
                })
        else:
            found = False
            for ts_name, ts_ing in name_map.items():
                if (name_lower in ts_name or ts_name in name_lower or
                    name_lower.replace(" ", "") == ts_name.replace(" ", "")):
                    tenant_name_mismatches.append({
                        "csv_name": item["name"],
                        "ts_name": ts_ing["name"],
                        "ts_code": ts_ing["code"],
                    })
                    found = True
                    break
            if not found:
                tenant_missing_in_app.append(item["name"])
    
    print(f"\n  Tenant items NOT found in app ({len(tenant_missing_in_app)}):")
    for name in tenant_missing_in_app:
        print(f"    ✗ {name}")
    
    print(f"\n  Tenant items with NAME mismatch ({len(tenant_name_mismatches)}):")
    for m in tenant_name_mismatches:
        print(f"    ⚠ CSV: '{m['csv_name']}' → App: '{m['ts_name']}' ({m['ts_code']})")
    
    print(f"\n  Tenant items with UNIT mismatch ({len(tenant_unit_mismatches)}):")
    for m in tenant_unit_mismatches:
        print(f"    ⚠ {m['csv_name']}: CSV={m['csv_unit']} vs App={m['ts_unit']} ({m['ts_code']})")
    
    # 1c. App ingredients NOT in any CSV
    print()
    print("─" * 60)
    print("1c. App INGREDIENTS NOT in any CSV (possible extra test data)")
    print("─" * 60)
    
    all_csv_names = ck_names | set(normalize_name(t["name"]) for t in tenant_items)
    app_only = []
    for ing in ts_ingredients:
        name_lower = normalize_name(ing["name"])
        if name_lower not in all_csv_names:
            # Check fuzzy
            found = False
            for csv_name in all_csv_names:
                if (name_lower in csv_name or csv_name in name_lower or
                    name_lower.replace(" ", "") == csv_name.replace(" ", "")):
                    found = True
                    break
            if not found:
                app_only.append(ing)
    
    print(f"\n  App ingredients with NO CSV match ({len(app_only)}):")
    for ing in app_only:
        print(f"    ✗ {ing['code']}: {ing['name']} (category={ing['category']}, skuType={ing['skuType']})")
    
    # ─── SECTION 2: RECIPES ─────────────────────────────────────
    
    print()
    print("=" * 80)
    print("2. RECIPES / MENU ITEMS COMPARISON")
    print("=" * 80)
    print()
    
    print("─" * 60)
    print("2a. Rincian Menu CSV recipes vs App RECIPES_DATA")
    print("─" * 60)
    
    # Build app recipe name map
    ts_recipe_map = {r["name"].lower().strip(): r for r in ts_recipes}
    
    csv_recipe_names = set(rincian_recipes.keys())
    app_recipe_names = set(r["name"] for r in ts_recipes)
    
    # Map CSV names to app names
    recipe_name_mapping = {
        "gyumeshi": "Gyumeshi",
        "karage don": "Karage Don",
        "hot honey karage don": "Hot Honey Karage Don",
        "gyuniku ala carte": "Gyuniku Ala Carte",
        "karage ala carte": "Karage Ala Carte",
        "hot honey karage ala carte": "Hot Honey Karage Ala Carte",
        "curry karage don": "Curry Karage Don",
        "miso sup": "Miso Sup",
        "nasi putih": "nasi putih",
        "curry sauce": "Curry Sauce",
        "spicy sauce": "Spicy Sauce",
        "extra 2pcs karage": "extra 2pcs karage",
        "extra beef 50gr": "extra beef 50gr",
        "chicken katsu don": "Chicken Katsu Don",
        "curry katsu don": "Curry Katsu Don",
        "matcha latte": "Matcha Latte",
        "matcha tea": "Matcha Tea",
        "ice tea": "Ice Tea",
        "japanese beef curry rice": "Japanese Beef Curry Rice",
    }
    
    csv_missing_in_app = []
    for csv_name in csv_recipe_names:
        csv_lower = csv_name.lower()
        if csv_lower not in recipe_name_mapping:
            csv_missing_in_app.append(csv_name)
    
    print(f"\n  CSV recipes NOT in app ({len(csv_missing_in_app)}):")
    for name in csv_missing_in_app:
        print(f"    ✗ {name}")
    
    # App recipes NOT in CSV
    csv_mapped_names = set(recipe_name_mapping.values())
    app_extra_recipes = []
    for r in ts_recipes:
        if r["name"] not in csv_mapped_names:
            app_extra_recipes.append(r["name"])
    
    print(f"\n  App recipes NOT in Rincian Menu CSV ({len(app_extra_recipes)}):")
    for name in app_extra_recipes:
        print(f"    ✗ {name}")
    
    # ─── SECTION 2b: BOM COMPARISON ─────────────────────────────
    
    print()
    print("─" * 60)
    print("2b. Recipe BOM (ingredients/quantities) Comparison")
    print("─" * 60)
    
    # Build ingredient name to protoId reverse map
    ing_name_to_proto = {}
    for ing in ts_ingredients:
        ing_name_to_proto[normalize_name(ing["name"])] = ing["protoId"]
    
    bom_discrepancies = []
    
    for csv_recipe_name, csv_bom in rincian_recipes.items():
        csv_lower = csv_recipe_name.lower()
        if csv_lower not in recipe_name_mapping:
            continue
        
        app_name = recipe_name_mapping[csv_lower]
        app_recipe = ts_recipe_map.get(app_name.lower())
        if not app_recipe:
            continue
        
        # Build app ingredient map (protoId -> quantity)
        app_ing_qty = {}
        for ai in app_recipe["ingredients"]:
            app_ing_qty[ai["ingredientProtoId"]] = ai["quantity"]
        
        # Compare each CSV ingredient
        for csv_ing in csv_bom:
            ing_name_lower = normalize_name(csv_ing["ingredient"])
            proto_id = ing_name_to_proto.get(ing_name_lower)
            
            if not proto_id:
                # Try fuzzy
                for name, pid in ing_name_to_proto.items():
                    if (ing_name_lower in name or name in ing_name_lower or
                        ing_name_lower.replace(" ", "") == name.replace(" ", "")):
                        proto_id = pid
                        break
            
            if proto_id:
                if proto_id in app_ing_qty:
                    app_qty = app_ing_qty[proto_id]
                    csv_qty = csv_ing["quantity"]
                    if abs(app_qty - csv_qty) > 0.01:
                        bom_discrepancies.append({
                            "recipe": app_name,
                            "ingredient": csv_ing["ingredient"],
                            "csv_qty": csv_qty,
                            "app_qty": app_qty,
                            "unit": csv_ing["unit"],
                        })
                else:
                    bom_discrepancies.append({
                        "recipe": app_name,
                        "ingredient": csv_ing["ingredient"],
                        "csv_qty": csv_ing["quantity"],
                        "app_qty": "MISSING",
                        "unit": csv_ing["unit"],
                    })
            else:
                bom_discrepancies.append({
                    "recipe": app_name,
                    "ingredient": csv_ing["ingredient"],
                    "csv_qty": csv_ing["quantity"],
                    "app_qty": "INGREDIENT NOT FOUND",
                    "unit": csv_ing["unit"],
                })
        
        # Check app ingredients not in CSV
        for ai in app_recipe["ingredients"]:
            # Find the ingredient name
            ing_name = None
            for ing in ts_ingredients:
                if ing["protoId"] == ai["ingredientProtoId"]:
                    ing_name = ing["name"]
                    break
            
            if ing_name:
                found_in_csv = False
                for csv_ing in csv_bom:
                    if normalize_name(csv_ing["ingredient"]) == normalize_name(ing_name):
                        found_in_csv = True
                        break
                    # Fuzzy
                    if (normalize_name(csv_ing["ingredient"]) in normalize_name(ing_name) or
                        normalize_name(ing_name) in normalize_name(csv_ing["ingredient"])):
                        found_in_csv = True
                        break
                
                if not found_in_csv:
                    bom_discrepancies.append({
                        "recipe": app_name,
                        "ingredient": ing_name,
                        "csv_qty": "MISSING IN CSV",
                        "app_qty": ai["quantity"],
                        "unit": "",
                    })
    
    print(f"\n  BOM discrepancies ({len(bom_discrepancies)}):")
    for d in bom_discrepancies:
        print(f"    ⚠ {d['recipe']} → {d['ingredient']}: CSV={d['csv_qty']} vs App={d['app_qty']} {d['unit']}")
    
    # ─── SECTION 3: MENU PRICES ─────────────────────────────────
    
    print()
    print("=" * 80)
    print("3. MENU PRICES COMPARISON (List Menu Kasir vs App)")
    print("=" * 80)
    print()
    
    # Parse HPP and Harga from CSV
    def parse_rupiah(s):
        """Parse Indonesian Rupiah string to number."""
        s = s.replace("Rp", "").replace(".", "").replace(",", ".").replace(" ", "").strip()
        if s == "FREE" or s == "":
            return 0
        try:
            return float(s)
        except:
            return 0
    
    price_comparisons = []
    for item in menu_kasir:
        csv_name_lower = item["name"].lower()
        app_recipe = ts_recipe_map.get(csv_name_lower)
        if not app_recipe:
            # Try fuzzy
            for ar_name, ar in ts_recipe_map.items():
                if csv_name_lower in ar_name or ar_name in csv_name_lower:
                    app_recipe = ar
                    break
        
        if app_recipe:
            csv_harga = parse_rupiah(item["harga_offline"])
            app_price = app_recipe["basePrice"]
            if csv_harga > 0 and abs(csv_harga - app_price) > 1:
                price_comparisons.append({
                    "name": item["name"],
                    "csv_harga": csv_harga,
                    "app_price": app_price,
                    "csv_hpp": item["hpp"],
                })
        else:
            price_comparisons.append({
                "name": item["name"],
                "csv_harga": parse_rupiah(item["harga_offline"]),
                "app_price": "NOT FOUND",
                "csv_hpp": item["hpp"],
            })
    
    print(f"  Price discrepancies ({len(price_comparisons)}):")
    for p in price_comparisons:
        print(f"    ⚠ {p['name']}: CSV Harga={p['csv_harga']}, App basePrice={p['app_price']}")
    
    # ─── SECTION 4: BRANCHES ────────────────────────────────────
    
    print()
    print("=" * 80)
    print("4. BRANCHES COMPARISON")
    print("=" * 80)
    print()
    
    # Map CSV branch names to app branch names
    branch_name_mapping = {
        "omoiyari wiyung": "Omoiyari Wiyung",
        "omoiyari darmo permai": "Omoiyari Darmo Permai",
        "omoiyari tenggilis": "Omoiyari Tenggilis",
        "omoiyari mulyorejo": "Omoiyari Mulyorejo",
        "omoiyari jambangan": "Omoiyari Jambangan",
        "omoiyari pucang": "Omoiyari Pucang",
        "omoiyari siwalankerto": "Omoiyari Siwalankerto",
    }
    
    for csv_branch in csv_branches:
        csv_lower = csv_branch["name"].lower()
        app_name = branch_name_mapping.get(csv_lower)
        
        if not app_name:
            print(f"  ✗ CSV branch '{csv_branch['name']}' not found in app")
            continue
        
        # Find in app
        app_branch = None
        for ab in ts_branches:
            if ab["name"] == app_name:
                app_branch = ab
                break
        
        if not app_branch:
            print(f"  ✗ CSV branch '{csv_branch['name']}' not found in app BRANCHES array")
            continue
        
        # Compare location/address
        csv_loc = csv_branch["location"].replace("\n", ", ").strip()
        app_loc = app_branch["location"].strip()
        
        # Normalize for comparison
        csv_loc_norm = re.sub(r'\s+', ' ', csv_loc).lower()
        app_loc_norm = re.sub(r'\s+', ' ', app_loc).lower()
        
        if csv_loc_norm != app_loc_norm:
            print(f"  ⚠ {app_name}:")
            print(f"    CSV: {csv_loc[:80]}...")
            print(f"    App: {app_loc[:80]}...")
            print()
    
    # App branches not in CSV
    csv_branch_names_lower = set(b["name"].lower() for b in csv_branches)
    for ab in ts_branches:
        if ab["name"] == "Central Warehouse":
            continue  # Expected - not an outlet
        if ab["name"].lower() not in csv_branch_names_lower:
            print(f"  ✗ App branch '{ab['name']}' not found in CSV")
    
    # ─── SECTION 5: HARGA INVOICE ───────────────────────────────
    
    print()
    print("=" * 80)
    print("5. HARGA INVOICE (Procurement Pricing) vs App averageCost")
    print("=" * 80)
    print()
    
    invoice_price_mismatches = []
    
    for item in harga_invoice:
        item_lower = item["name"].lower()
        # Find matching ingredient
        matched_ing = None
        
        if item_lower in name_map:
            matched_ing = name_map[item_lower]
        else:
            # Fuzzy match
            for ts_name, ts_ing in name_map.items():
                if (item_lower in ts_name or ts_name in item_lower or
                    item_lower.replace(" ", "") == ts_name.replace(" ", "")):
                    matched_ing = ts_ing
                    break
        
        if matched_ing and matched_ing["averageCost"] > 0:
            # Parse CSV price
            csv_price_str = item["harga_per_item"].replace("Rp", "").replace(",", "").replace(".", "").strip()
            try:
                csv_price = float(csv_price_str)
            except:
                csv_price = 0
            
            if csv_price > 0 and abs(csv_price - matched_ing["averageCost"]) > 1:
                invoice_price_mismatches.append({
                    "name": item["name"],
                    "ts_name": matched_ing["name"],
                    "csv_price": csv_price,
                    "app_avg_cost": matched_ing["averageCost"],
                    "ts_code": matched_ing["code"],
                })
    
    print(f"  Price mismatches ({len(invoice_price_mismatches)}):")
    for m in invoice_price_mismatches:
        print(f"    ⚠ {m['name']} ({m['ts_code']}): CSV Rp{m['csv_price']:,.0f} vs App Rp{m['app_avg_cost']:,.0f}")
    
    # ─── SECTION 6: STAFF MENU ──────────────────────────────────
    
    print()
    print("=" * 80)
    print("6. STAFF MENU COMPARISON")
    print("=" * 80)
    print()
    
    print("  Staff menu prices from CSV:")
    for p in staff_menu["prices"]:
        print(f"    {p['name']}: {p['hpp']}")
    
    print("\n  Staff menu prices in App RECIPES_DATA:")
    staff_recipes = ["Chicken Katsu Staff", "Chicken Karaage Staff", "Nasi Staff", "Telor Staff"]
    for sr_name in staff_recipes:
        app_recipe = ts_recipe_map.get(sr_name.lower())
        if app_recipe:
            print(f"    {app_recipe['name']}: Rp {app_recipe['basePrice']:,}")
        else:
            print(f"    {sr_name}: NOT FOUND")
    
    # ─── SECTION 7: DUPLICATES ──────────────────────────────────
    
    print()
    print("=" * 80)
    print("7. DUPLICATE / SUSPICIOUS ENTRIES")
    print("=" * 80)
    print()
    
    # Check for duplicate ingredient names in app
    name_counts = defaultdict(list)
    for ing in ts_ingredients:
        name_lower = normalize_name(ing["name"])
        name_counts[name_lower].append(ing)
    
    print("  Duplicate ingredient names in App:")
    for name, ings in name_counts.items():
        if len(ings) > 1:
            codes = [i["code"] for i in ings]
            print(f"    ⚠ '{ings[0]['name']}' appears {len(ings)} times: {', '.join(codes)}")
    
    # Check for duplicate ingredient names in CSV
    ck_name_counts = defaultdict(int)
    for item in ck_items:
        ck_name_counts[normalize_name(item["name"])] += 1
    
    print("\n  Duplicate ingredient names in Central Kitchen CSV:")
    for name, count in ck_name_counts.items():
        if count > 1:
            print(f"    ⚠ '{name}' appears {count} times")
    
    # ─── SECTION 8: NAMING ISSUES ───────────────────────────────
    
    print()
    print("=" * 80)
    print("8. NAMING / CASING ISSUES")
    print("=" * 80)
    print()
    
    # Compare names with exact match
    name_case_issues = []
    for item in ck_items:
        name_lower = normalize_name(item["name"])
        if name_lower in name_map:
            ts_name = name_map[name_lower]["name"]
            if item["name"] != ts_name:
                name_case_issues.append({
                    "csv": item["name"],
                    "ts": ts_name,
                })
    
    print("  Name casing/formatting differences (CK CSV vs App):")
    for issue in name_case_issues:
        print(f"    CSV: '{issue['csv']}' → App: '{issue['ts']}'")
    
    # ─── SUMMARY ────────────────────────────────────────────────
    
    print()
    print("=" * 80)
    print("SUMMARY OF ALL DISCREPANCIES")
    print("=" * 80)
    print()
    
    total_issues = (
        len(ck_missing_in_app) + len(ck_name_mismatches) + len(ck_unit_mismatches) +
        len(tenant_missing_in_app) + len(tenant_name_mismatches) + len(tenant_unit_mismatches) +
        len(app_only) + len(csv_missing_in_app) + len(app_extra_recipes) +
        len(bom_discrepancies) + len(price_comparisons) + len(invoice_price_mismatches) +
        len(name_case_issues)
    )
    
    print(f"  Total issues found: {total_issues}")
    print()
    print(f"  Central Kitchen CSV items not in app: {len(ck_missing_in_app)}")
    print(f"  Central Kitchen CSV name mismatches: {len(ck_name_mismatches)}")
    print(f"  Central Kitchen CSV unit mismatches: {len(ck_unit_mismatches)}")
    print(f"  Tenant CSV items not in app: {len(tenant_missing_in_app)}")
    print(f"  Tenant CSV name mismatches: {len(tenant_name_mismatches)}")
    print(f"  Tenant CSV unit mismatches: {len(tenant_unit_mismatches)}")
    print(f"  App ingredients not in any CSV: {len(app_only)}")
    print(f"  CSV recipes not in app: {len(csv_missing_in_app)}")
    print(f"  App recipes not in CSV: {len(app_extra_recipes)}")
    print(f"  BOM quantity discrepancies: {len(bom_discrepancies)}")
    print(f"  Menu price discrepancies: {len(price_comparisons)}")
    print(f"  Invoice price mismatches: {len(invoice_price_mismatches)}")
    print(f"  Name casing issues: {len(name_case_issues)}")
    print()

if __name__ == "__main__":
    main()
