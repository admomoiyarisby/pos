import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
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

const statusLabels: Record<string, string> = {
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
};

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
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
};

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
        <div className="space-y-4 p-4 md:p-6">
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

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              navigate({ to: "/scm-transfers", search: { status: undefined, search: undefined } })
            }
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
          <Badge
            variant={
              (statusColors[transfer.status] ?? "default") as
                | "default"
                | "success"
                | "warning"
                | "destructive"
                | "secondary"
            }
          >
            {statusLabels[transfer.status] ?? transfer.status}
          </Badge>
        </div>

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

        <DispatchView
          transfer={transfer as unknown as Record<string, unknown>}
          items={items as unknown as Array<Record<string, unknown>>}
          invoice={invoice as unknown as Record<string, unknown> | null}
          auditLog={(auditLog ?? []) as unknown as Array<Record<string, unknown>>}
          branchById={branchById}
          ingredientById={ingredientById}
          isSenderBa={isSenderBa}
          isReceiverBa={isReceiverBa}
          isAm={isAm}
          amInJurisdiction={amInJurisdiction}
          onBack={() =>
            navigate({ to: "/scm-transfers", search: { status: undefined, search: undefined } })
          }
        />
      </div>
    </RoleGuard>
  );
}

function DispatchView(props: TransferViewProps & { transfer: Record<string, unknown> }) {
  const { transfer, isSenderBa, isReceiverBa, isAm } = props;
  const status = transfer.status as string;

  if (status === "SuratJalanDraft") {
    if (isSenderBa) return <DraftSenderForm {...props} />;
  }
  if (status === "PendingAMReview") {
    if (isAm) return <PendingAmReview {...props} />;
    if (isSenderBa) return <PendingSenderWaiting {...props} />;
  }
  if (status === "Approved") {
    if (isSenderBa) return <ApprovedSenderShip {...props} />;
  }
  if (status === "InTransit") {
    if (isReceiverBa) return <InTransitReceiverTracking {...props} />;
  }
  if (status === "Delivered") {
    if (isReceiverBa) return <DeliveredReceiverForm {...props} />;
  }
  if (status === "ReviewingSJ") {
    if (isReceiverBa) return <ReviewingReceiverInteractive {...props} />;
  }
  if (status === "WaitingForPayment") {
    return <WaitingInvoice {...props} />;
  }
  if (status === "Rejected") return <RejectedView {...props} />;
  if (status === "Cancelled") return <CancelledView {...props} />;
  if (status === "Finished") return <FinishedView {...props} />;

  // Fallback (should not happen)
  return <FinishedView {...props} />;
}
