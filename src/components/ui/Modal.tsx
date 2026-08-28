import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "#/lib/utils.ts";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
}

const sizeClasses = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
} satisfies Record<string, string>;

/**
 * Modal — accessible dialog backed by Radix Dialog primitive.
 *
 * Provides focus trapping, Escape-to-close, ARIA attributes, and
 * animated enter/exit transitions for every modal in the app.
 *
 * API is intentionally identical to the old custom Modal so all
 * callers work without changes.
 */
export default function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[60] bg-black/50",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 m-auto z-[60] h-fit w-[calc(100%-2rem)] max-h-[min(92vh,48rem)] sm:max-w-[32rem]",
            "translate-x-0 translate-y-0",
            "rounded-t-2xl sm:rounded-lg border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 shadow-lg",
            "overflow-y-auto overscroll-contain",
            "duration-200 outline-none",
            "data-[state=closed]:sm:zoom-out-95 data-[state=open]:sm:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            sizeClasses[size],
          )}
        >
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex items-center justify-between border-b bg-card/95 px-4 py-3 backdrop-blur-sm sm:static sm:mx-0 sm:mt-0 sm:border-0 sm:bg-transparent sm:p-0">
            <DialogPrimitive.Title className="text-base font-semibold sm:text-lg">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            <DialogPrimitive.Close className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 sm:rounded-md">
              <X className="h-5 w-5" />
              <span className="sr-only">Tutup</span>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
