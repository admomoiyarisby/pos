import { createFileRoute, useRouter, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useAuth } from "#/lib/auth-context";
import PinPad from "#/components/PinPad";
import { Store, Loader2, Smartphone, Mail, ChevronLeft, Building2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

// Demo users for quick access (email mode only)
const demoUsers = [
  { name: "Super Admin", email: "superadmin@omoiyari.net", role: "super_admin", pin: "1111" },
  { name: "Admin Pusat", email: "pusat@omoiyari.net", role: "admin_pusat", pin: "2222" },
  { name: "Area Mgr East Java", email: "manager.east@omoiyari.net", role: "area_manager", pin: "3333" },
  { name: "Andi (Wiyung)", email: "andi.wiyung@omoiyari.net", role: "branch_admin", pin: "1234" },
  { name: "Budi (Darmo Permai)", email: "budi.darmo@omoiyari.net", role: "branch_admin", pin: "2345" },
  { name: "Citra (Tenggilis)", email: "citra.tenggilis@omoiyari.net", role: "branch_admin", pin: "3456" },
  { name: "Dewi (Mulyorejo)", email: "dewi.mulyorejo@omoiyari.net", role: "branch_admin", pin: "4567" },
  { name: "Eko (Jambangan)", email: "eko.jambangan@omoiyari.net", role: "branch_admin", pin: "5678" },
  { name: "Fitri (Pucang)", email: "fitri.pucang@omoiyari.net", role: "branch_admin", pin: "6789" },
  { name: "Gilang (Siwalankerto)", email: "gilang.siwalankerto@omoiyari.net", role: "branch_admin", pin: "7890" },
  { name: "Central Kitchen", email: "ck@omoiyari.net", role: "central_kitchen", pin: "0000" },
];

type BranchPinStep = "branch-select" | "pin-entry" | "name-picker";

function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<"email" | "pin">("pin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Branch PIN login state
  const [branchPinStep, setBranchPinStep] = useState<BranchPinStep>("branch-select");
  const [selectedBranchCode, setSelectedBranchCode] = useState("");
  const [branchPin, setBranchPin] = useState("");
  const [branchPinError, setBranchPinError] = useState("");
  const [branchPinLoading, setBranchPinLoading] = useState(false);
  const [branchInfo, setBranchInfo] = useState<{ id: string; code: string; name: string } | null>(null);
  const [staffNames, setStaffNames] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffName, setSelectedStaffName] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Demo branches for quick access
  const demoBranches = [
    { code: "WYG", name: "Wiyung" },
    { code: "DRM", name: "Darmo Permai" },
    { code: "TGL", name: "Tenggilis" },
    { code: "MLY", name: "Mulyorejo" },
    { code: "JMB", name: "Jambangan" },
    { code: "PCG", name: "Pucang" },
    { code: "SWL", name: "Siwalankerto" },
  ];

  // Redirect if already authenticated
  if (user) {
    return <Navigate to="/" />;
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Login gagal");
      } else {
        void router.invalidate();
      }
    } catch (e) {
      console.error("Email login error:", e);
      setError("Terjadi kesalahan saat login");
    } finally {
      setLoading(false);
    }
  };

  const handleBranchPinSubmit = async (enteredPin: string) => {
    setBranchPinError("");
    setBranchPinLoading(true);

    try {
      const res = await fetch("/api/auth/branch-pin-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCode: selectedBranchCode, pin: enteredPin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setBranchPinError(data.message || "PIN tidak valid");
        setBranchPin("");
      } else {
        // PIN verified, show name picker
        setBranchInfo(data.branch);
        setStaffNames(data.staffNames);
        setBranchPinStep("name-picker");
      }
    } catch (e) {
      console.error("Branch PIN verify error:", e);
      setBranchPinError("Terjadi kesalahan saat verifikasi PIN");
      setBranchPin("");
    } finally {
      setBranchPinLoading(false);
    }
  };

  const handleStaffLogin = async () => {
    if (!branchInfo || !selectedStaffName) return;

    setLoginLoading(true);
    setBranchPinError("");

    try {
      const res = await fetch("/api/auth/branch-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branchInfo.id,
          staffName: selectedStaffName,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setBranchPinError(data.message || "Login gagal");
      } else {
        // Login successful, redirect
        void router.invalidate();
      }
    } catch (e) {
      console.error("Branch login error:", e);
      setBranchPinError("Terjadi kesalahan saat login");
    } finally {
      setLoginLoading(false);
    }
  };

  const resetBranchLogin = () => {
    setBranchPinStep("branch-select");
    setSelectedBranchCode("");
    setBranchPin("");
    setBranchPinError("");
    setBranchInfo(null);
    setStaffNames([]);
    setSelectedStaffName("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 md:p-8 shadow-sm">
        {/* Logo & Title */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Omoiyari POS</h1>
          <p className="text-sm text-muted-foreground">Masuk ke sistem manajemen POS & inventori</p>
        </div>

        {/* Mode Switcher */}
        <div className="flex bg-muted p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setMode("pin");
              setError("");
              resetBranchLogin();
            }}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              mode === "pin"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Smartphone className="h-4 w-4" />
            PIN Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("email");
              setError("");
              resetBranchLogin();
            }}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              mode === "email"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mail className="h-4 w-4" />
            Email Login
          </button>
        </div>

        {/* PIN Mode — Branch-based login */}
        {mode === "pin" && (
          <div className="space-y-4">
            {/* Step 1: Branch Selection */}
            {branchPinStep === "branch-select" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Pilih cabang Anda</p>
                <div className="grid grid-cols-2 gap-2">
                  {demoBranches.map((branch) => (
                    <button
                      key={branch.code}
                      type="button"
                      onClick={() => {
                        setSelectedBranchCode(branch.code);
                        setBranchPinStep("pin-entry");
                      }}
                      className="py-3 px-4 text-sm font-medium rounded-lg border hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-bold">{branch.code}</div>
                        <div className="text-xs text-muted-foreground">{branch.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: PIN Entry */}
            {branchPinStep === "pin-entry" && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={resetBranchLogin}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Kembali
                </button>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Masukkan PIN untuk cabang</p>
                  <p className="text-lg font-bold">{selectedBranchCode}</p>
                </div>
                {branchPinLoading && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memverifikasi PIN...
                  </div>
                )}
                <PinPad
                  value={branchPin}
                  onChange={setBranchPin}
                  onComplete={handleBranchPinSubmit}
                  disabled={branchPinLoading}
                />
                {branchPinError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center">
                    {branchPinError}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Name Picker */}
            {branchPinStep === "name-picker" && branchInfo && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setBranchPinStep("pin-entry");
                    setBranchPin("");
                    setBranchPinError("");
                    setBranchInfo(null);
                    setStaffNames([]);
                    setSelectedStaffName("");
                  }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Kembali
                </button>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Siapa yang sedang login?</p>
                  <p className="text-lg font-bold">{branchInfo.name} ({branchInfo.code})</p>
                </div>

                {staffNames.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    Belum ada staff terdaftar di cabang ini. Hubungi Admin Pusat.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {staffNames.map((staff) => (
                      <button
                        key={staff.id}
                        type="button"
                        onClick={() => setSelectedStaffName(staff.name)}
                        className={`py-3 px-4 text-sm font-medium rounded-lg border transition-colors ${
                          selectedStaffName === staff.name
                            ? "bg-primary text-primary-foreground border-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        {staff.name}
                      </button>
                    ))}
                  </div>
                )}

                {selectedStaffName && (
                  <button
                    type="button"
                    onClick={handleStaffLogin}
                    disabled={loginLoading}
                    className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {loginLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Memuat...
                      </>
                    ) : (
                      `Masuk sebagai ${selectedStaffName}`
                    )}
                  </button>
                )}

                {branchPinError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center">
                    {branchPinError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Email Mode */}
        {mode === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@omoiyari.net"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Memuat...
                </>
              ) : (
                "Masuk"
              )}
            </button>
          </form>
        )}

        {/* Demo Quick Access (Email Mode Only) */}
        {mode === "email" && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground text-center mb-3">Quick Access (Demo)</p>
            <div className="grid grid-cols-2 gap-2">
              {demoUsers.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => {
                    setEmail(u.email);
                    setPassword("password123");
                    setTimeout(() => {
                      const form = document.querySelector("form");
                      if (form) form.requestSubmit();
                    }, 0);
                  }}
                  className="py-2 px-3 text-xs font-medium text-left rounded-lg border hover:bg-muted transition-colors flex flex-col"
                >
                  <span className="font-bold truncate text-foreground">{u.name}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
