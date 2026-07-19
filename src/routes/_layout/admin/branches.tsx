import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import Modal from "#/components/ui/Modal";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "#/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "#/components/ui/tabs";
import { getBranches, createBranch, updateBranch, deleteBranch } from "#/lib/server/branches";
import { getBranchUsers, createUser, updateUser } from "#/lib/server/users";
import {
  Store,
  MapPin,
  Users,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  UserPlus,
  Phone,
} from "lucide-react";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  location: string;
  type: "Central" | "Outlet";
  active: boolean;
  isOnline: boolean;
  pin: string | null;
  phone: string | null;
  complaintPhone: string | null;
}

interface BranchUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "Active" | "Inactive";
}

export const Route = createFileRoute("/_layout/admin/branches")({
  component: BranchesPage,
  loader: async () => {
    const branches = await getBranches({ data: {} });
    return { branches };
  },
});

function BranchCard({
  branch,
  staffCount,
  onClick,
}: {
  branch: BranchRow;
  staffCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-6 text-left shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-card-foreground group-hover:text-primary transition-colors">
              {branch.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono">{branch.code}</p>
          </div>
        </div>
        <Badge variant={branch.type === "Central" ? "default" : "secondary"}>{branch.type}</Badge>
      </div>

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{branch.location}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{staffCount} staf</span>
        </div>
        {branch.active ? (
          <Badge variant="success" className="text-xs">
            Aktif
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Nonaktif
          </Badge>
        )}
      </div>
    </button>
  );
}

function BranchSheet({
  branch,
  open,
  onClose,
}: {
  branch: BranchRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [showPin, setShowPin] = useState(false);
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [deleteStaffTarget, setDeleteStaffTarget] = useState<BranchUser | null>(null);
  const [reactivateStaffTarget, setReactivateStaffTarget] = useState<BranchUser | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [deleteBranchOpen, setDeleteBranchOpen] = useState(false);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const { data: branchUsers = [] } = useQuery({
    queryKey: ["branch-users", branch?.id],
    queryFn: () => getBranchUsers({ data: { branchId: branch!.id } }),
    enabled: !!branch,
  });

  const updateMutation = useMutation({
    mutationFn: updateBranch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Info cabang disimpan");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const addStaffMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branch-users", branch?.id] });
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Staf berhasil ditambahkan");
      setAddStaffOpen(false);
      setGeneratedPassword("");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deactivateStaffMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branch-users", branch?.id] });
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Staf dinonaktifkan");
      setDeleteStaffTarget(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const reactivateStaffMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branch-users", branch?.id] });
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Staf diaktifkan kembali");
      setReactivateStaffTarget(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteBranchMutation = useMutation({
    mutationFn: deleteBranch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      setDeleteBranchOpen(false);
      onClose();
      toast.success("Cabang berhasil dinonaktifkan");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  if (!branch) return null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      id: branch.id,
      code: fd.get("code") as string,
      name: fd.get("name") as string,
      location: fd.get("location") as string,
      type: fd.get("type") as "Central" | "Outlet",
      pin: (fd.get("pin") as string) || undefined,
      phone: (fd.get("phone") as string) || undefined,
      complaintPhone: (fd.get("complaintPhone") as string) || undefined,
    };
    void updateMutation.mutateAsync({ data });
  };

  const handleAddStaff = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const email = fd.get("email") as string;
    const password = fd.get("password") as string;

    void addStaffMutation.mutateAsync({
      data: {
        name,
        email,
        password,
        role: "branch_admin",
        branchId: branch.id,
      },
    });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent className="w-full sm:max-w-[480px]">
          <SheetHeader className="mb-6">
            <SheetTitle>Detail Cabang</SheetTitle>
            <SheetDescription>
              {branch.name} ({branch.code})
            </SheetDescription>
          </SheetHeader>

          <div className="overflow-y-auto max-h-[calc(100vh-120px)] pr-2">
            <Tabs defaultValue="info">
              <TabsList className="w-full">
                <TabsTrigger value="info" className="flex-1">
                  <Store className="h-4 w-4 mr-1.5" />
                  Info Dasar
                </TabsTrigger>
                <TabsTrigger value="contact" className="flex-1">
                  <Phone className="h-4 w-4 mr-1.5" />
                  Kontak & PIN
                </TabsTrigger>
                <TabsTrigger value="staff" className="flex-1">
                  <Users className="h-4 w-4 mr-1.5" />
                  Staf
                </TabsTrigger>
              </TabsList>

              {/* Info Dasar Tab */}
              <TabsContent value="info">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Kode</label>
                    <input
                      name="code"
                      defaultValue={branch.code}
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nama</label>
                    <input
                      name="name"
                      defaultValue={branch.name}
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Lokasi</label>
                    <input
                      name="location"
                      defaultValue={branch.location}
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tipe</label>
                    <select
                      name="type"
                      defaultValue={branch.type}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="Central">Central</option>
                      <option value="Outlet">Outlet</option>
                    </select>
                  </div>

                  {updateMutation.isError && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {updateMutation.error.message}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Menyimpan..." : "Simpan Info Dasar"}
                  </Button>
                </form>

                <div className="border-t pt-4 mt-6">
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    onClick={() => setDeleteBranchOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Nonaktifkan Cabang
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Menonaktifkan akan menghapus cabang dari daftar aktif
                  </p>
                </div>
              </TabsContent>

              {/* Kontak & PIN Tab */}
              <TabsContent value="contact">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">PIN Cabang</label>
                    <div className="relative">
                      <input
                        name="pin"
                        type={showPin ? "text" : "password"}
                        defaultValue={branch.pin ?? ""}
                        maxLength={4}
                        pattern="\d{4}"
                        inputMode="numeric"
                        placeholder="4 digit"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm font-mono tracking-widest"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PIN bersama untuk semua staf di cabang ini. Harus unik secara global.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Telepon</label>
                    <input
                      name="phone"
                      defaultValue={branch.phone ?? ""}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Telepon Aduan</label>
                    <input
                      name="complaintPhone"
                      defaultValue={branch.complaintPhone ?? ""}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Nomor telepon untuk pelaporan keluhan pelanggan
                    </p>
                  </div>

                  {updateMutation.isError && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {updateMutation.error.message}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Menyimpan..." : "Simpan Kontak & PIN"}
                  </Button>
                </form>
              </TabsContent>

              {/* Staf Tab */}
              <TabsContent value="staff">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Staf Cabang</h3>
                      <p className="text-sm text-muted-foreground">
                        {branchUsers.filter((u) => u.status === "Active").length} staf aktif
                        {branchUsers.some((u) => u.status === "Inactive") &&
                          ` · ${branchUsers.filter((u) => u.status === "Inactive").length} nonaktif`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAddStaffOpen(true)}
                    >
                      <UserPlus className="h-4 w-4 mr-1.5" />
                      Tambah Staf
                    </Button>
                  </div>

                  {branchUsers.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                      <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Belum ada staf terdaftar</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Klik "Tambah Staf" untuk menambahkan staf baru
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Active Staff */}
                      {branchUsers
                        .filter((u) => u.status === "Active")
                        .map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{user.name}</p>
                                <p className="text-xs text-muted-foreground">{user.email}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDeleteStaffTarget(user)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Nonaktifkan staf"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}

                      {/* Inactive Staff */}
                      {branchUsers.some((u) => u.status === "Inactive") && (
                        <>
                          <div className="flex items-center gap-2 pt-2">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-xs text-muted-foreground">Staf Nonaktif</span>
                            <div className="h-px flex-1 bg-border" />
                          </div>
                          {branchUsers
                            .filter((u) => u.status === "Inactive")
                            .map((user) => (
                              <div
                                key={user.id}
                                className="flex items-center justify-between rounded-lg border border-dashed p-3 opacity-60"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-medium">
                                    {user.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-muted-foreground">
                                      {user.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{user.email}</p>
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setReactivateStaffTarget(user)}
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                >
                                  Aktifkan
                                </Button>
                              </div>
                            ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Staff Modal */}
      <Modal
        open={addStaffOpen}
        onClose={() => {
          setAddStaffOpen(false);
          setGeneratedPassword("");
        }}
        title="Tambah Staf"
      >
        <form onSubmit={handleAddStaff} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              required
              placeholder="Nama lengkap"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              name="email"
              type="email"
              required
              placeholder="nama@omoiyari.net"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
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
            <p className="text-xs text-muted-foreground">
              Klik "Generate" untuk membuat password acak, atau masukkan password manual.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Staf akan dibuat dengan role Branch Admin di cabang {branch.name}.
          </p>

          {addStaffMutation.isError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {addStaffMutation.error.message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddStaffOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={addStaffMutation.isPending}>
              {addStaffMutation.isPending ? "Menambahkan..." : "Tambah"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Deactivate Staff Confirmation Modal */}
      <Modal
        open={!!deleteStaffTarget}
        onClose={() => setDeleteStaffTarget(null)}
        title="Nonaktifkan Staf"
        size="sm"
      >
        {deleteStaffTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Nonaktifkan staf "{deleteStaffTarget.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Staf yang dinonaktifkan tidak akan bisa login. Anda dapat mengaktifkannya kembali
                  nanti.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteStaffTarget(null)}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  void deactivateStaffMutation.mutateAsync({
                    data: { id: deleteStaffTarget.id, status: "Inactive" },
                  })
                }
                disabled={deactivateStaffMutation.isPending}
              >
                {deactivateStaffMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reactivate Staff Confirmation Modal */}
      <Modal
        open={!!reactivateStaffTarget}
        onClose={() => setReactivateStaffTarget(null)}
        title="Aktifkan Staf"
        size="sm"
      >
        {reactivateStaffTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <UserPlus className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Aktifkan kembali staf "{reactivateStaffTarget.name}"?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Staf akan dapat login kembali dan muncul di daftar staf aktif cabang ini.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReactivateStaffTarget(null)}
              >
                Batal
              </Button>
              <Button
                onClick={() =>
                  void reactivateStaffMutation.mutateAsync({
                    data: { id: reactivateStaffTarget.id, status: "Active" },
                  })
                }
                disabled={reactivateStaffMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {reactivateStaffMutation.isPending ? "Mengaktifkan..." : "Aktifkan"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Branch Confirmation Modal */}
      <Modal
        open={deleteBranchOpen}
        onClose={() => setDeleteBranchOpen(false)}
        title="Nonaktifkan Cabang"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Nonaktifkan cabang "{branch.name}"?</p>
              <p className="text-sm text-muted-foreground mt-1">
                Cabang yang dinonaktifkan tidak akan muncul di daftar aktif. Staf cabang tidak akan
                bisa login. Tindakan ini dapat dibalik dengan mengaktifkan kembali.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteBranchOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteBranchMutation.mutateAsync({ data: { id: branch.id } })}
              disabled={deleteBranchMutation.isPending}
            >
              {deleteBranchMutation.isPending ? "Menonaktifkan..." : "Nonaktifkan"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function BranchesPage() {
  const { branches: initial } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchRow | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ data: {} }),
    initialData: initial,
  });

  const { data: allBranchUsers = [] } = useQuery({
    queryKey: ["branch-users-all"],
    queryFn: async () => {
      const results = await Promise.all(
        branches.map((b) => getBranchUsers({ data: { branchId: b.id } })),
      );
      return results;
    },
    enabled: branches.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: createBranch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Cabang baru ditambahkan");
      setCreateModalOpen(false);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void createMutation.mutateAsync({
      data: {
        code: fd.get("code") as string,
        name: fd.get("name") as string,
        location: fd.get("location") as string,
        type: fd.get("type") as "Central" | "Outlet",
      },
    });
  };

  usePageTitle("Manajemen Cabang", "Kelola cabang dan gudang pusat");

  const getStaffCount = (branchId: string) => {
    const index = branches.findIndex((b) => b.id === branchId);
    return index >= 0 && allBranchUsers[index] ? allBranchUsers[index].length : 0;
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader
        action={{
          label: "Tambah Cabang",
          onClick: () => setCreateModalOpen(true),
        }}
      />

      {/* Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            staffCount={getStaffCount(branch.id)}
            onClick={() => setSelectedBranch(branch)}
          />
        ))}
      </div>

      {branches.length === 0 && (
        <div className="text-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted mx-auto mb-4">
            <Store className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">Belum ada cabang</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Tambahkan cabang pertama untuk memulai
          </p>
          <Button onClick={() => setCreateModalOpen(true)}>Tambah Cabang</Button>
        </div>
      )}

      {/* Branch Detail Sheet */}
      <BranchSheet
        branch={selectedBranch}
        open={!!selectedBranch}
        onClose={() => setSelectedBranch(null)}
      />

      {/* Create Branch Modal */}
      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Tambah Cabang">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Kode</label>
            <input
              name="code"
              required
              placeholder="WYG"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nama</label>
            <input
              name="name"
              required
              placeholder="Wiyung"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Lokasi</label>
            <input
              name="location"
              required
              placeholder="Jl. Raya Wiyung No. 123"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipe</label>
            <select
              name="type"
              defaultValue="Outlet"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Central">Central</option>
              <option value="Outlet">Outlet</option>
            </select>
          </div>

          {createMutation.isError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {createMutation.error.message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Membuat..." : "Tambah"}
            </Button>
          </div>
        </form>
      </Modal>
    </RoleGuard>
  );
}
