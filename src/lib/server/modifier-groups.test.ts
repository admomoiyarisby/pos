import { describe, it, expect } from "vite-plus/test";
import { reorderModifiersInput } from "#/lib/server/modifier-groups";

// `reorderModifiers` writes `sort_order = array index` for each id in the
// payload (see the handler). These tests pin the input contract so the
// drag-and-drop UI on /modifier-groups can trust the schema: array order is
// the new sort order, and every id must be a uuid.

const UUID_A = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const UUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UUID_C = "c0b7b2a1-3d4e-4f5a-9b6c-7d8e9f0a1b2c";
const GROUP_ID = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

describe("reorderModifiersInput", () => {
  it("accepts a valid group id + ordered modifier id list", () => {
    const parsed = reorderModifiersInput.parse({
      modifierGroupId: GROUP_ID,
      modifierIds: [UUID_A, UUID_B, UUID_C],
    });

    expect(parsed.modifierGroupId).toBe(GROUP_ID);
    // Array order is preserved — the handler maps index → sort_order, so the
    // order here is exactly the new sort order on the server.
    expect(parsed.modifierIds).toEqual([UUID_A, UUID_B, UUID_C]);
  });

  it("preserves a reversed order (the reorder payload from drag-and-drop)", () => {
    const parsed = reorderModifiersInput.parse({
      modifierGroupId: GROUP_ID,
      modifierIds: [UUID_C, UUID_A, UUID_B],
    });

    expect(parsed.modifierIds[0]).toBe(UUID_C);
    expect(parsed.modifierIds[2]).toBe(UUID_B);
  });

  it("accepts an empty modifierIds array (clearing all sorts)", () => {
    const parsed = reorderModifiersInput.parse({
      modifierGroupId: GROUP_ID,
      modifierIds: [],
    });

    expect(parsed.modifierIds).toEqual([]);
  });

  it("rejects a non-uuid modifierGroupId", () => {
    expect(() =>
      reorderModifiersInput.parse({
        modifierGroupId: "not-a-uuid",
        modifierIds: [UUID_A],
      }),
    ).toThrow();
  });

  it("rejects a non-uuid entry in modifierIds", () => {
    expect(() =>
      reorderModifiersInput.parse({
        modifierGroupId: GROUP_ID,
        modifierIds: [UUID_A, "not-a-uuid"],
      }),
    ).toThrow();
  });

  it("rejects a missing modifierIds field", () => {
    expect(() =>
      reorderModifiersInput.parse({
        modifierGroupId: GROUP_ID,
      }),
    ).toThrow();
  });

  it("rejects a missing modifierGroupId field", () => {
    expect(() =>
      reorderModifiersInput.parse({
        modifierIds: [UUID_A],
      }),
    ).toThrow();
  });

  it("rejects a modifierIds array containing non-string values", () => {
    // `any` simulates an untyped client payload that smuggles a number in.
    const bad: any = [UUID_A, 123];
    expect(() =>
      reorderModifiersInput.parse({
        modifierGroupId: GROUP_ID,
        modifierIds: bad,
      }),
    ).toThrow();
  });
});
