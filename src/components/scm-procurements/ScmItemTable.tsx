import { Input } from "#/components/ui/input";
import { Badge } from "#/components/ui/badge";

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
  | "invoice-preview";

export interface ScmItemTableProps {
  mode: ScmItemTableMode;
  items: ScmItemRow[];
  onItemChange?: (itemId: string, patch: Partial<ScmItemRow>) => void;
  disabled?: boolean;
}

const decisionLabels: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  accepted: "Diterima",
};

const decisionColors: Record<string, "default" | "warning" | "success" | "destructive" | "secondary"> = {
  pending: "secondary",
  approved: "success",
  accepted: "success",
  rejected: "destructive",
};

export function ScmItemTable({ mode, items, onItemChange, disabled }: ScmItemTableProps) {
  if (mode === "ca-review") {
    return (
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Bahan</th>
              <th className="px-3 py-2 text-right">Diminta</th>
              <th className="px-3 py-2 text-right">Disetujui</th>
              <th className="px-3 py-2 text-center">Keputusan CA</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="px-3 py-2">{it.ingredientName}</td>
                <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                <td className="px-3 py-2 text-right">
                  <Input
                    type="number"
                    min={0}
                    defaultValue={it.readyQuantity ?? it.quantity}
                    disabled={disabled}
                    onChange={(e) => onItemChange?.(it.id, { readyQuantity: Number(e.target.value) })}
                    className="h-8 w-24 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onItemChange?.(it.id, { caDecision: "approved" })}
                      className={`rounded px-2 py-1 text-xs ${
                        it.caDecision === "approved"
                          ? "bg-green-100 text-green-700"
                          : "bg-muted hover:bg-green-50"
                      }`}
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onItemChange?.(it.id, { caDecision: "rejected" })}
                      className={`rounded px-2 py-1 text-xs ${
                        it.caDecision === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-muted hover:bg-red-50"
                      }`}
                    >
                      Tolak
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (mode === "ba-receive") {
    return (
      <div className="rounded-md border">
        <table className="w-full text-sm">
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
                        const newReceived = Number(e.target.value);
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
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Bahan</th>
              <th className="px-3 py-2 text-right">Diterima</th>
              <th className="px-3 py-2 text-right">Harga</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const lineTotal = (it.receivedQuantity ?? 0) * (it.unitPrice ?? 0);
              return (
                <tr key={it.id} className="border-b">
                  <td className="px-3 py-2">{it.ingredientName}</td>
                  <td className="px-3 py-2 text-right font-mono">{it.receivedQuantity}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    Rp {(it.unitPrice ?? 0).toLocaleString("id-ID")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    Rp {lineTotal.toLocaleString("id-ID")}
                  </td>
                </tr>
              );
            })}
            {items
              .filter((it) => (it.rejectedQuantity ?? 0) > 0)
              .map((it) => (
                <tr key={`r-${it.id}`} className="border-b bg-red-50">
                  <td className="px-3 py-2">
                    {it.ingredientName} <span className="text-xs text-muted-foreground">(Ditolak: {it.reason ?? "-"})</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {(it.rejectedQuantity ?? 0)} ditolak
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">Rp 0</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">Rp 0</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  }

  // read-only (default)
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
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
                <Badge variant={decisionColors[it.caDecision] ?? "secondary"} className="text-xs">
                  {decisionLabels[it.caDecision] ?? it.caDecision}
                </Badge>
              </td>
              <td className="px-3 py-2 text-center">
                <Badge variant={decisionColors[it.baDecision] ?? "secondary"} className="text-xs">
                  {decisionLabels[it.baDecision] ?? it.baDecision}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
