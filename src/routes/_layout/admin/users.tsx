import { createFileRoute } from "@tanstack/react-router";
import { lookupLabel } from "#/lib/label-lookup";
import { badgeVariant, formText } from "#/lib/utils";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Checkbox } from "#/components/ui/checkbox";
import { getUsers, createUser, updateUser } from "#/lib/server/users";
import { getBranches } from "#/lib/server/branches";
import {
  ChevronDown,
  ChevronRight,
  Shield,
  Building2,
  ChefHat,
  Map,
  Store,
  Users,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

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

interface BranchRow {
  id: string;
  code: string;
  name: string;
  location: string;
  type: "Central" | "Outlet";
  active: boolean;
}

type StaffItem =
  | { type: "user"; user: UserRow }
  | { type: "branch"; branch: BranchRow; staff: UserRow[] };

interface StaffGroupData {
  id: string;
  label: string;
  icon: typeof Shield;
  count: number;
  items: StaffItem[];
}

// =============================================================================
// Route
// =============================================================================

export const Route = createFileRoute("/_layout/admin/users")({
  component: StaffPage,
  loader: async () => {
    const users = await getUsers({ data: {} });
    const branches = await getBranches({ data: {} });
    return { users, branches };
  },
});

// =============================================================================
// Helpers
// =============================================================================

const roleLabels = {
  super_admin: "Super Admin",
  admin_pusat: "Admin Pusat",
  area_manager: "Area Manager",
  branch_admin: "Branch Admin",
  central_kitchen: "Central Kitchen",
} satisfies Record<string, string>;

const roleColors = {
  super_admin: "destructive",
  admin_pusat: "default",
  area_manager: "secondary",
  branch_admin: "outline",
  central_kitchen: "secondary",
} satisfies Record<string, string>;

function buildGroupedStaff(users: UserRow[], branches: BranchRow[]): StaffGroupData[] {
  const groups: StaffGroupData[] = [];

  // 1. Superadmin
  const superadmins = users.filter((u) => u.role === "super_admin");
  if (superadmins.length > 0) {
    groups.push({
      id: "superadmin",
      label: "Superadmin",
      icon: Shield,
      count: superadmins.length,
      items: superadmins.map((u) => ({ type: "user" as const, user: u })),
    });
  }

  // 2. Admin Pusat
  const adminPusat = users.filter((u) => u.role === "admin_pusat");
  if (adminPusat.length > 0) {
    groups.push({
      id: "admin-pusat",
      label: "Admin Pusat",
      icon: Building2,
      count: adminPusat.length,
      items: adminPusat.map((u) => ({ type: "user" as const, user: u })),
    });
  }

  // 3. Central Kitchen
  const centralKitchen = users.filter((u) => u.role === "central_kitchen");
  if (centralKitchen.length > 0) {
    groups.push({
      id: "central-kitchen",
      label: "Central Kitchen",
      icon: ChefHat,
      count: centralKitchen.length,
      items: centralKitchen.map((u) => ({ type: "user" as const, user: u })),
    });
  }

  // 4. Area Managers and their branches
  const areaManagers = users.filter((u) => u.role === "area_manager");
  const managedBranchIds = new Set<string>();

  for (const am of areaManagers) {
    const assignedBranches = am.assignedBranches || [];
    const branchItems: StaffItem[] = [];

    // Add the AM themselves
    branchItems.push({ type: "user", user: am });

    // Add branches under this AM
    for (const branchId of assignedBranches) {
      managedBranchIds.add(branchId);
      const branch = branches.find((b) => b.id === branchId);
      if (branch) {
        const branchStaff = users.filter(
          (u) => u.role === "branch_admin" && u.branchId === branchId,
        );
        branchItems.push({ type: "branch", branch, staff: branchStaff });
      }
    }

    const totalCount = branchItems.reduce((sum, item) => {
      if (item.type === "user") return sum + 1;
      return sum + 1 + item.staff.length;
    }, 0);

    groups.push({
      id: `am-${am.id}`,
      label: `Area Manager: ${am.name}`,
      icon: Map,
      count: totalCount,
      items: branchItems,
    });
  }

  // 5. Unmanaged branches (not assigned to any AM)
  const unmanagedBranches = branches.filter(
    (b) => !managedBranchIds.has(b.id) && b.type === "Outlet",
  );

  if (unmanagedBranches.length > 0) {
    const unmanagedItems: StaffItem[] = [];
    for (const branch of unmanagedBranches) {
      const branchStaff = users.filter(
        (u) => u.role === "branch_admin" && u.branchId === branch.id,
      );
      unmanagedItems.push({ type: "branch", branch, staff: branchStaff });
    }

    const totalCount = unmanagedItems.reduce((sum, item) => {
      if (item.type === "branch") return sum + 1 + item.staff.length;
      return sum + 1;
    }, 0);

    groups.push({
      id: "unmanaged",
      label: "Cabang Tidak Terkelola",
      icon: Store,
      count: totalCount,
      items: unmanagedItems,
    });
  }

  return groups;
}

// =============================================================================
// Components
// =============================================================================

function StaffGroup({
  group,
  defaultOpen = true,
  onEditUser,
}: {
  group: StaffGroupData;
  defaultOpen?: boolean;
  onEditUser: (user: UserRow) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = group.icon;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{group.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {group.count}
        </Badge>
      </button>

      {open && (
        <div className="divide-y">
          {group.items.map((item) => {
            if (item.type === "user") {
              return (
                <StaffRow
                  key={item.user.id}
                  user={item.user}
                  onEdit={() => onEditUser(item.user)}
                />
              );
            }

            // Branch group (type === "branch")
            const branchItem = item;
            return (
              <BranchSubGroup
                key={branchItem.branch.id}
                branch={branchItem.branch}
                staff={branchItem.staff}
                onEditUser={onEditUser}
                defaultOpen={true}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BranchSubGroup({
  branch,
  staff,
  onEditUser,
  defaultOpen = true,
}: {
  branch: BranchRow;
  staff: UserRow[];
  onEditUser: (user: UserRow) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-background">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-2 pl-10 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Store className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{branch.name}</span>
        </div>
        <Badge variant="outline" className="text-xs">
          {staff.length}
        </Badge>
      </button>

      {open && (
        <div className="divide-y">
          {staff.length === 0 ? (
            <div className="px-4 py-2 pl-16 text-sm text-muted-foreground">Belum ada staf</div>
          ) : (
            staff.map((user) => (
              <StaffRow key={user.id} user={user} onEdit={() => onEditUser(user)} indent />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StaffRow({
  user,
  onEdit,
  indent = false,
}: {
  user: UserRow;
  onEdit: () => void;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors ${
        indent ? "pl-16" : "pl-10"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant={badgeVariant(lookupLabel(roleColors, user.role))}
          className="text-xs hidden sm:inline-flex"
        >
          {lookupLabel(roleLabels, user.role) ?? user.role}
        </Badge>
        {user.status === "Active" ? (
          <Badge variant="success" className="text-xs">
            Aktif
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Nonaktif
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function StaffModal({
  user,
  branches,
  open,
  onClose,
  onSave,
  isLoading,
  error,
}: {
  user: UserRow | null;
  branches: BranchRow[];
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  isLoading: boolean;
  error?: string;
}) {
  const isEdit = !!user;
  const [selectedRole, setSelectedRole] = useState(user?.role ?? "branch_admin");
  const [amBranches, setAmBranches] = useState<string[]>(user?.assignedBranches ?? []);
  const [generatedPassword, setGeneratedPassword] = useState("");

  const generatePassword = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const toggleAmBranch = (branchId: string) => {
    setAmBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    );
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: any = {
      name: formText(fd, "name"),
      email: formText(fd, "email"),
      role: formText(fd, "role"),
      status: formText(fd, "status"),
    };

    if (!isEdit) {
      data.password = formText(fd, "password");
    } else {
      const password = formText(fd, "password");
      if (password) data.password = password;
    }

    // Branch fields based on role
    if (selectedRole === "branch_admin" || selectedRole === "central_kitchen") {
      data.branchId = formText(fd, "branchId") || undefined;
    }

    if (selectedRole === "area_manager") {
      data.assignedBranches = amBranches;
    }

    if (isEdit) {
      data.id = user.id;
    }

    onSave(data);
  };

  const showBranchField = selectedRole === "branch_admin" || selectedRole === "central_kitchen";
  const showAmBranches = selectedRole === "area_manager";

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Staf" : "Tambah Staf"} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              defaultValue={user?.name ?? ""}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              name="email"
              type="email"
              defaultValue={user?.email ?? ""}
              required
              disabled={isEdit}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Password</label>
          {isEdit ? (
            <input
              name="password"
              type="password"
              minLength={8}
              placeholder="Kosongkan jika tidak diubah"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          ) : (
            <div className="flex gap-2">
              <input
                name="password"
                type="text"
                required
                minLength={8}
                value={generatedPassword}
                onChange={(e) => setGeneratedPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setGeneratedPassword(generatePassword())}
              >
                Generate
              </Button>
            </div>
          )}
          {!isEdit && (
            <p className="text-xs text-muted-foreground">
              Klik "Generate" untuk membuat password acak, atau masukkan password manual.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <select
              name="role"
              defaultValue={user?.role ?? "branch_admin"}
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
            <label className="text-sm font-medium">Status</label>
            <select
              name="status"
              defaultValue={user?.status ?? "Active"}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Active">Aktif</option>
              <option value="Inactive">Nonaktif</option>
            </select>
          </div>
        </div>

        {/* Branch field for branch_admin and central_kitchen */}
        {showBranchField && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Cabang</label>
            <select
              name="branchId"
              defaultValue={user?.branchId ?? ""}
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
        )}

        {/* Area Manager branch assignment */}
        {showAmBranches && (
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

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Menyimpan..." : isEdit ? "Simpan" : "Tambah"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// Page
// =============================================================================

function StaffPage() {
  const { users: initialUsers, branches } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [mutationError, setMutationError] = useState("");

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => getUsers({ data: {} }),
    initialData: initialUsers,
  });

  const groupedStaff = useMemo(() => buildGroupedStaff(users, branches), [users, branches]);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Staf baru ditambahkan");
      setModalOpen(false);
      setEditing(null);
      setMutationError("");
    },
    onError: (err) => {
      setMutationError(err.message);
      toast.error(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Data staf diperbarui");
      setModalOpen(false);
      setEditing(null);
      setMutationError("");
    },
    onError: (err) => {
      setMutationError(err.message);
      toast.error(err.message);
    },
  });

  const handleSave = (data: any) => {
    setMutationError("");
    if (editing) {
      void updateMutation.mutateAsync({ data: { ...data, id: editing.id } });
    } else {
      void createMutation.mutateAsync({ data });
    }
  };

  const handleOpenCreate = () => {
    setEditing(null);
    setMutationError("");
    setModalOpen(true);
  };

  const handleEditUser = (user: UserRow) => {
    setEditing(user);
    setMutationError("");
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditing(null);
    setMutationError("");
  };

  usePageTitle("Manajemen Staf", "Kelola staf sistem dan role");

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <PageHeader
        action={{
          label: "Tambah Staf",
          onClick: handleOpenCreate,
        }}
      />

      <div className="space-y-4">
        {groupedStaff.map((group) => (
          <StaffGroup key={group.id} group={group} onEditUser={handleEditUser} />
        ))}
      </div>

      {groupedStaff.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Belum ada staf terdaftar</p>
        </div>
      )}

      <StaffModal
        user={editing}
        branches={branches}
        open={modalOpen}
        onClose={handleCloseModal}
        onSave={handleSave}
        isLoading={createMutation.isPending || updateMutation.isPending}
        error={mutationError}
      />
    </RoleGuard>
  );
}
