import { Check } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ScmProcurementStatus } from "#/lib/server/scm-fsm";

/**
 * Stepper — 7-step monochrome progress bar for a procurement's lifecycle.
 *
 * Renders the canonical happy-path steps (Draft → Pending → Review →
 * InTransit → Delivered → ReviewSJ → Payment → Finished) with the current
 * step highlighted, completed steps checked, and rejected/cancelled shown
 * as a labelled off-ramp from the step at which the transition occurred.
 *
 * Display-only by design: clicking a step does not navigate. It's an
 * orientation affordance, not a control.
 */
const HAPPY_PATH: { key: ScmProcurementStatus; label: string }[] = [
  { key: "Draft", label: "Draft" },
  { key: "Pending", label: "Menunggu Review" },
  { key: "UnderReview", label: "Review" },
  { key: "InTransit", label: "Dalam Pengiriman" },
  { key: "Delivered", label: "Sudah Dikirim" },
  { key: "ReviewingSJ", label: "Review Cabang" },
  { key: "WaitingForPayment", label: "Pembayaran" },
  { key: "Finished", label: "Lunas" },
];

interface StepperProps {
  currentStatus: ScmProcurementStatus;
}

function indexOfStatus(s: ScmProcurementStatus): number {
  return HAPPY_PATH.findIndex((step) => step.key === s);
}

export function Stepper({ currentStatus }: StepperProps) {
  const isOffRamp = currentStatus === "Rejected" || currentStatus === "Cancelled";
  const currentIndex = isOffRamp ? -1 : indexOfStatus(currentStatus);

  // The off-ramp attaches to the step at which the procurement diverged
  // (Rejected is reached from UnderReview; Cancelled is reachable from
  // any pre-Finished step — show it at the current "would-be" position).
  const offRampIndex = currentStatus === "Rejected" ? 2 : currentIndex >= 0 ? currentIndex : 0;

  return (
    <nav
      aria-label="Procurement lifecycle progress"
      className="rounded-md border bg-background p-4"
    >
      <ol className="flex items-center gap-2 overflow-x-auto">
        {HAPPY_PATH.map((step, idx) => {
          const isCompleted = !isOffRamp && idx < currentIndex;
          const isCurrent = !isOffRamp && idx === currentIndex;
          const isOffRampStep = isOffRamp && idx === offRampIndex;

          return (
            <li
              key={step.key}
              className={cn(
                "flex shrink-0 items-center gap-2",
                idx < HAPPY_PATH.length - 1 && "flex-1",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    isCompleted && "border-primary bg-primary text-primary-foreground",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    !isCompleted &&
                      !isCurrent &&
                      "border-border bg-background text-muted-foreground",
                    isOffRampStep &&
                      "border-destructive bg-destructive text-destructive-foreground",
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? <Check className="h-3 w-3" /> : idx + 1}
                </div>
                <span
                  className={cn(
                    "whitespace-nowrap text-xs",
                    (isCompleted || isCurrent) && "font-medium text-foreground",
                    !isCompleted && !isCurrent && !isOffRampStep && "text-muted-foreground",
                    isOffRampStep && "font-medium text-destructive",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {idx < HAPPY_PATH.length - 1 ? (
                <div
                  className={cn(
                    "h-px flex-1",
                    isCompleted ? "bg-primary" : "bg-border",
                    isOffRampStep && "bg-destructive",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {isOffRamp ? (
        <p className="mt-3 text-xs text-destructive">
          {currentStatus === "Rejected"
            ? "Pengadaan ini ditolak saat review."
            : "Pengadaan ini dibatalkan."}
        </p>
      ) : null}
    </nav>
  );
}
