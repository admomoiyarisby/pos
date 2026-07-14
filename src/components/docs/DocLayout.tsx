import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import RoleGuard from "#/components/RoleGuard";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { LucideIcon } from "lucide-react";

interface DocLayoutProps {
  title: string;
  description: string;
  step?: number;
  totalSteps?: number;
  icon: LucideIcon;
  children: string; // Now accepts markdown string
}

export function DocLayout({
  title,
  description,
  step,
  totalSteps,
  icon: Icon,
  children,
}: DocLayoutProps) {
  return (
    <RoleGuard
      allowedRoles={[
        "super_admin",
        "admin_pusat",
        "area_manager",
        "branch_admin",
        "central_kitchen",
      ]}
    >
      <div className="space-y-8">
        <Link
          to="/docs"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Panduan
        </Link>

        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {step !== undefined && totalSteps !== undefined
                ? `Langkah ${step} dari ${totalSteps}`
                : description}
            </p>
          </div>
        </div>

        <MarkdownRenderer content={children} />
      </div>
    </RoleGuard>
  );
}
