// ──────────────────────────────────────────
// ID maps: prototype ID → database UUID
// ──────────────────────────────────────────
export interface IdMap {
  branch: Map<string, string>;
  brand: Map<string, string>;
  supplier: Map<string, string>;
  user: Map<string, string>;
  ingredient: Map<string, string>;
  modifierGroup: Map<string, string>;
  modifier: Map<string, string>;
  recipe: Map<string, string>;
}

export function createIdMap(): IdMap {
  return {
    branch: new Map(),
    brand: new Map(),
    supplier: new Map(),
    user: new Map(),
    ingredient: new Map(),
    modifierGroup: new Map(),
    modifier: new Map(),
    recipe: new Map(),
  };
}
