import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import {
  getProcurement,
  getProcurementItems,
  getProcurementInvoice,
} from "#/lib/server/scm-queries";
import type { ScmProcurementStatus } from "#/lib/server/scm-fsm";
import { Stepper } from "#/components/scm-procurements/Stepper";
import {
  DraftForm,
  PendingBaView,
  UnderReviewBaLive,
  UnderReviewCaReview,
  RejectedView,
  InTransitBaTracking,
  InTransitCaDetail,
  DeliveredBaForm,
  DeliveredCaWaiting,
  ReviewingSjBaInteractive,
  ReviewingSjCaLive,
  WaitingForPaymentBaInvoice,
  WaitingForPaymentCaInvoice,
  FinishedView,
  CancelledView,
  type StateViewProps,
} from "#/components/scm-procurements";

export const Route = createFileRoute("/_layout/scm-procurements/$procurementId")({
  component: ProcurementDetailPage,
});

const statusLabels: Record<ScmProcurementStatus, string> = {
  Draft: "Draft",
  Pending: "Menunggu Review",
  UnderReview: "Sedang Direview",
  Rejected: "Ditolak",
  InTransit: "Dalam Pengiriman",
  Delivered: "Sudah Dikirim",
  ReviewingSJ: "Sedang Direview Cabang",
  WaitingForPayment: "Menunggu Pembayaran",
  Finished: "Lunas",
  Cancelled: "Dibatalkan",
};

const statusColors: Record<
  ScmProcurementStatus,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  Draft: "secondary",
  Pending: "warning",
  UnderReview: "default",
  Rejected: "destructive",
  InTransit: "default",
  Delivered: "default",
  ReviewingSJ: "default",
  WaitingForPayment: "warning",
  Finished: "success",
  Cancelled: "secondary",
};

function ProcurementDetailPage() {
  const { procurementId } = Route.useParams();
  const { user } = useAuth();

  const procurementQ = useQuery({
    queryKey: ["scm-procurement", procurementId],
    queryFn: () => getProcurement({ data: { id: procurementId } }),
  });

  const itemsQ = useQuery({
    queryKey: ["scm-procurement-items", procurementId],
    queryFn: () => getProcurementItems({ data: { procurementId } }),
    enabled: !!procurementQ.data,
  });

  const invoiceQ = useQuery({
    queryKey: ["scm-procurement-invoice", procurementId],
    queryFn: () => getProcurementInvoice({ data: { procurementId } }),
    enabled: !!procurementQ.data,
    retry: false,
  });

  if (procurementQ.isLoading) {
    return (
      <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
        <div className="space-y-4 p-4 md:p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </RoleGuard>
    );
  }
  if (procurementQ.error) {
    return (
      <div className="p-6 text-destructive">
        Gagal memuat pengadaan: {(procurementQ.error as Error).message}
      </div>
    );
  }
  if (!procurementQ.data || !user) {
    return <div className="p-6">Procurement tidak ditemukan</div>;
  }

  const proc = procurementQ.data;
  const items = (itemsQ.data ?? []) as Array<Record<string, unknown>>;
  const invoice = (invoiceQ.data ?? null) as Record<string, unknown> | null;

  return (
    <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{proc.code as string}</h1>
            <p className="text-sm text-muted-foreground">
              Pengadaan ke cabang • dibuat{" "}
              {new Date(proc.createdAt as unknown as string | Date).toLocaleString("id-ID")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusColors[proc.status as ScmProcurementStatus]}>
              {statusLabels[proc.status as ScmProcurementStatus]}
            </Badge>
            <Link to="/scm-procurements" search={() => ({ status: undefined })}>
              <Button variant="ghost">
                <ArrowLeft className="h-4 w-4" />
                Kembali
              </Button>
            </Link>
          </div>
        </div>

        <Stepper currentStatus={proc.status as ScmProcurementStatus} />

        <DispatchView
          status={proc.status as ScmProcurementStatus}
          actorRole={user.role}
          procurement={proc as unknown as Record<string, unknown>}
          items={items}
          invoice={invoice}
        />
      </div>
    </RoleGuard>
  );
}

interface DispatchViewProps extends StateViewProps {
  status: ScmProcurementStatus;
  actorRole: string;
}

function DispatchView(props: DispatchViewProps) {
  const { status, actorRole } = props;

  const isCA = actorRole === "admin_pusat" || actorRole === "super_admin";
  const isBA = actorRole === "branch_admin" || actorRole === "super_admin";

  if (status === "Draft") {
    if (isBA) return <DraftForm {...props} />;
  }
  if (status === "Pending") {
    if (isBA) return <PendingBaView {...props} />;
    // PendingCaQueue removed: the queue is now a status filter on the
    // list page (/scm-procurements?status=Pending). CA's empty-state
    // in the detail view shows the current procurement read-only.
    if (isCA) return <UnderReviewBaLive {...props} />;
  }
  if (status === "UnderReview") {
    if (isCA) return <UnderReviewCaReview {...props} />;
    if (isBA) return <UnderReviewBaLive {...props} />;
  }
  if (status === "Rejected") return <RejectedView {...props} />;
  if (status === "InTransit") {
    if (isCA) return <InTransitCaDetail {...props} />;
    if (isBA) return <InTransitBaTracking {...props} />;
  }
  if (status === "Delivered") {
    if (isBA) return <DeliveredBaForm {...props} />;
    if (isCA) return <DeliveredCaWaiting {...props} />;
  }
  if (status === "ReviewingSJ") {
    if (isBA) return <ReviewingSjBaInteractive {...props} />;
    if (isCA) return <ReviewingSjCaLive {...props} />;
  }
  if (status === "WaitingForPayment") {
    if (isCA) return <WaitingForPaymentCaInvoice {...props} />;
    if (isBA) return <WaitingForPaymentBaInvoice {...props} />;
  }
  if (status === "Finished") return <FinishedView {...props} />;
  if (status === "Cancelled") return <CancelledView {...props} />;

  return <FinishedView {...props} />;
}
