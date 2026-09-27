import { describe, expect, it } from "vite-plus/test";
import { orderBranchOptions } from "#/lib/order-branches";

const order = (branchId: string, branchName: string | null) => ({ branchId, branchName });

describe("orderBranchOptions", () => {
  it("returns an empty list when there are no orders", () => {
    expect(orderBranchOptions([])).toEqual([]);
  });

  it("lists each distinct branch once, in name order", () => {
    const result = orderBranchOptions([
      order("b1", "Omoiyari Wijung"),
      order("b2", "Omoiyari Surabaya Barat"),
      order("b1", "Omoiyari Wijung"),
    ]);
    // Deduped by id, and sorted by name: "Surabaya" precedes "Wijung".
    expect(result).toEqual([
      { id: "b2", name: "Omoiyari Surabaya Barat" },
      { id: "b1", name: "Omoiyari Wijung" },
    ]);
  });

  it("sorts alphabetically by name", () => {
    const result = orderBranchOptions([
      order("c", "Sidoarjo"),
      order("a", "Mulyorejo"),
      order("b", "Tegalsari"),
    ]);
    expect(result.map((o) => o.name)).toEqual(["Mulyorejo", "Sidoarjo", "Tegalsari"]);
  });

  // Keyed by id, not name: two branches can legitimately share a display name
  // and must stay separately selectable.
  it("keeps two branches that share a name distinct", () => {
    const result = orderBranchOptions([
      order("b1", "Omoiyari Pusat"),
      order("b2", "Omoiyari Pusat"),
    ]);
    expect(result).toEqual([
      { id: "b1", name: "Omoiyari Pusat" },
      { id: "b2", name: "Omoiyari Pusat" },
    ]);
  });

  // An order whose branch could not be resolved must not become a blank entry.
  it("skips orders with no branch name", () => {
    const result = orderBranchOptions([
      order("b1", null),
      order("b2", "Omoiyari Wijung"),
      order("b3", null),
    ]);
    expect(result).toEqual([{ id: "b2", name: "Omoiyari Wijung" }]);
  });

  it("keeps the first name seen for a branch id", () => {
    const result = orderBranchOptions([order("b1", "Nama Lama"), order("b1", "Nama Baru")]);
    expect(result).toEqual([{ id: "b1", name: "Nama Lama" }]);
  });
});
