import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { badgeVariant } from "#/lib/utils";
import { lookupLabel } from "#/lib/label-lookup";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { ArrowLeft, Building2, ArrowRight, Hash, CalendarDays } from "lucide-react";
import { getMutasiTransfer } from "#/lib/server/scm-transfers";
import { canAmAct } from "#/lib/server/scm-transfer-queries";
import { getBranches } from "#/lib/server/branches";
import { getIngredients } from "#/lib/server/ingredients";
import { ScmStepper } from "#/components/scm/Stepper";
import {
  DraftSenderForm,
  PendingSenderWaiting,
  PendingAmReview,
  ApprovedSenderShip,
  InTransitReceiverTracking,
  DeliveredReceiverForm,
  ReviewingReceiverInteractive,
  WaitingInvoice,
  FinishedView,
  RejectedView,
  CancelledView,
  type TransferViewProps,
} from "#/components/scm-transfers";

export const Route = createFileRoute("/_layout/scm-transfers/$transferId")({
  component: TransferDetailPage,
  loader: async ({ params }) => {
    const [data, branches, ingredients] = await Promise.all([
      getMutasiTransfer({ data: { transferId: params.transferId } }),
      getBranches({ data: {} }),
      getIngredients({ data: { excludeNasi: true } }),
    ]);
    return { initial: data, initialBranches: branches, initialIngredients: ingredients };
  },
});

const TRANSFER_STEPS = [
  { key: "SuratJalanDraft", label: "Draft SJ" },
  { key: "PendingAMReview", label: "Menunggu AM" },
  { key: "Approved", label: "Disetujui" },
  { key: "InTransit", label: "Dalam Pengiriman" },
  { key: "Delivered", label: "Diterima" },
  { key: "ReviewingSJ", label: "Review Penerima" },
  { key: "WaitingForPayment", label: "Menunggu Bayar" },
  { key: "Finished", label: "Lunas" },
];

const statusLabels = {
  SuratJalanDraft: "Draft SJ",
  PendingAMReview: "Menunggu AM",
  Approved: "Disetujui",
  InTransit: "Dalam Pengiriman",
  Delivered: "Diterima",
  ReviewingSJ: "Review Penerima",
  WaitingForPayment: "Menunggu Bayar",
  Finished: "Lunas",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
} satisfies Record<string, string>;

const statusColors = {
  SuratJalanDraft: "secondary",
  PendingAMReview: "warning",
  Approved: "default",
  InTransit: "default",
  Delivered: "default",
  ReviewingSJ: "default",
  WaitingForPayment: "warning",
  Finished: "success",
  Rejected: "destructive",
  Cancelled: "secondary",
} satisfies Record<string, "default" | "warning" | "success" | "destructive" | "secondary">;

function TransferDetailPage() {
  const { user } = useAuth();
  const { transferId } = Route.useParams();
  const { initial, initialBranches, initialIngredients } = Route.useLoaderData();
  const navigate = useNavigate();

  const branchById = useMemo(
    () => new Map(initialBranches.map((b: { id: string; name: string }) => [b.id, b])),
    [initialBranches],
  );

  const ingredientById = useMemo(
    () =>
      new Map(
        initialIngredients.map((i: { id: string; name: string; stockUnit: string }) => [i.id, i]),
      ),
    [initialIngredients],
  );

  const { data: result, isLoading } = useQuery({
    queryKey: ["scm-transfer", transferId],
    queryFn: () => getMutasiTransfer({ data: { transferId } }),
    initialData: initial ?? undefined,
  });

  usePageTitle(
    result?.transfer ? `Mutasi ${result.transfer.code}` : "Mutasi",
    "Surat Jalan antar cabang",
  );

  if (isLoading && !result) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </RoleGuard>
    );
  }

  if (!result || !user) {
    return (
      <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
        <div className="p-6 text-muted-foreground">Mutasi tidak ditemukan</div>
      </RoleGuard>
    );
  }

  const { transfer, items, invoice, auditLog } = result;
  const isSenderBa = user.role === "branch_admin" && user.branchId === transfer.fromBranchId;
  const isReceiverBa = user.role === "branch_admin" && user.branchId === transfer.toBranchId;
  const isAm = user.role === "area_manager";
  const amInJurisdiction =
    isAm && user.assignedBranches
      ? canAmAct({ assignedBranches: user.assignedBranches }, transfer)
      : false;

  const fromName = branchById.get(transfer.fromBranchId)?.name ?? transfer.fromBranchId.slice(0, 8);
  const toName = branchById.get(transfer.toBranchId)?.name ?? transfer.toBranchId.slice(0, 8);

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 -mb-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                to: "/scm-transfers",
                search: (prev) => ({
                  ...prev,
                  status: undefined,
                  search: undefined,
                  page: prev.page,
                  sortKey: prev.sortKey,
                  sortDir: prev.sortDir,
                }),
              })
            }
            className="gap-1.5 -ml-2 h-8 px-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
          <Badge
            variant={badgeVariant(lookupLabel(statusColors, transfer.status))}
            className="shrink-0 rounded-full px-3 py-1 text-xs"
          >
            {lookupLabel(statusLabels, transfer.status) ?? transfer.status}
          </Badge>
        </div>

        <div className="rounded-xl border bg-card p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium tracking-widest uppercase text-muted-foreground">
                <Hash className="h-3 w-3" />
                Kode Mutasi
              </div>
              <div className="font-mono text-base sm:text-lg font-semibold tracking-tight truncate">
                {transfer.code}
              </div>
            </div>
            <div className="hidden sm:block text-right shrink-0">
              <div className="text-xs text-muted-foreground">Dibuat</div>
              <div className="text-xs font-medium tabular-nums">
                {new Date(transfer.createdAt).toLocaleString("id-ID", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs rounded-lg bg-muted/40 px-2.5 py-2 sm:gap-2 sm:py-2.5">
            <span className="flex items-center gap-1 font-medium truncate">
              <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
              {fromName}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex items-center gap-1 font-medium truncate">
              <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
              {toName}
            </span>
          </div>
          <div className="sm:hidden mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            <CalendarDays className="h-3 w-3" />
            {new Date(transfer.createdAt).toLocaleString("id-ID")}
          </div>
        </div>

        <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <ScmStepper
            steps={TRANSFER_STEPS}
            currentKey={transfer.status}
            offRampKeys={["Rejected", "Cancelled"]}
            offRampAttach={{ Rejected: 1 }}
            ariaLabel="Mutasi lifecycle progress"
            offRampMessage={{
              Rejected: "Mutasi ini ditolak oleh Area Manager.",
              Cancelled: "Mutasi ini dibatalkan.",
            }}
          />
        </div>

        <DispatchView
          transfer={transfer}
          items={items}
          invoice={invoice}
          auditLog={auditLog ?? []}
          branchById={branchById}
          ingredientById={ingredientById}
          isSenderBa={isSenderBa}
          isReceiverBa={isReceiverBa}
          isAm={isAm}
          amInJurisdiction={amInJurisdiction}
          onBack={() =>
            navigate({
              to: "/scm-transfers",
              search: (prev) => ({
                ...prev,
                status: undefined,
                search: undefined,
                page: prev.page,
                sortKey: prev.sortKey,
                sortDir: prev.sortDir,
              }),
            })
          }
        />
      </div>
    </RoleGuard>
  );
}

function DispatchView(props: TransferViewProps) {
  const { transfer, isSenderBa, isReceiverBa, isAm } = props;
  const status = transfer.status;
  // Per-unit prices are the HPP snapshot — branch admins on either side
  // must not see them. Invoice totals stay visible (transaction amounts).
  const showPrices = !isSenderBa && !isReceiverBa;

  if (status === "SuratJalanDraft") {
    if (isSenderBa) return <DraftSenderForm {...props} showPrices={showPrices} />;
  }
  if (status === "PendingAMReview") {
    if (isAm) return <PendingAmReview {...props} showPrices={showPrices} />;
    if (isSenderBa) return <PendingSenderWaiting {...props} showPrices={showPrices} />;
  }
  if (status === "Approved") {
    if (isSenderBa) return <ApprovedSenderShip {...props} showPrices={showPrices} />;
  }
  if (status === "InTransit") {
    if (isReceiverBa) return <InTransitReceiverTracking {...props} showPrices={showPrices} />;
  }
  if (status === "Delivered") {
    if (isReceiverBa) return <DeliveredReceiverForm {...props} showPrices={showPrices} />;
  }
  if (status === "ReviewingSJ") {
    if (isReceiverBa) return <ReviewingReceiverInteractive {...props} showPrices={showPrices} />;
  }
  if (status === "WaitingForPayment") {
    return <WaitingInvoice {...props} showPrices={showPrices} />;
  }
  if (status === "Rejected") return <RejectedView {...props} showPrices={showPrices} />;
  if (status === "Cancelled") return <CancelledView {...props} showPrices={showPrices} />;
  if (status === "Finished") return <FinishedView {...props} showPrices={showPrices} />;

  // Fallback (should not happen)
  return <FinishedView {...props} showPrices={showPrices} />;
}
