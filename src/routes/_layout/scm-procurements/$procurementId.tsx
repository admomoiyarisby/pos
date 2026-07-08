import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
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
import { ScmStepper } from "#/components/scm/Stepper";
import {
  DraftForm,
  PendingBaView,
  PendingCaView,
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

const PROCUREMENT_STEPS = [
  { key: "Draft", label: "Draft" },
  { key: "Pending", label: "Menunggu Review" },
  { key: "UnderReview", label: "Review" },
  { key: "InTransit", label: "Dalam Pengiriman" },
  { key: "Delivered", label: "Sudah Dikirim" },
  { key: "ReviewingSJ", label: "Review Cabang" },
  { key: "WaitingForPayment", label: "Pembayaran" },
  { key: "Finished", label: "Lunas" },
];

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

  // usePageTitle must be called on every render (Rules of Hooks).
  // It was previously called after the early returns below, so the
  // loading/error/empty renders called 5 hooks and the loaded
  // render called 6, triggering 'Rendered more hooks than during
  // the previous render.' The fallback title 'Pengadaan' shows on
  // the loading skeleton; the real code arrives once procurementQ
  // resolves.
  usePageTitle(
    procurementQ.data ? (procurementQ.data.code as string) : "Pengadaan",
    procurementQ.data
      ? `Pengadaan ke cabang • dibuat ${new Date(procurementQ.data.createdAt as unknown as string | Date).toLocaleString("id-ID")}`
      : undefined,
  );

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
        <div className="flex items-center justify-between gap-2">
          <Link to="/scm-procurements" search={() => ({ status: undefined })}>
            <Button variant="ghost" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <Badge variant={statusColors[proc.status as ScmProcurementStatus]}>
            {statusLabels[proc.status as ScmProcurementStatus]}
          </Badge>
        </div>

        <ScmStepper
          steps={PROCUREMENT_STEPS}
          currentKey={proc.status as string}
          offRampKeys={["Rejected", "Cancelled"]}
          offRampAttach={{ Rejected: 2 }}
          ariaLabel="Procurement lifecycle progress"
          offRampMessage={{
            Rejected: "Pengadaan ini ditolak saat review.",
            Cancelled: "Pengadaan ini dibatalkan.",
          }}
        />

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

  // ID15: Only CA roles see prices
  const viewProps = { ...props, showPrices: isCA };

  if (status === "Draft") {
    if (isBA) return <DraftForm {...viewProps} />;
  }
  if (status === "Pending") {
    if (isBA) return <PendingBaView {...viewProps} />;
    // The CA's review queue lives on the list page
    // (/scm-procurements?status=Pending). This detail view shows a
    // single 'Buka Review' action for when a CA lands here from a
    // deep link or the sidebar badge. (ADR 0004 §2)
    if (isCA) return <PendingCaView {...viewProps} />;
  }
  if (status === "UnderReview") {
    if (isCA) return <UnderReviewCaReview {...viewProps} />;
    if (isBA) return <UnderReviewBaLive {...viewProps} />;
  }
  if (status === "Rejected") return <RejectedView {...viewProps} />;
  if (status === "InTransit") {
    if (isCA) return <InTransitCaDetail {...viewProps} />;
    if (isBA) return <InTransitBaTracking {...viewProps} />;
  }
  if (status === "Delivered") {
    if (isBA) return <DeliveredBaForm {...viewProps} />;
    if (isCA) return <DeliveredCaWaiting {...viewProps} />;
  }
  if (status === "ReviewingSJ") {
    if (isBA) return <ReviewingSjBaInteractive {...viewProps} />;
    if (isCA) return <ReviewingSjCaLive {...viewProps} />;
  }
  if (status === "WaitingForPayment") {
    if (isCA) return <WaitingForPaymentCaInvoice {...viewProps} />;
    if (isBA) return <WaitingForPaymentBaInvoice {...viewProps} />;
  }
  if (status === "Finished") return <FinishedView {...viewProps} />;
  if (status === "Cancelled") return <CancelledView {...viewProps} />;

  return <FinishedView {...viewProps} />;
}
