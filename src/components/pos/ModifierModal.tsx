// ============================================================
// ModifierModal — Item modifier selection modal
// ============================================================

import { useState } from "react";
import { X } from "lucide-react";
import type { CartModifier, MenuItemModifier } from "#/lib/pos-types";

interface ModifierModalProps {
  item: any;
  initial: CartModifier[];
  initialNotes: string;
  onClose: () => void;
  onConfirm: (modifiers: CartModifier[], notes: string) => void;
}

export default function ModifierModal({
  item,
  initial,
  initialNotes,
  onClose,
  onConfirm,
}: ModifierModalProps) {
  // Use React state internally
  let _a = useState(initial);
  let selected = _a[0];
  let setSelected = _a[1];
  let _b = useState(initialNotes);
  let notes = _b[0];
  let setNotes = _b[1];

  function isSingleChoice(groupId: string): boolean {
    let grp = item.modifierGroups.find(function (g: any) {
      return g.modifierGroupId === groupId;
    });
    return (grp?.maxSelection ?? 1) === 1;
  }

  function toggleModifier(grp: any, mod: MenuItemModifier) {
    let groupSelected = selected.filter(function (s) {
      return s.groupId === grp.modifierGroupId;
    });
    let hasThis = groupSelected.some(function (s) {
      return s.modifierId === mod.id;
    });

    if (hasThis) {
      setSelected(
        selected.filter(function (s) {
          return s.modifierId !== mod.id;
        }),
      );
    } else if (isSingleChoice(grp.modifierGroupId)) {
      setSelected(
        selected
          .filter(function (s) {
            return s.groupId !== grp.modifierGroupId;
          })
          .concat([
            {
              groupId: grp.modifierGroupId,
              modifierId: mod.id,
              name: mod.name,
              price: mod.price,
              isExclusion: mod.isExclusion,
            },
          ]),
      );
    } else if (groupSelected.length < (grp.maxSelection ?? 99)) {
      setSelected(
        selected.concat([
          {
            groupId: grp.modifierGroupId,
            modifierId: mod.id,
            name: mod.name,
            price: mod.price,
            isExclusion: mod.isExclusion,
          },
        ]),
      );
    }
  }

  let modTotal = selected.reduce(function (s: number, m: any) {
    return s + m.price;
  }, 0);
  let totalPrice = item.basePrice + modTotal;

  let isValid = item.modifierGroups.every(function (grp: any) {
    let count = selected.filter(function (s) {
      return s.groupId === grp.modifierGroupId;
    }).length;
    return count >= (grp.minSelection ?? 0);
  });

  return (
    // Enter animation matches the app's shared Modal (tw-animate-css): backdrop
    // fades, panel zooms from 95%. Exit is instant — the confirm button should
    // respond immediately, and this overlay is conditionally mounted. Off
    // entirely for prefers-reduced-motion.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <div className="w-full max-w-md rounded-xl border bg-card p-4 sm:p-6 shadow-lg max-h-[90vh] overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">{item.name}</h2>
            <p className="text-sm text-muted-foreground">
              Rp {item.basePrice.toLocaleString("id-ID")}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {item.modifierGroups.map(function (grp: any) {
            let groupSelected = selected.filter(function (s) {
              return s.groupId === grp.modifierGroupId;
            });
            let required = (grp.minSelection ?? 0) > 0;
            let meetsMin = groupSelected.length >= (grp.minSelection ?? 0);
            return (
              <div key={grp.modifierGroupId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{grp.groupName ?? "Modifier"}</h3>
                  <span className="text-[10px] font-bold uppercase">
                    {required ? (
                      <span className="text-destructive">Wajib</span>
                    ) : (
                      <span className="text-muted-foreground">Opsional</span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      &bull; {grp.maxSelection === 1 ? "Pilih 1" : "Maks " + grp.maxSelection}
                    </span>
                  </span>
                </div>
                {!meetsMin && required && (
                  <p className="text-[10px] text-destructive">Pilih minimal {grp.minSelection}</p>
                )}
                <div className="space-y-1.5">
                  {grp.modifiers.map(function (mod: MenuItemModifier) {
                    let isSel = groupSelected.some(function (s) {
                      return s.modifierId === mod.id;
                    });
                    let single = isSingleChoice(grp.modifierGroupId);
                    return (
                      <button
                        key={mod.id}
                        onClick={function () {
                          toggleModifier(grp, mod);
                        }}
                        className={
                          "w-full flex items-center justify-between gap-2 p-3 rounded-xl border transition-all cursor-pointer text-left " +
                          (isSel
                            ? mod.isExclusion
                              ? "bg-destructive/10 border-destructive/30 ring-1 ring-destructive/20"
                              : "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                            : "bg-card border-border hover:bg-muted")
                        }
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={
                              "shrink-0 flex items-center justify-center transition-colors " +
                              (single
                                ? "w-5 h-5 rounded-full border-2" +
                                  (isSel ? " border-primary" : " border-muted-foreground/30")
                                : "w-5 h-5 rounded border-2" +
                                  (isSel
                                    ? " border-primary bg-primary"
                                    : " border-muted-foreground/30"))
                            }
                          >
                            {isSel &&
                              (single ? (
                                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                              ) : (
                                <svg
                                  className="w-3 h-3 text-white"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ))}
                          </div>
                          <span
                            className={
                              "text-sm font-medium leading-snug " +
                              (isSel ? (mod.isExclusion ? "text-destructive" : "text-primary") : "")
                            }
                          >
                            {mod.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {mod.price > 0 && !mod.isExclusion && (
                            <span className="text-xs font-bold text-primary">
                              +Rp {mod.price.toLocaleString("id-ID")}
                            </span>
                          )}
                          {mod.isExclusion && (
                            <span className="text-xs font-bold text-destructive">Exclude</span>
                          )}
                          {mod.availableStock != null && mod.availableStock < 1 && (
                            <span className="text-[10px] font-semibold text-amber-600">
                              Stok kurang
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              value={notes}
              onChange={function (e) {
                setNotes(e.target.value);
              }}
              placeholder="Contoh: Pisah sambal, jangan pakai sayur..."
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Total Tambahan</p>
              <p className="text-sm font-bold text-primary">
                Rp {modTotal.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Item</p>
              <p className="text-lg font-bold">Rp {totalPrice.toLocaleString("id-ID")}</p>
            </div>
          </div>

          <button
            onClick={function () {
              onConfirm(selected, notes);
            }}
            disabled={!isValid}
            className="w-full px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Tambah ke Keranjang
          </button>
        </div>
      </div>
    </div>
  );
}
