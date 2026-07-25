import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Modal from "#/components/ui/Modal";
import { AlertCircle } from "lucide-react";
import { cleanSlateInventory } from "#/lib/server/inventory";

interface CleanSlateModalProps {
  open: boolean;
  onClose: () => void;
  branchId: string;
  branchName: string;
}

export default function CleanSlateModal({
  open,
  onClose,
  branchId,
  branchName,
}: CleanSlateModalProps) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAll = !branchId;

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: cleanSlateInventory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Gagal menghapus stok"),
  });

  function handleConfirm() {
    if (!confirmed) return;
    void mutation.mutateAsync({ data: { branchId: branchId || null } });
  }

  return (
    <Modal open={open} onClose={onClose} title="Clean Slate Inventori" size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Tindakan ini akan <strong>menghapus seluruh baris inventori</strong>{" "}
            {isAll ? <strong>di SEMUA cabang</strong> : `di cabang ${branchName}`}. Baris dihapus
            secara permanen (bukan di-set ke 0). <code>stockLedger</code> tetap tersimpan sebagai
            audit dan <code>averageCost</code> bahan tidak berubah.
          </span>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 mt-0.5 cursor-pointer"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Saya mengerti dan yakin ingin menghapus semua stok
            {isAll ? " di semua cabang" : ` di ${branchName}`}.
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border text-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!confirmed || mutation.isPending}
            className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
          >
            {mutation.isPending ? "Menghapus..." : "Hapus Semua Stok"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
