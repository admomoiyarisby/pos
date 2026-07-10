import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import {
  getSupplierDeliveries,
  createSupplierDelivery,
  updateSupplierDelivery,
  deleteSupplierDelivery,
  getSuppliers,
} from "#/lib/server/supplier-deliveries";
import { getIngredients } from "#/lib/server/ingredients";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Printer, Pencil, Trash2 } from "lucide-react";

interface DeliveryRow {
  id: string;
  supplierId: string | null;
  supplierName: string;
  ingredientId: string;
  ingredientName: string | null;
  ingredientStockUnit: string | null;
  quantity: number;
  price: number;
  deliveryDate: Date;
  receivedBy: string;
  receivedByName: string | null;
  status: "Pending Invoice" | "Completed";
  createdAt: Date;
}

const statusColors: Record<
  string,
  "default" | "warning" | "success" | "destructive" | "secondary"
> = {
  "Pending Invoice": "warning",
  Completed: "success",
};

export const Route = createFileRoute("/_layout/supplier-deliveries/")({
  component: SupplierDeliveriesPage,
  loader: async () => {
    const deliveries = await getSupplierDeliveries();
    const ingredients = await getIngredients({ data: { excludeNasi: true } });
    const suppliersList = await getSuppliers();
    return { deliveries, ingredients, suppliersList };
  },
});

function SupplierDeliveriesPage() {
  const { user } = useAuth();
  const { deliveries: initial, ingredients, suppliersList } = Route.useLoaderData();
  const queryClient = useQueryClient();

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Delete confirm state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const canWrite = user?.role === "super_admin" || user?.role === "admin_pusat";

  const { data: deliveries } = useQuery({
    queryKey: ["supplier-deliveries"],
    queryFn: () => getSupplierDeliveries(),
    initialData: initial,
  });

  const createMutation = useMutation({
    mutationFn: createSupplierDelivery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["supplier-deliveries"] });
      setModalOpen(false);
      setEditId(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateSupplierDelivery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["supplier-deliveries"] });
      setModalOpen(false);
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplierDelivery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["supplier-deliveries"] });
      setDeleteConfirm(null);
    },
  });

  const openCreateModal = () => {
    setEditId(null);
    setModalOpen(true);
  };

  const openEditModal = (row: DeliveryRow) => {
    setEditId(row.id);
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const supplierName = fd.get("supplierName") as string;
    const ingredientId = fd.get("ingredientId") as string;
    const quantity = Number(fd.get("quantity"));
    const price = Number(fd.get("price"));

    if (!supplierName || !ingredientId || quantity <= 0 || price < 0) return;

    if (editId) {
      void updateMutation.mutateAsync({
        data: {
          id: editId,
          supplierName,
          ingredientId,
          quantity,
          price,
        },
      });
    } else {
      void createMutation.mutateAsync({
        data: { supplierName, ingredientId, quantity, price },
      });
    }
  };

  const handleDelete = (id: string) => {
    void deleteMutation.mutateAsync({ data: { id } });
  };

  const handlePrint = (row: DeliveryRow) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const dateStr = new Date(row.deliveryDate).toLocaleDateString("id-ID", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Invoice - ${row.supplierName}</title>
        <style>
          body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; color: #000; }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { font-size: 18px; margin: 0; text-transform: uppercase; }
          .header p { margin: 2px 0; }
          .info { margin-bottom: 16px; }
          .info table { width: 100%; }
          .info td { padding: 2px 4px; }
          table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          table.items th, table.items td { border: 1px solid #000; padding: 6px 8px; text-align: left; }
          table.items th { background: #eee; }
          table.items td.right { text-align: right; }
          .grand-total { text-align: right; font-size: 14px; font-weight: bold; margin-bottom: 30px; }
          .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
          .signatures div { text-align: center; width: 40%; }
          .signatures .line { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>INVOICE PENERIMAAN BARANG</h1>
          <p>Omoiyari POS — Central Warehouse</p>
        </div>
        <div class="info">
          <table>
            <tr><td><strong>No. Invoice</strong></td><td>SD-${row.id.slice(0, 8).toUpperCase()}</td></tr>
            <tr><td><strong>Tanggal</strong></td><td>${dateStr}</td></tr>
            <tr><td><strong>Supplier</strong></td><td>${row.supplierName}</td></tr>
            <tr><td><strong>Penerima</strong></td><td>${row.receivedByName ?? "-"}</td></tr>
            <tr><td><strong>Status</strong></td><td>${row.status}</td></tr>
          </table>
        </div>
        <table class="items">
          <thead>
            <tr>
              <th>Bahan Baku</th>
              <th class="right">Jumlah</th>
              <th class="right">Total Harga</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${row.ingredientName ?? "-"}</td>
              <td class="right">${row.quantity.toLocaleString()} ${row.ingredientStockUnit ?? "-"}</td>
              <td class="right">Rp ${row.price.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div class="grand-total">
          Grand Total: Rp ${row.price.toLocaleString()}
        </div>
        <div class="signatures">
          <div>
            <div>Penerima,</div>
            <div class="line">${row.receivedByName ?? "-"}</div>
          </div>
          <div>
            <div>Mengetahui,</div>
            <div class="line">Super Admin</div>
          </div>
        </div>
        <script>
          window.print();
          setTimeout(function() { window.close(); }, 500);
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const columns: Column<DeliveryRow>[] = [
    {
      key: "deliveryDate",
      header: "Tanggal",
      sortable: true,
      render: (r) => formatDate(r.deliveryDate),
    },
    { key: "supplierName", header: "Supplier", sortable: true },
    { key: "ingredientName", header: "Bahan Baku", sortable: true },
    {
      key: "quantity",
      header: "Jumlah",
      sortable: true,
      render: (r) => `${r.quantity.toLocaleString()} ${r.ingredientStockUnit ?? "-"}`,
    },
    {
      key: "price",
      header: "Total Harga",
      align: "right",
      sortable: true,
      render: (r) => `Rp ${r.price.toLocaleString()}`,
    },
    { key: "receivedByName", header: "Penerima", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) => <Badge variant={statusColors[r.status] ?? "default"}>{r.status}</Badge>,
    },
    {
      key: "id",
      header: "Aksi",
      width: "w-28",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrint(r);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
            title="Cetak Invoice"
          >
            <Printer className="h-4 w-4" />
          </button>
          {canWrite && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(r);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(r.id);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-destructive hover:bg-destructive/10"
                title="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  usePageTitle("Barang Masuk", "Pencatatan penerimaan barang dari supplier");

  // Find the delivery being edited (for populate form)
  const editingDelivery = editId ? deliveries.find((d) => d.id === editId) : null;

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "area_manager", "branch_admin"]}>
      {canWrite && (
        <PageHeader action={{ label: "Catat Barang Masuk", onClick: openCreateModal }} />
      )}

      <DataTable
        columns={columns}
        data={deliveries}
        keyExtractor={(r) => r.id}
        searchKeys={["supplierName", "ingredientName", "receivedByName"] as (keyof DeliveryRow)[]}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditId(null);
        }}
        title={editId ? "Edit Barang Masuk" : "Catat Barang Masuk"}
        size="lg"
      >
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {/* Supplier Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama Supplier</label>
            <input
              name="supplierName"
              list="supplier-list"
              required
              defaultValue={editingDelivery?.supplierName ?? ""}
              placeholder="Ketik nama supplier..."
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <datalist id="supplier-list">
              {suppliersList.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>

          {/* Ingredient */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Bahan Baku</label>
            <select
              name="ingredientId"
              required
              defaultValue={editingDelivery?.ingredientId ?? ""}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pilih bahan...</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.stockUnit})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Jumlah</label>
            <input
              name="quantity"
              type="number"
              min={1}
              required
              defaultValue={editingDelivery?.quantity ?? ""}
              placeholder="0"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          {/* Price */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Total Harga (Rp)</label>
            <input
              name="price"
              type="number"
              min={0}
              required
              defaultValue={editingDelivery?.price ?? ""}
              placeholder="0"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditId(null);
              }}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {editId ? "Simpan Perubahan" : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Hapus Barang Masuk"
        size="sm"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Apakah Anda yakin ingin menghapus penerimaan barang ini? Stok bahan baku akan dikurangi
          sesuai jumlah yang dicatat.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDeleteConfirm(null)}
            className="h-9 px-4 rounded-md border text-sm"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            disabled={deleteMutation.isPending}
            className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
          </button>
        </div>
      </Modal>
    </RoleGuard>
  );
}
