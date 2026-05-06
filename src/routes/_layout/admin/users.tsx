import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import Modal from "#/components/ui/Modal";
import { getUsers, createUser, updateUser } from "#/lib/server/users";
import { getBranches } from "#/lib/server/branches";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";

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

const columns: Column<UserRow>[] = [
  { key: "name", header: "Nama" },
  { key: "email", header: "Email" },
  {
    key: "role",
    header: "Role",
    render: (r) => <Badge variant="outline">{roleLabels[r.role] ?? r.role}</Badge>,
  },
  { key: "branchName", header: "Cabang", render: (r) => r.branchName ?? "-" },
  {
    key: "pin",
    header: "PIN",
    render: (r) =>
      r.role === "branch_admin" && r.pin ? (
        <code className="text-sm font-mono tracking-widest">{r.pin}</code>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) =>
      r.status === "Active" ? (
        <Badge variant="success">Aktif</Badge>
      ) : (
        <Badge variant="secondary">Nonaktif</Badge>
      ),
  },
];

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
  const [mutationError, setMutationError] = useState("");

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
    };

    if (editing) {
      const updateData = {
        id: editing.id,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        pin: data.pin,
        status: data.status,
      };
      void updateMutation.mutateAsync({ data: updateData });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };
  usePageTitle("Manajemen User", "Kelola pengguna sistem dan PIN kasir");

  const handleCloseModal = () => {
    setModalOpen(false);
    setMutationError("");
  };

  const handleOpenCreate = () => {
    setEditing(null);
    setSelectedRole("branch_admin");
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
        columns={columns}
        data={users}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => {
          setEditing(r);
          setSelectedRole(r.role);
          setMutationError("");
          setModalOpen(true);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={editing ? "Edit User" : "Tambah User"}
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
            <p className="text-xs text-amber-600">
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
    </RoleGuard>
  );
}
