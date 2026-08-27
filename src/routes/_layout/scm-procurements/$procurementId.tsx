import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import { ArrowLeft, Building2, User, CalendarDays, Hash } from "lucide-react";
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

const statusLabels = {
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
} satisfies Record<ScmProcurementStatus, string>;

const statusColors = {
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
} satisfies Record<
  ScmProcurementStatus,
  "default" | "warning" | "success" | "destructive" | "secondary"
>;

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
    procurementQ.data ? procurementQ.data.code : "Pengadaan",
    procurementQ.data
      ? `Pengadaan ke cabang • dibuat ${new Date(procurementQ.data.createdAt).toLocaleString("id-ID")}`
      : undefined,
  );

  if (procurementQ.isLoading) {
    return (
      <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
        <div className="space-y-4">
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
        Gagal memuat pengadaan:{" "}
        {procurementQ.error instanceof Error
          ? procurementQ.error.message
          : String(procurementQ.error)}
      </div>
    );
  }
  if (!procurementQ.data || !user) {
    return <div className="p-6">Procurement tidak ditemukan</div>;
  }

  const proc = procurementQ.data;
  const items = itemsQ.data ?? [];
  const invoice = invoiceQ.data ?? null;

  return (
    <RoleGuard allowedRoles={["branch_admin", "admin_pusat", "super_admin", "area_manager"]}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 -mb-1">
          <Link
            to="/scm-procurements"
            search={(prev) => ({
              ...prev,
              status: undefined,
              search: undefined,
              page: prev.page,
              sortKey: prev.sortKey,
              sortDir: prev.sortDir,
            })}
          >
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <Badge
            variant={statusColors[proc.status]}
            className="shrink-0 rounded-full px-3 py-1 text-xs"
          >
            {statusLabels[proc.status]}
          </Badge>
        </div>

        {/* Header: code + meta — stacked on mobile */}
        <div className="rounded-xl border bg-card p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium tracking-widest uppercase text-muted-foreground">
                <Hash className="h-3 w-3" />
                Kode Pengadaan
              </div>
              <div className="font-mono text-base sm:text-lg font-semibold tracking-tight truncate">
                {proc.code}
              </div>
            </div>
            <div className="hidden sm:block text-right shrink-0">
              <div className="text-xs text-muted-foreground">Dibuat</div>
              <div className="text-xs font-medium tabular-nums">
                {new Date(proc.createdAt).toLocaleString("id-ID", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3 text-xs">
            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                <Building2 className="h-3 w-3" />
                Cabang
              </div>
              <div className="font-medium truncate mt-0.5">{proc.branchName ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                <User className="h-3 w-3" />
                Pemohon
              </div>
              <div className="font-medium truncate mt-0.5">{proc.requestedByName ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[11px] tracking-widest uppercase text-muted-foreground font-medium">
                <CalendarDays className="h-3 w-3" />
                Sumber
              </div>
              <div className="font-medium truncate mt-0.5">{proc.requestSource ?? "System"}</div>
            </div>
          </div>
          <div className="sm:hidden mt-2 text-[11px] text-muted-foreground tabular-nums">
            Dibuat {new Date(proc.createdAt).toLocaleString("id-ID")}
          </div>
        </div>

        <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <ScmStepper
            steps={PROCUREMENT_STEPS}
            currentKey={proc.status}
            offRampKeys={["Rejected", "Cancelled"]}
            offRampAttach={{ Rejected: 2 }}
            ariaLabel="Procurement lifecycle progress"
            offRampMessage={{
              Rejected: "Pengadaan ini ditolak saat review.",
              Cancelled: "Pengadaan ini dibatalkan.",
            }}
          />
        </div>

        <DispatchView
          status={proc.status}
          actorRole={user.role}
          procurement={proc}
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

  const isBA = actorRole === "branch_admin";
  const isCA = actorRole === "admin_pusat" || actorRole === "super_admin";

  // ID15: Only branch_admin hides prices; admin_pusat, super_admin, area_manager see them
  const viewProps = { ...props, showPrices: !isBA };

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
