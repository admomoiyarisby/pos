import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { getOrderWithItems } from "#/lib/server/pos";
import { appliedModifierLines } from "#/lib/pos-utils";
import { channelLabel } from "#/lib/order-channels";

interface OrderItemsTrayProps {
  orderId: string;
  /** Compact sizes for narrow panels like the POS cart sidebar. */
  compact?: boolean;
  /** Branch display name shown above the list — helps identify orders when a
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

  const renderMeta = (item: any) => {
    const hasMeta = item.modifiers?.length > 0 || item.notes;
    if (!hasMeta) return null;
    return (
      <p className="text-muted-foreground text-[11px] sm:text-xs mt-0.5">
        {item.modifiers?.length > 0 &&
          appliedModifierLines(item.modifiers).map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        {item.modifiers?.length > 0 && item.notes ? " · " : ""}
        {item.notes}
      </p>
    );
  };

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

      {/* Order meta: Kode Order (ojol) with channel, plus pelanggan & payment
          when present — so a cashier can re-check the Gofood/Grab/Shopee code
          without opening the receipt. Hidden entirely when nothing to show. */}
      {(data?.orderCode || data?.customerName || data?.paymentMethod) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 border-b bg-muted/30">
          {data?.orderCode && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary font-medium"
              title="Kode Order"
            >
              {data.orderCode}
              {data?.channel && (
                <span className="not-italic font-sans text-[9px] text-muted-foreground">
                  · {channelLabel(data.channel)}
                </span>
              )}
            </span>
          )}
          {!data?.orderCode && data?.customerName && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-medium"
              title="Pelanggan"
            >
              {data.customerName}
            </span>
          )}
          {data?.customerName && data?.orderCode && (
            <span className="text-[10px] text-muted-foreground truncate">{data.customerName}</span>
          )}
          {data?.paymentMethod && (
            <span className="ml-auto text-[10px] text-muted-foreground">{data.paymentMethod}</span>
          )}
        </div>
      )}

      {/* Mobile: item cards. Four price columns share ~300px on a phone, which
          squeezes the menu name into one-character wrapping — a stacked row
          (name + subtotal on top, qty × harga below) reads instantly instead. */}
      <div className="md:hidden divide-y">
        {items.map((item: any) => {
          const lineTotal = (item.price ?? 0) * item.quantity;
          return (
            <div key={item.id ?? item.recipeId} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-xs font-medium">
                  <span className="line-clamp-2 break-words">{item.recipeName ?? "-"}</span>
                </p>
                <p className="shrink-0 text-xs font-semibold tabular-nums">
                  Rp {lineTotal.toLocaleString("id-ID")}
                </p>
              </div>
              {renderMeta(item)}
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {item.quantity}× Rp {(item.price ?? 0).toLocaleString("id-ID")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Desktop / wide panels: the classic table. Fixed layout with a
          colgroup lets Menu keep all remaining space while the number
          columns hug their content with whitespace-nowrap. */}
      <table
        className={"hidden md:table w-full table-fixed text-xs " + (compact ? "" : "sm:text-sm")}
      >
        <colgroup>
          <col />
          <col className="w-10" />
          <col className={compact ? "w-[72px]" : "w-24"} />
          <col className={compact ? "w-[76px]" : "w-28"} />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/50 text-muted-foreground">
            <th className="text-left font-medium py-1.5 px-3">Menu</th>
            <th className="text-right font-medium py-1.5 px-1 whitespace-nowrap">Qty</th>
            <th
              className={
                "text-right font-medium py-1.5 px-1.5 whitespace-nowrap " + (compact ? "" : "px-2")
              }
            >
              Harga
            </th>
            <th className="text-right font-medium py-1.5 px-2.5 whitespace-nowrap">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any) => {
            const lineTotal = (item.price ?? 0) * item.quantity;
            return (
              <tr key={item.id ?? item.recipeId} className="border-b last:border-b-0">
                <td className="py-1.5 px-3">
                  <p className="font-medium">
                    <span className="line-clamp-2 break-words">{item.recipeName ?? "-"}</span>
                  </p>
                  {renderMeta(item)}
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums whitespace-nowrap">
                  {item.quantity}×
                </td>
                <td className="py-1.5 px-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                  Rp {(item.price ?? 0).toLocaleString("id-ID")}
                </td>
                <td className="py-1.5 px-2.5 text-right tabular-nums whitespace-nowrap font-medium">
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
