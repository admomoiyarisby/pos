import { useState, useEffect } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { UserRole } from "#/lib/auth-context";
import { Badge } from "#/components/ui/badge";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  ClipboardList,
  FileText,
  Truck,
  ArrowRightLeft,
  Trash2,
  RefreshCw,
  Database,
  DollarSign,
  Settings,
  History,
  Calendar,
  ChevronDown,
  ChevronRight,
  LogOut,
  BarChart3,
  Users,
  Store,
  Tag,
  Percent,
  ScrollText,
  Printer,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { listProcurements } from "#/lib/server/scm-queries";

interface SidebarProps {
  userRole: UserRole;
  userName?: string;
  mobileOpen: boolean;
  onClose: () => void;
}

const roleLabels: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin_pusat: "Admin Pusat",
  area_manager: "Area Manager",
  branch_admin: "Branch Admin",
  central_kitchen: "Central Kitchen",
};

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: UserRole[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
  roles: UserRole[];
}

const navGroups: NavGroup[] = [
  {
    label: "Utama",
    roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, roles: ["super_admin"] },
    ],
  },
  {
    label: "Operasional",
    roles: ["super_admin", "branch_admin", "area_manager"],
    items: [
      {
        label: "Entry Pesanan (POS)",
        to: "/pos",
        icon: ShoppingCart,
        roles: ["super_admin", "branch_admin"],
      },
      { label: "Riwayat Pemesanan", to: "/order-history", icon: History, roles: ["super_admin"] },
      {
        label: "Cetak Ulang",
        to: "/print-requests",
        icon: Printer,
        roles: ["super_admin", "area_manager"],
      },
      {
        label: "Batalkan Pesanan",
        to: "/cancel-requests",
        icon: XCircle,
        roles: ["super_admin", "area_manager"],
      },
    ],
  },
  {
    label: "Inventaris",
    roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
    items: [
      {
        label: "Stok Saat Ini",
        to: "/inventory",
        icon: Package,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
      },
      {
        label: "Kartu Stok",
        to: "/inventory/ledger",
        icon: ScrollText,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
      },
      {
        label: "Opname Stok",
        to: "/stock-opname",
        icon: ClipboardList,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
      },
      {
        label: "Waste",
        to: "/waste",
        icon: Trash2,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin", "central_kitchen"],
      },
    ],
  },
  {
    label: "Supply Chain",
    roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
    items: [
      {
        label: "Pengadaan",
        to: "/scm-procurements",
        icon: FileText,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
      },
      {
        label: "Barang Masuk",
        to: "/supplier-deliveries",
        icon: Truck,
        roles: ["super_admin", "admin_pusat"],
      },
      {
        label: "Mutasi Stok",
        to: "/scm-transfers",
        icon: ArrowRightLeft,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
      },
    ],
  },
  {
    label: "Produksi",
    roles: ["super_admin", "central_kitchen"],
    items: [
      {
        label: "Tracking Produksi",
        to: "/yield-tracking",
        icon: RefreshCw,
        roles: ["super_admin", "central_kitchen"],
      },
      {
        label: "Bahan Baku",
        to: "/ingredients",
        icon: Database,
        roles: ["super_admin", "central_kitchen"],
      },
    ],
  },
  {
    label: "Data Master",
    roles: ["super_admin", "admin_pusat"],
    items: [
      { label: "Menu / Resep", to: "/recipes", icon: Tag, roles: ["super_admin", "admin_pusat"] },
      {
        label: "Grup Modifier",
        to: "/modifier-groups",
        icon: Tag,
        roles: ["super_admin", "admin_pusat"],
      },
      { label: "Pengguna", to: "/admin/users", icon: Users, roles: ["super_admin"] },
      { label: "Cabang", to: "/admin/branches", icon: Store, roles: ["super_admin"] },
      { label: "Merek", to: "/admin/brands", icon: Tag, roles: ["super_admin", "admin_pusat"] },
      { label: "Voucher", to: "/admin/vouchers", icon: Percent, roles: ["super_admin"] },
    ],
  },
  {
    label: "Keuangan & Analitik",
    roles: ["super_admin", "admin_pusat"],
    items: [
      {
        label: "Keuangan & Rekonsiliasi",
        to: "/finance",
        icon: DollarSign,
        roles: ["super_admin", "admin_pusat"],
      },
      { label: "Dashboard Analitik", to: "/analytics", icon: BarChart3, roles: ["super_admin"] },
      {
        label: "Barang Rusak",
        to: "/waste/broken-stock",
        icon: Trash2,
        roles: ["super_admin", "admin_pusat"],
      },
    ],
  },
  {
    label: "Sistem",
    roles: ["super_admin"],
    items: [
      { label: "Kontrol Periode", to: "/period-control", icon: Calendar, roles: ["super_admin"] },
      // { label: "Log Audit", to: "/admin/audit-logs", icon: ShieldCheck, roles: ["super_admin"] },
      { label: "Log Sistem", to: "/admin/system-logs", icon: ScrollText, roles: ["super_admin"] },
      {
        label: "Data Penjualan",
        to: "/admin/sales",
        icon: DollarSign,
        roles: ["super_admin", "admin_pusat"],
      },
      { label: "Pengaturan", to: "/admin", icon: Settings, roles: ["super_admin", "admin_pusat"] },
    ],
  },
];

function SidebarItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{item.label}</span>
      {item.to === "/scm-procurements" ? <PengadaanCountBadge active={active} /> : null}
    </Link>
  );
}

/**
 * PengadaanCountBadge — shows the count of "Pending" procurements next to
 * the Pengadaan sidebar item. Only renders for non-branch-admin roles
 * (the queue is the primary work surface for Admin Pusat). Cache-shared
 * with the /scm-procurements?status=Pending list page query. (ADR 0004 §2)
 */
function PengadaanCountBadge({ active }: { active: boolean }) {
  const { data } = useQuery({
    queryKey: ["scm-procurements", "Pending"],
    queryFn: () => listProcurements({ data: { status: "Pending" } }),
    staleTime: 30_000,
  });
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <span
      className={
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold " +
        (active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground")
      }
    >
      {count}
    </span>
  );
}

function SidebarGroup({ group, userRole }: { group: NavGroup; userRole: UserRole }) {
  const location = useLocation();
  const [open, setOpen] = useState(true);

  if (!group.roles.includes(userRole)) return null;

  const visibleItems = group.items.filter((item) => item.roles.includes(userRole));

  if (visibleItems.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent"
      >
        <span>{group.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {visibleItems.map((item) => (
            <SidebarItem key={item.to} item={item} active={location.pathname === item.to} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ userRole, userName, mobileOpen, onClose }: SidebarProps) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      setDark(document.documentElement.classList.contains("dark"));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Hard navigation to /login after signOut. A hard navigation
  // (window.location.href) is used instead of router.invalidate() +
  // router.navigate() so the fresh page load re-runs the root loader
  // with a clean React tree: the login page's 'if (user) Navigate
  // to="/"' guard reads from a freshly-initialised AuthProvider, not
  // the one populated by the previous page's loader. This is the
  // same approach used in the original code; the earlier attempted
  // fix (router.invalidate + navigate) failed because the navigate
  // raced the AuthProvider context update. See the auth.ts commit
  // for the BETTER_AUTH_URL origin-trust fix that unblocks signOut.
  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  const logoSrc = dark ? "/logo-for-dark-mode.png" : "/logo-for-light-mode.png";

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && <div className="fixed inset-0 z-50 bg-black/50 md:hidden" onClick={onClose} />}

      {/* Mobile slide-in drawer */}
      <aside
        className={
          "fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform md:hidden " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-sidebar-foreground"
            onClick={onClose}
          >
            <img src={logoSrc} alt="Omoiyari POS" className="h-8 w-auto" />
            Omoiyari POS
          </Link>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* User info */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <p className="text-sm font-medium text-sidebar-foreground truncate">
            {userName || "User"}
          </p>
          <Badge variant="outline" className="mt-1 text-xs">
            {roleLabels[userRole] || userRole}
          </Badge>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} group={group} userRole={userRole} />
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={() => {
              void handleSignOut();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-sidebar-foreground">
            <img src={logoSrc} alt="Omoiyari POS" className="h-8 w-auto" />
            Omoiyari POS
          </Link>
        </div>

        {/* User info */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <p className="text-sm font-medium text-sidebar-foreground truncate">
            {userName || "User"}
          </p>
          <Badge variant="outline" className="mt-1 text-xs">
            {roleLabels[userRole] || userRole}
          </Badge>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} group={group} userRole={userRole} />
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={() => {
              void handleSignOut();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>
    </>
  );
}
