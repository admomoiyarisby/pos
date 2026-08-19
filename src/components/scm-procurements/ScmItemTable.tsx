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
    return (
      <div className="rounded-md border overflow-x-auto">
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
                  Rp{" "}
                  {items
                    .reduce(
                      (sum, it) => sum + (it.readyQuantity ?? it.quantity) * (it.unitPrice ?? 0),
                      0,
                    )
                    .toLocaleString("id-ID")}
                </td>
                {!isDraft ? <td></td> : null}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  }

  if (mode === "ba-receive") {
    return (
      <div className="rounded-md border overflow-x-auto">
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
                        // Enforce max=picked in code, not just HTML, so a
                        // pasted or typed-over-max value can't produce a
                        // negative rejectedQuantity downstream.
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
    );
  }

  if (mode === "invoice-preview") {
    return (
      <div className="rounded-md border overflow-x-auto">
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
            })}
            {items
              .filter((it) => (it.rejectedQuantity ?? 0) > 0)
              .map((it) => (
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
    );
  }

  // read-only (default)
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Bahan</th>
            <th className="px-3 py-2 text-right">Diminta</th>
            <th className="hidden md:table-cell px-3 py-2 text-right">Disetujui</th>
            <th className="hidden md:table-cell px-3 py-2 text-right">Dikirim</th>
            <th className="px-3 py-2 text-right">Diterima</th>
            <th className="hidden md:table-cell px-3 py-2 text-right">Ditolak</th>
            <th className="px-3 py-2 text-center">CA</th>
            <th className="hidden md:table-cell px-3 py-2 text-center">BA</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b">
              <td className="px-3 py-2">{it.ingredientName}</td>
              <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
              <td className="hidden md:table-cell px-3 py-2 text-right font-mono">
                {it.readyQuantity ?? "-"}
              </td>
              <td className="hidden md:table-cell px-3 py-2 text-right font-mono">
                {it.pickedQuantity ?? "-"}
              </td>
              <td className="px-3 py-2 text-right font-mono">{it.receivedQuantity ?? "-"}</td>
              <td className="hidden md:table-cell px-3 py-2 text-right font-mono">
                {it.rejectedQuantity ?? "-"}
              </td>
              <td className="px-3 py-2 text-center">
                <Badge
                  variant={lookupLabel(decisionColors, it.caDecision) ?? "secondary"}
                  className="text-xs"
                >
                  {lookupLabel(decisionLabels, it.caDecision) ?? it.caDecision}
                </Badge>
              </td>
              <td className="hidden md:table-cell px-3 py-2 text-center">
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
  );
}
