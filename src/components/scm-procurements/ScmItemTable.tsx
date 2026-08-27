import { Input } from "#/components/ui/input";
import { lookupLabel } from "#/lib/label-lookup";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";

/**
 * ScmItemTable — the "giant interactive table" from lesson 0002 §5.
 * One component, many modes. The mode prop drives columns, editability,
 * and action buttons. Same data shape (items with 5 quantities) across
 * all states; only the UX differs.
 */

export interface ScmItemRow {
  id: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  readyQuantity: number | null;
  pickedQuantity: number | null;
  receivedQuantity: number | null;
  rejectedQuantity: number | null;
  caDecision: "pending" | "approved" | "rejected";
  baDecision: "pending" | "accepted" | "rejected";
  unitPrice: number | null;
  reason: string | null;
}

export type ScmItemTableMode =
  | "read-only"
  | "ca-review"
  | "ba-receive"
  | "ba-receive-confirm"
  | "invoice-preview"
  | "draft-edit";

export interface ScmItemTableProps {
  mode: ScmItemTableMode;
  items: ScmItemRow[];
  onItemChange?: (itemId: string, patch: Partial<ScmItemRow>) => void;
  disabled?: boolean;
  showPrices?: boolean; // ID15: Hide prices for branch_admin
}

const decisionLabels = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  accepted: "Diterima",
} satisfies Record<string, string>;

const decisionColors = {
  pending: "warning",
  approved: "success",
  accepted: "success",
  rejected: "destructive",
} satisfies Record<string, "default" | "warning" | "success" | "destructive" | "secondary">;

export function ScmItemTable({
  mode,
  items,
  onItemChange,
  disabled,
  showPrices = true,
}: ScmItemTableProps) {
  if (mode === "ca-review" || mode === "draft-edit") {
    const isDraft = mode === "draft-edit";
    const subtotal = items.reduce(
      (sum, it) => sum + (it.readyQuantity ?? it.quantity) * (it.unitPrice ?? 0),
      0,
    );
    return (
      <>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2.5">
          {items.map((it) => {
            const ready = it.readyQuantity ?? it.quantity;
            const lineTotal = ready * (it.unitPrice ?? 0);
            return (
              <div key={it.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                <div className="font-medium text-sm truncate pr-2">{it.ingredientName}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Diminta
                    </div>
                    <div className="font-mono font-medium mt-0.5">{it.quantity}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      {isDraft ? "Jumlah" : "Disetujui"}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={ready}
                      disabled={disabled}
                      onChange={(e) =>
                        onItemChange?.(it.id, { readyQuantity: Number(e.target.value) })
                      }
                      className="h-9 mt-1 text-sm"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                {showPrices && (
                  <div className="mt-2 flex items-center justify-between text-xs gap-2">
                    <span className="text-muted-foreground">
                      Harga Rp {(it.unitPrice ?? 0).toLocaleString("id-ID")}
                    </span>
                    <span className="font-mono font-semibold tabular-nums">
                      Rp {lineTotal.toLocaleString("id-ID")}
                    </span>
                  </div>
                )}
                {!isDraft && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={it.caDecision === "approved" ? "default" : "outline"}
                      disabled={disabled}
                      aria-pressed={it.caDecision === "approved"}
                      onClick={() => onItemChange?.(it.id, { caDecision: "approved" })}
                      className="h-11 rounded-xl text-sm"
                    >
                      Setujui
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={it.caDecision === "rejected" ? "destructive" : "outline"}
                      disabled={disabled}
                      aria-pressed={it.caDecision === "rejected"}
                      onClick={() => onItemChange?.(it.id, { caDecision: "rejected" })}
                      className="h-11 rounded-xl text-sm"
                    >
                      Tolak
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {showPrices && (
            <div className="rounded-xl border bg-muted/30 p-3 flex items-center justify-between">
              <span className="text-sm font-medium">Subtotal</span>
              <span className="font-mono font-semibold tabular-nums">
                Rp {subtotal.toLocaleString("id-ID")}
              </span>
            </div>
          )}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Bahan</th>
                <th className="px-3 py-2 text-right">Diminta</th>
                <th className="px-3 py-2 text-right">{isDraft ? "Jumlah" : "Disetujui"}</th>
                {showPrices && <th className="px-3 py-2 text-right">Harga</th>}
                {showPrices && <th className="px-3 py-2 text-right">Subtotal</th>}
                {!isDraft ? <th className="px-3 py-2 text-center">Keputusan CA</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const ready = it.readyQuantity ?? it.quantity;
                const lineTotal = ready * (it.unitPrice ?? 0);
                return (
                  <tr key={it.id} className="border-b">
                    <td className="px-3 py-2">{it.ingredientName}</td>
                    <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={ready}
                        disabled={disabled}
                        onChange={(e) =>
                          onItemChange?.(it.id, { readyQuantity: Number(e.target.value) })
                        }
                        className="h-8 w-24 text-right"
                      />
                    </td>
                    {showPrices && (
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        Rp {(it.unitPrice ?? 0).toLocaleString("id-ID")}
                      </td>
                    )}
                    {showPrices && (
                      <td className="px-3 py-2 text-right font-mono">
                        Rp {lineTotal.toLocaleString("id-ID")}
                      </td>
                    )}
                    {!isDraft ? (
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={it.caDecision === "approved" ? "default" : "outline"}
                            disabled={disabled}
                            aria-pressed={it.caDecision === "approved"}
                            onClick={() => onItemChange?.(it.id, { caDecision: "approved" })}
                          >
                            Setujui
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={it.caDecision === "rejected" ? "destructive" : "outline"}
                            disabled={disabled}
                            aria-pressed={it.caDecision === "rejected"}
                            onClick={() => onItemChange?.(it.id, { caDecision: "rejected" })}
                          >
                            Tolak
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            {showPrices && (
              <tfoot>
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right">
                    Subtotal:
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    Rp {subtotal.toLocaleString("id-ID")}
                  </td>
                  {!isDraft ? <td></td> : null}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </>
    );
  }

  if (mode === "ba-receive") {
    return (
      <>
        <div className="md:hidden space-y-2.5">
          {items.map((it) => {
            const picked = it.pickedQuantity ?? 0;
            const received = it.receivedQuantity ?? picked;
            const rejected = picked - received;
            return (
              <div key={it.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm truncate">{it.ingredientName}</div>
                  <div className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-mono">
                    Kirim {picked || "-"}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Diterima
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={picked}
                      value={received}
                      disabled={disabled}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const newReceived = Math.min(
                          Math.max(0, Number.isNaN(raw) ? 0 : raw),
                          picked,
                        );
                        onItemChange?.(it.id, {
                          receivedQuantity: newReceived,
                          rejectedQuantity: picked - newReceived,
                        });
                      }}
                      className="h-11 mt-1 text-base"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2 flex flex-col justify-center">
                    <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                      Ditolak (auto)
                    </div>
                    <div className="font-mono text-sm font-semibold mt-1">{rejected}</div>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                    Alasan
                  </div>
                  <Input
                    type="text"
                    placeholder="Alasan penolakan (opsional)"
                    value={it.reason ?? ""}
                    disabled={disabled}
                    onChange={(e) => onItemChange?.(it.id, { reason: e.target.value })}
                    className="h-11 mt-1"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Bahan</th>
                <th className="px-3 py-2 text-right">Dikirim</th>
                <th className="px-3 py-2 text-right">Diterima</th>
                <th className="px-3 py-2 text-right">Ditolak (auto)</th>
                <th className="px-3 py-2 text-left">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const picked = it.pickedQuantity ?? 0;
                const received = it.receivedQuantity ?? picked;
                const rejected = picked - received;
                return (
                  <tr key={it.id} className="border-b">
                    <td className="px-3 py-2">{it.ingredientName}</td>
                    <td className="px-3 py-2 text-right font-mono">{picked || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={picked}
                        value={received}
                        disabled={disabled}
                        onChange={(e) => {
                          const raw = Number(e.target.value);
                          const newReceived = Math.min(
                            Math.max(0, Number.isNaN(raw) ? 0 : raw),
                            picked,
                          );
                          onItemChange?.(it.id, {
                            receivedQuantity: newReceived,
                            rejectedQuantity: picked - newReceived,
                          });
                        }}
                        className="h-8 w-24 text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {rejected}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="text"
                        placeholder="(opsional)"
                        value={it.reason ?? ""}
                        disabled={disabled}
                        onChange={(e) => onItemChange?.(it.id, { reason: e.target.value })}
                        className="h-8 w-full"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (mode === "invoice-preview") {
    const rejected = items.filter((it) => (it.rejectedQuantity ?? 0) > 0);
    return (
      <>
        <div className="md:hidden space-y-2.5">
          {items.map((it) => {
            const lineTotal = (it.receivedQuantity ?? 0) * (it.unitPrice ?? 0);
            return (
              <div
                key={it.id}
                className="rounded-xl border bg-card p-3.5 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{it.ingredientName}</div>
                  <div className="text-xs text-muted-foreground">
                    Diterima {it.receivedQuantity ?? 0}
                  </div>
                </div>
                {showPrices ? (
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">
                      Rp {(it.unitPrice ?? 0).toLocaleString("id-ID")}
                    </div>
                    <div className="font-mono text-sm font-semibold">
                      Rp {lineTotal.toLocaleString("id-ID")}
                    </div>
                  </div>
                ) : (
                  <div className="font-mono text-sm">{it.receivedQuantity}</div>
                )}
              </div>
            );
          })}
          {rejected.map((it) => (
            <div
              key={`r-${it.id}`}
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3.5"
            >
              <div className="font-medium text-sm">
                {it.ingredientName}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  — ditolak {it.rejectedQuantity} ({it.reason ?? "-"})
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Bahan</th>
                <th className="px-3 py-2 text-right">Diterima</th>
                {showPrices && <th className="px-3 py-2 text-right">Harga</th>}
                {showPrices && <th className="px-3 py-2 text-right">Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const lineTotal = (it.receivedQuantity ?? 0) * (it.unitPrice ?? 0);
                return (
                  <tr key={it.id} className="border-b">
                    <td className="px-3 py-2">{it.ingredientName}</td>
                    <td className="px-3 py-2 text-right font-mono">{it.receivedQuantity}</td>
                    {showPrices && (
                      <td className="px-3 py-2 text-right font-mono">
                        Rp {(it.unitPrice ?? 0).toLocaleString("id-ID")}
                      </td>
                    )}
                    {showPrices && (
                      <td className="px-3 py-2 text-right font-mono">
                        Rp {lineTotal.toLocaleString("id-ID")}
                      </td>
                    )}
                  </tr>
                );
              })}{" "}
              {rejected.map((it) => (
                <tr key={`r-${it.id}`} className="border-b bg-destructive/5">
                  <td className="px-3 py-2">
                    {it.ingredientName}{" "}
                    <span className="text-xs text-muted-foreground">
                      (Ditolak: {it.reason ?? "-"})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {it.rejectedQuantity ?? 0} ditolak
                  </td>
                  {showPrices && (
                    <td className="px-3 py-2 text-right text-muted-foreground">Rp 0</td>
                  )}
                  {showPrices && (
                    <td className="px-3 py-2 text-right text-muted-foreground">Rp 0</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // read-only (default)
  return (
    <>
      <div className="md:hidden space-y-2.5">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
            <div className="font-medium text-sm truncate">{it.ingredientName}</div>
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-xs">
              <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                  Diminta
                </div>
                <div className="font-mono font-semibold mt-0.5">{it.quantity}</div>
              </div>
              <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                  Setuju
                </div>
                <div className="font-mono font-medium mt-0.5">{it.readyQuantity ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                  Kirim
                </div>
                <div className="font-mono font-medium mt-0.5">{it.pickedQuantity ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                <div className="text-[10px] tracking-widest uppercase text-muted-foreground font-medium">
                  Diterima
                </div>
                <div className="font-mono font-semibold mt-0.5">{it.receivedQuantity ?? "—"}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                <Badge
                  variant={lookupLabel(decisionColors, it.caDecision) ?? "secondary"}
                  className="text-[11px] px-2 py-0 h-5"
                >
                  CA: {lookupLabel(decisionLabels, it.caDecision) ?? it.caDecision}
                </Badge>
                <Badge
                  variant={lookupLabel(decisionColors, it.baDecision) ?? "secondary"}
                  className="text-[11px] px-2 py-0 h-5 hidden xs:inline-flex"
                >
                  BA: {lookupLabel(decisionLabels, it.baDecision) ?? it.baDecision}
                </Badge>
              </div>
              {(it.rejectedQuantity ?? 0) > 0 && (
                <span className="text-xs text-destructive font-medium">
                  Ditolak {it.rejectedQuantity}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Bahan</th>
              <th className="px-3 py-2 text-right">Diminta</th>
              <th className="px-3 py-2 text-right">Disetujui</th>
              <th className="px-3 py-2 text-right">Dikirim</th>
              <th className="px-3 py-2 text-right">Diterima</th>
              <th className="px-3 py-2 text-right">Ditolak</th>
              <th className="px-3 py-2 text-center">CA</th>
              <th className="px-3 py-2 text-center">BA</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="px-3 py-2">{it.ingredientName}</td>
                <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                <td className="px-3 py-2 text-right font-mono">{it.readyQuantity ?? "-"}</td>
                <td className="px-3 py-2 text-right font-mono">{it.pickedQuantity ?? "-"}</td>
                <td className="px-3 py-2 text-right font-mono">{it.receivedQuantity ?? "-"}</td>
                <td className="px-3 py-2 text-right font-mono">{it.rejectedQuantity ?? "-"}</td>
                <td className="px-3 py-2 text-center">
                  <Badge
                    variant={lookupLabel(decisionColors, it.caDecision) ?? "secondary"}
                    className="text-xs"
                  >
                    {lookupLabel(decisionLabels, it.caDecision) ?? it.caDecision}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-center">
                  <Badge
                    variant={lookupLabel(decisionColors, it.baDecision) ?? "secondary"}
                    className="text-xs"
                  >
                    {lookupLabel(decisionLabels, it.baDecision) ?? it.baDecision}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
