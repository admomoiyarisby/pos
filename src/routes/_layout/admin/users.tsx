import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { getUsers, createUser, updateUser } from "#/lib/server/users";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { Eye, EyeOff, Trash2, Info } from "lucide-react";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "Active" | "Inactive";
  branchId: string | null;
  pin: string | null;
  branchName: string | null;
  assignedBranches?: string[];
}

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin_pusat: "Admin Pusat",
  area_manager: "Area Manager",
  branch_admin: "Branch Admin",
  central_kitchen: "Central Kitchen",
};

export const Route = createFileRoute("/_layout/admin/users")({
  component: UsersPage,
  loader: async () => {
    const users = await getUsers({ data: {} });
    const branches = await getBranches({ data: {} });
    return { users, branches };
  },
});

function UsersPage() {
  const { users: initialUsers, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [selectedRole, setSelectedRole] = useState("branch_admin");
  const [amBranches, setAmBranches] = useState<string[]>([]);
  const [mutationError, setMutationError] = useState("");
  const [deleteInfoTarget, setDeleteInfoTarget] = useState<string | null>(null);
  const [visiblePins, setVisiblePins] = useState<Set<string>>(new Set());

  const togglePin = useCallback((userId: string) => {
    setVisiblePins((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const toggleAmBranch = useCallback((branchId: string) => {
    setAmBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    );
  }, []);

  const columns: Column<UserRow>[] = [
    { key: "name", header: "Nama", sortable: true },
    { key: "email", header: "Email", sortable: true },
    {
      key: "role",
      header: "Role",
      sortable: true,
      render: (r) => <Badge variant="outline">{roleLabels[r.role] ?? r.role}</Badge>,
    },
    { key: "branchName", header: "Cabang", sortable: true, render: (r) => r.branchName ?? "-" },
    {
      key: "pin",
      header: "PIN",
      render: (r) =>
        r.role === "branch_admin" && r.pin ? (
          <span className="inline-flex items-center gap-1.5">
            <code className="text-sm font-mono tracking-widest">
              {visiblePins.has(r.id) ? r.pin : "••••"}
            </code>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePin(r.id);
              }}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              title={visiblePins.has(r.id) ? "Sembunyikan PIN" : "Tampilkan PIN"}
            >
              {visiblePins.has(r.id) ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (r) =>
        r.status === "Active" ? (
          <Badge variant="success">Aktif</Badge>
        ) : (
          <Badge variant="secondary">Nonaktif</Badge>
        ),
    },
  ];

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => getUsers({ data: {} }),
    initialData: initialUsers,
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => {
      setMutationError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => {
      setMutationError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      email: fd.get("email") as string,
      password: fd.get("password") as string,
      name: fd.get("name") as string,
      role: fd.get("role") as
        | "super_admin"
        | "admin_pusat"
        | "area_manager"
        | "branch_admin"
        | "central_kitchen",
      branchId: (fd.get("branchId") as string) || undefined,
      pin: (fd.get("pin") as string) || undefined,
      status: fd.get("status") as "Active" | "Inactive",
      assignedBranches: selectedRole === "area_manager" ? amBranches : undefined,
    };

    if (editing) {
      const updateData = {
        id: editing.id,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        pin: data.pin,
        status: data.status,
        assignedBranches: selectedRole === "area_manager" ? amBranches : [],
      };
      void updateMutation.mutateAsync({ data: updateData });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen Pengguna", "Kelola pengguna sistem dan PIN kasir");

  const handleCloseModal = () => {
    setModalOpen(false);
    setMutationError("");
    setAmBranches([]);
  };

  const handleOpenCreate = () => {
    setEditing(null);
    setSelectedRole("branch_admin");
    setAmBranches([]);
    setMutationError("");
    setModalOpen(true);
  };

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader
        action={{
          label: "Tambah User",
          onClick: handleOpenCreate,
        }}
      />

      <DataTable
        columns={[
          ...columns,
          {
            key: "actions",
            header: "",
            width: "w-12",
            render: (r) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteInfoTarget(r.name);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/40 cursor-not-allowed"
                title="Nonaktifkan melalui edit"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          },
        ]}
        data={users}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setSelectedRole(r.role);
          setAmBranches(r.role === "area_manager" ? (r.assignedBranches ?? []) : []);
          setMutationError("");
          setModalOpen(true);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={editing ? "Edit Pengguna" : "Tambah Pengguna"}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama</label>
              <input
                name="name"
                defaultValue={editing?.name ?? ""}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <input
                name="email"
                type="email"
                defaultValue={editing?.email ?? ""}
                required
                disabled={!!editing}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </div>
          </div>

          {!editing && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <input
                name="password"
                type="password"
                required={!editing}
                minLength={8}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                name="role"
                defaultValue={editing?.role ?? "branch_admin"}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="super_admin">Super Admin</option>
                <option value="admin_pusat">Admin Pusat</option>
                <option value="area_manager">Area Manager</option>
                <option value="branch_admin">Branch Admin</option>
                <option value="central_kitchen">Central Kitchen</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang</label>
              <select
                name="branchId"
                defaultValue={editing?.branchId ?? ""}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">-- Pilih Cabang --</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Area Manager: assign branches */}
          {selectedRole === "area_manager" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Cabang yang Dikelola</label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3 max-h-40 overflow-y-auto">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={amBranches.includes(b.id)}
                      onCheckedChange={() => toggleAmBranch(b.id)}
                    />
                    <span>{b.name}</span>
                  </label>
                ))}
              </div>
              {amBranches.length === 0 && (
                <p className="text-xs text-warning-foreground">
                  Area Manager harus memiliki minimal 1 cabang yang dikelola.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PIN field — only for branch_admin role */}
            {selectedRole === "branch_admin" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  PIN (4 digit) <span className="text-destructive">*</span>
                </label>
                <input
                  name="pin"
                  defaultValue={editing?.pin ?? ""}
                  required
                  minLength={4}
                  maxLength={4}
                  pattern="\d{4}"
                  inputMode="numeric"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono tracking-widest"
                  placeholder="1234"
                />
                <p className="text-[10px] text-muted-foreground">
                  PIN unik per cabang. Digunakan untuk login cepat di terminal kasir.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select
                name="status"
                defaultValue={editing?.status ?? "Active"}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Active">Aktif</option>
                <option value="Inactive">Nonaktif</option>
              </select>
            </div>
          </div>

          {/* Mutation error */}
          {mutationError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {mutationError}
            </div>
          )}

          {/* If role is branch_admin and no branch selected, show warning */}
          {selectedRole === "branch_admin" && !editing?.branchId && (
            <p className="text-xs text-warning-foreground">
              Branch Admin harus memiliki cabang. Pilih cabang sebelum menyimpan.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
            >
              {editing ? "Simpan" : "Tambah"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Info modal for delete-not-available */}
      <Modal
        open={!!deleteInfoTarget}
        onClose={() => setDeleteInfoTarget(null)}
        title="Nonaktifkan via Edit"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Nonaktifkan pengguna melalui edit.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Pengguna "{deleteInfoTarget}" tidak dapat dihapus karena data mereka tertaut ke
                riwayat pesanan dan aktivitas sistem. Untuk menonaktifkan akses, ubah status menjadi
                "Nonaktif" melalui menu Edit.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteInfoTarget(null)}>
              Tutup
            </Button>
          </div>
        </div>
      </Modal>
    </RoleGuard>
  );
}
