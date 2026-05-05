# Phase 5 Implementation Summary — Yield Tracking & Production

## What Was Built

### Server Functions (`src/lib/server/yield.ts`)

| Function                | Purpose                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getYieldConversions`   | Returns yield history with source/target ingredient names, yield %, shrinkage. Central Kitchen / Super Admin only.                                                             |
| `createYieldConversion` | Full yield tracking transaction: deducts source RM, adds target SFG/FG, recalculates target HPP, creates paired ledger entries, performs BOM cost roll-up on affected recipes. |

### Yield Tracking Logic

**Input:**

- Source: Raw Material (RM) + quantity used (e.g. 10,000g Ayam Mentah)
- Target: Semi-Finished/Finished Good (SFG/FG) + quantity produced (e.g. 8,000g Ayam Matang)

**Auto-calculation:**

- `Total Source Cost` = source.quantity × source.averageCost
- `New Target HPP` = Total Source Cost / target.quantity (e.g. Rp 300,000 / 8kg = Rp 37,500/kg)
- `Yield %` = (target.quantity / source.quantity) × 100 (e.g. 80%)
- `Shrinkage` = source.quantity - target.quantity (e.g. 2,000g)

**Side effects:**

1. Deduct source from inventory + ledger OUT
2. Add target to inventory + ledger IN (same production reference)
3. Update target ingredient's `averageCost` in master data
4. BOM Cost Roll-Up: Iterate all recipes using target ingredient, recalculate total COGS

### Route Page (`/yield-tracking`)

#### Summary Cards

- Total Produksi (count)
- Average Yield % (color-coded)
- Total Shrinkage (sum of all losses)

#### History Table

- Waktu, Bahan Mentah (with qty), Hasil Produksi (with qty)
- Yield % badge (green ≥80%, amber ≥50%, red <50%)
- Shrinkage in red

#### Input Produksi Modal

- **Branch/Gudang selector** (filtered to Central only)
- **Bahan Mentah section**: Dropdown of RM ingredients (shows current HPP), qty input
- **Visual arrow** between sections
- **Hasil Produksi section**: Dropdown of SFG/FG ingredients (shows current HPP), qty input
- **Catatan Produksi** textarea
- **Warning box**: Explains auto-calculation behavior
- On submit: shows success banner with new HPP, yield %, and shrinkage

### Auth & RBAC

| Route             | Allowed Roles                             |
| ----------------- | ----------------------------------------- |
| `/yield-tracking` | super_admin, central_kitchen              |
| `/ingredients`    | super_admin, admin_pusat, central_kitchen |

## Files Created / Modified

| File                                    | Lines | Purpose                                                              |
| --------------------------------------- | ----- | -------------------------------------------------------------------- |
| `src/lib/server/yield.ts`               | ~250  | Yield tracking server functions with HPP recalculation & BOM roll-up |
| `src/routes/_layout/yield-tracking.tsx` | ~340  | Yield tracking page with form, history, and summary cards            |

## How to Test Phase 5

1. **Login as Central Kitchen** or **Super Admin**
2. **Navigate to** `/yield-tracking`
3. **Click "Input Produksi"**
4. Select:
   - Gudang Pusat (Central Warehouse)
   - Bahan Mentah: e.g. "Daging Ayam Fillet" (RM)
   - Jumlah Mentah: 10000 (gram)
   - Hasil: e.g. "Ayam Teriyaki Matang" (SFG)
   - Jumlah Hasil: 8000 (gram)
5. **Submit**
6. Verify:
   - Success banner shows new HPP (e.g. Rp 37,500/g)
   - Yield = 80%, Shrinkage = 2,000g
   - History table updated
   - Check `/inventory/ledger` for paired IN/OUT entries with same reference
   - Check `/ingredients` — target ingredient HPP updated
   - Check `/recipes` — recipes using target ingredient have updated COGS

## Ready for Phase 6

Phase 5 completes the production module:

- ✅ Yield tracking form with auto HPP recalculation
- ✅ Shrinkage and yield % calculation
- ✅ Paired ledger entries (OUT source, IN target)
- ✅ BOM Cost Roll-Up on affected recipes
- ✅ Production history with summary cards

Phase 6 (Finance, Analytics & Period Control) can now begin.
