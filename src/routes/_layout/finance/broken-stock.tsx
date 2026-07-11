import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_layout/finance/broken-stock")({
  component: RedirectPage,
});

function RedirectPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to finance page with barang-rusak tab
    void navigate({ to: "/finance", search: { tab: "barang-rusak" } });
  }, [navigate]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground">Mengalihkan ke Keuangan...</p>
    </div>
  );
}
