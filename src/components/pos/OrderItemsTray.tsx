import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { getOrderWithItems } from "#/lib/server/pos";

interface OrderItemsTrayProps {
  orderId: string;
  /** Compact table (fixed text-xs, narrower price columns) for narrow panels like the POS cart sidebar. */
  compact?: boolean;
  /** Branch display name shown above the table — helps identify orders when a
   *  single list spans multiple branches (super_admin / area_manager). */
  branchName?: string | null;
}

export default function OrderItemsTray({ orderId, compact, branchName }: OrderItemsTrayProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["order-items", orderId],
    queryFn: () => getOrderWithItems({ data: { id: orderId } }),
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground px-1 py-2">Memuat menu…</p>;
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground px-1 py-2">Tidak ada item.</p>;
  }

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      {branchName && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/40 text-muted-foreground">
          <Store className="h-3 w-3 shrink-0" />
          <span className={"font-medium truncate " + (compact ? "text-[11px]" : "text-xs")}>
            {branchName}
          </span>
        </div>
      )}
      <table className={"w-full text-xs " + (compact ? "" : "sm:text-sm")}>
        <thead>
          <tr className="border-b bg-muted/50 text-muted-foreground">
            <th className="text-left font-medium py-1.5 px-3">Menu</th>
            <th className="text-right font-medium py-1.5 px-2 w-14">Qty</th>
            <th className={"text-right font-medium py-1.5 px-2 " + (compact ? "w-20" : "w-28")}>
              Harga
            </th>
            <th className={"text-right font-medium py-1.5 px-3 " + (compact ? "w-24" : "w-32")}>
              Subtotal
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any) => {
            const lineTotal = (item.price ?? 0) * item.quantity;
            return (
              <tr key={item.id ?? item.recipeId} className="border-b last:border-b-0">
                <td className="py-1.5 px-3">
                  <p className="font-medium">{item.recipeName ?? "-"}</p>
                  {(item.modifiers?.length > 0 || item.notes) && (
                    <p className="text-muted-foreground text-[11px] sm:text-xs mt-0.5">
                      {item.modifiers?.filter(Boolean).join(", ")}
                      {item.modifiers?.length > 0 && item.notes ? " · " : ""}
                      {item.notes}
                    </p>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{item.quantity}×</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                  Rp {(item.price ?? 0).toLocaleString("id-ID")}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums font-medium">
                  Rp {lineTotal.toLocaleString("id-ID")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
