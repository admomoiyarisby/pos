import { Check } from "lucide-react";
import { cn } from "#/lib/utils";

/**
 * ScmStepper — generic monochrome progress bar for SCM lifecycles.
 *
 * Renders a happy-path sequence of steps with the current step highlighted,
 * completed steps checked, and terminal off-ramp states (Rejected, Cancelled)
 * shown as a labeled divergence from the step at which they occurred.
 *
 * Display-only: clicking a step does not navigate.
 */

export interface StepperStep {
  key: string;
  label: string;
}

interface ScmStepperProps {
  /** Ordered steps in the happy path (excludes terminal off-ramps). */
  steps: StepperStep[];
  /** The current status key (may be a happy-path step or an off-ramp). */
  currentKey: string;
  /** Keys that are terminal off-ramps (not part of the happy path). */
  offRampKeys?: string[];
  /** Where each off-ramp visually attaches. Defaults to 0 if not specified. */
  offRampAttach?: Record<string, number>;
  /** Accessible label for the nav element. */
  ariaLabel?: string;
  /** Message shown below the stepper when in an off-ramp state. */
  offRampMessage?: Record<string, string>;
}

export function ScmStepper({
  steps,
  currentKey,
  offRampKeys = [],
  offRampAttach = {},
  ariaLabel = "Lifecycle progress",
  offRampMessage = {},
}: ScmStepperProps) {
  const isOffRamp = offRampKeys.includes(currentKey);
  const happyIndex = steps.findIndex((s) => s.key === currentKey);
  const currentIndex = isOffRamp ? -1 : happyIndex;

  const offRampIndex = isOffRamp ? (offRampAttach[currentKey] ?? 0) : -1;

  return (
    <nav
      aria-label={ariaLabel}
      className="rounded-xl sm:rounded-md border bg-background p-3 sm:p-4 shadow-xs"
    >
      <ol className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory -mx-1 px-1 sm:mx-0 sm:px-0">
        {steps.map((step, idx) => {
          const isCompleted = !isOffRamp && idx < currentIndex;
          const isCurrent = !isOffRamp && idx === currentIndex;
          const isOffRampStep = isOffRamp && idx === offRampIndex;

          return (
            <li
              key={step.key}
              className={cn("flex shrink-0 items-center gap-2", idx < steps.length - 1 && "flex-1")}
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
              {idx < steps.length - 1 ? (
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
      {isOffRamp && offRampMessage[currentKey] ? (
        <p className="mt-3 text-xs text-destructive">{offRampMessage[currentKey]}</p>
      ) : null}
    </nav>
  );
}
