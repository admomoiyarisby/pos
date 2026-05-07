import { createFileRoute, useRouter, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useAuth } from "#/lib/auth-context";
import PinPad from "#/components/PinPad";
import { Store, Loader2, Smartphone, Mail } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

// Demo users for quick access
const demoUsers = [
  { name: "Super Admin", email: "superadmin@omoiyari.net", role: "super_admin", pin: "1111" },
  { name: "Admin Pusat", email: "pusat@omoiyari.net", role: "admin_pusat", pin: "2222" },
  { name: "Area Mgr East", email: "manager.east@omoiyari.net", role: "area_manager", pin: "3333" },
  { name: "Hans (Kasir)", email: "hans@omoiyari.net", role: "branch_admin", pin: "1234" },
  { name: "Siti (Kasir)", email: "siti@omoiyari.net", role: "branch_admin", pin: "2345" },
  { name: "Budi (Kasir)", email: "budi@omoiyari.net", role: "branch_admin", pin: "3456" },
  { name: "Rina (Kasir)", email: "rina@omoiyari.net", role: "branch_admin", pin: "4567" },
  { name: "Dewi (Kasir)", email: "dewi@omoiyari.net", role: "branch_admin", pin: "5678" },
];

function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<"email" | "pin">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);

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
    } catch {
      setError("Terjadi kesalahan saat login");
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (enteredPin: string) => {
    setPinError("");
    setPinLoading(true);
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: enteredPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(data.error || "Login gagal");
        setPin("");
      } else {
        // Cookie is set by the API response, invalidate router to re-run root loader
        void router.invalidate();
      }
    } catch {
      setPinError("Terjadi kesalahan saat login");
      setPin("");
    } finally {
      setPinLoading(false);
    }
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
              setPinError("");
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
              setPinError("");
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

        {/* PIN Mode */}
        {mode === "pin" && (
          <div className="space-y-4">
            {pinLoading && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memverifikasi PIN...
              </div>
            )}
            <PinPad
              value={pin}
              onChange={setPin}
              onComplete={handlePinSubmit}
              disabled={pinLoading}
            />
            {pinError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center">
                {pinError}
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

        {/* Demo Quick Access */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center mb-3">Quick Access (Demo)</p>
          <div className="grid grid-cols-2 gap-2">
            {(mode === "pin" ? demoUsers.filter((u) => u.role === "branch_admin") : demoUsers).map(
              (u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => {
                    if (mode === "email") {
                      setEmail(u.email);
                      setPassword("password123");
                      setTimeout(() => {
                        const form = document.querySelector("form");
                        if (form) form.requestSubmit();
                      }, 0);
                    } else {
                      // PIN mode
                      setPin("");
                      setTimeout(() => handlePinSubmit(u.pin), 50);
                    }
                  }}
                  className="py-2 px-3 text-xs font-medium text-left rounded-lg border hover:bg-muted transition-colors flex flex-col"
                >
                  <span className="font-bold truncate text-foreground">{u.name}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    {mode === "email" ? u.email : `PIN: ${u.pin}`}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
