import { createFileRoute, Link } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import RoleGuard from "#/components/RoleGuard";
import {
  Truck,
  RefreshCw,
  FileText,
  ArrowRightLeft,
  ShoppingCart,
  ClipboardList,
  ScrollText,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_layout/docs/")({
  component: DocsIndexPage,
});

interface DocLink {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  step?: number;
}

const flowDocs: DocLink[] = [
  {
    title: "Barang Masuk dari Supplier",
    description: "Cara mencatat penerimaan barang dari supplier ke Gudang Pusat",
    href: "/docs/barang-masuk",
    icon: Truck,
    step: 1,
  },
  {
    title: "Produksi Internal (Yield)",
    description: "Cara mengubah bahan mentah menjadi bahan setengah jadi",
    href: "/docs/produksi-internal",
    icon: RefreshCw,
    step: 2,
  },
  {
    title: "Pengadaan (Central → Cabang)",
    description: "Cara mendistribusikan stok dari Gudang Pusat ke cabang",
    href: "/docs/pengadaan",
    icon: FileText,
    step: 3,
  },
  {
    title: "Mutasi Stok (Antar Cabang)",
    description: "Cara transfer stok antar cabang",
    href: "/docs/mutasi-stok",
    icon: ArrowRightLeft,
    step: 4,
  },
  {
    title: "Resep dan POS",
    description: "Cara resep muncul di kasir dan stok otomatis berkurang",
    href: "/docs/resep-dan-pos",
    icon: ShoppingCart,
    step: 5,
  },
];

const referenceDocs: DocLink[] = [
  {
    title: "Stock Opname",
    description: "Cara melakukan penghitungan stok fisik",
    href: "/docs/stok-opname",
    icon: ClipboardList,
  },
  {
    title: "Kartu Stok",
    description: "Cara membaca riwayat pergerakan stok",
    href: "/docs/kartu-stok",
    icon: ScrollText,
  },
];

function DocCard({ doc }: { doc: DocLink }) {
  const Icon = doc.icon;
  return (
    <Link
      to={doc.href}
      className="group flex items-start gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {doc.step !== undefined && (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {doc.step}.
            </span>
          )}
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
            {doc.title}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
    </Link>
  );
}

function DocsIndexPage() {
  usePageTitle("Panduan Alur", "Dokumentasi alur kerja sistem Omoiyari POS");

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
      <div className="space-y-10">
        {/* Flow Documentation */}
        <section>
          <div className="mb-5">
            <h2 className="text-base font-semibold text-foreground">
              Alur: Dari Bahan Mentah Sampai Siap Jual
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Ikuti langkah 1–5 untuk memahami bagaimana bahan mentah dari supplier akhirnya menjadi
              produk siap jual di kasir.
            </p>
          </div>

          {/* Flow diagram — restrained, border-only */}
          <div className="mb-6 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Supplier</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">Gudang Pusat</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">Produksi</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">Cabang</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">POS</span>
            </div>
          </div>

          <div className="space-y-2">
            {flowDocs.map((doc) => (
              <DocCard key={doc.href} doc={doc} />
            ))}
          </div>
        </section>

        {/* Reference Documentation */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-5">Referensi Tambahan</h2>
          <div className="space-y-2">
            {referenceDocs.map((doc) => (
              <DocCard key={doc.href} doc={doc} />
            ))}
          </div>
        </section>
      </div>
    </RoleGuard>
  );
}
