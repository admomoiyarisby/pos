import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { updateMyProfile, updateMyPin, updateMyPassword } from "#/lib/server/users";
import { Eye, EyeOff, User, Key, Lock } from "lucide-react";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin_pusat: "Admin Pusat",
  area_manager: "Area Manager",
  branch_admin: "Branch Admin",
  central_kitchen: "Central Kitchen",
};

export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();

  usePageTitle("Pengaturan Akun", "Kelola informasi akun Anda");

  if (!user) return null;

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "central_kitchen", "area_manager"]}>
      <div className="max-w-2xl space-y-8">
        {/* Profile Section */}
        <ProfileSection user={user} />

        {/* PIN Section */}
        <PinSection user={user} />

        {/* Password Section */}
        <PasswordSection />
      </div>
    </RoleGuard>
  );
}

function ProfileSection({
  user,
}: {
  user: { id: string; name: string; email: string; role: string };
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);

  const mutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: () => {
      toast.success("Profil berhasil diperbarui");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void mutation.mutateAsync({ data: { name, email } });
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <User className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">Profil</h2>
          <p className="text-sm text-muted-foreground">Kelola informasi profil Anda</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Nama</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <div>
            <Badge variant="outline">{roleLabels[user.role] ?? user.role}</Badge>
          </div>
        </div>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Menyimpan..." : "Simpan Profil"}
        </Button>
      </form>
    </div>
  );
}

function PinSection({ user }: { user: { id: string; pin?: string | null } }) {
  const [newPin, setNewPin] = useState("");
  const [showCurrentPin, setShowCurrentPin] = useState(false);

  const mutation = useMutation({
    mutationFn: updateMyPin,
    onSuccess: () => {
      toast.success("PIN berhasil diperbarui");
      setNewPin("");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void mutation.mutateAsync({ data: { pin: newPin } });
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Key className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">PIN Login</h2>
          <p className="text-sm text-muted-foreground">Kelola PIN untuk login cepat</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">PIN Saat Ini</label>
          <div className="relative">
            <input
              type={showCurrentPin ? "text" : "password"}
              value={user.pin ?? "Belum diatur"}
              disabled
              className="h-9 w-full rounded-md border border-input bg-muted px-3 pr-10 text-sm font-mono tracking-widest"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPin(!showCurrentPin)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showCurrentPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">PIN Baru</label>
          <input
            type="text"
            value={newPin}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 4);
              setNewPin(val);
            }}
            maxLength={4}
            pattern="\d{4}"
            inputMode="numeric"
            placeholder="4 digit"
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono tracking-widest"
          />
          <p className="text-xs text-muted-foreground">
            PIN harus 4 digit. Tidak boleh sama dengan PIN cabang atau PIN staf lain.
          </p>
        </div>

        <Button type="submit" disabled={mutation.isPending || newPin.length !== 4}>
          {mutation.isPending ? "Menyimpan..." : "Simpan PIN"}
        </Button>
      </form>
    </div>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mutation = useMutation({
    mutationFn: updateMyPassword,
    onSuccess: () => {
      toast.success("Password berhasil diperbarui");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Konfirmasi password tidak cocok");
      return;
    }

    void mutation.mutateAsync({
      data: { currentPassword, newPassword },
    });
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">Ubah Password</h2>
          <p className="text-sm text-muted-foreground">Perbarui password akun Anda</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Password Saat Ini</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Password Baru</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">Minimal 8 karakter</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Konfirmasi Password Baru</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Mengubah..." : "Ubah Password"}
        </Button>
      </form>
    </div>
  );
}
