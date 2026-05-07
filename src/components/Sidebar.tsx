import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import type { UserRole } from "#/lib/auth-context";
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
  X,
  type LucideIcon,
} from "lucide-react";
import { authClient } from "#/lib/auth-client";

interface SidebarProps {
  userRole: UserRole;
  mobileOpen: boolean;
  onClose: () => void;
}

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
    roles: ["super_admin", "branch_admin"],
    items: [
      {
        label: "Order Entry (POS)",
        to: "/pos",
        icon: ShoppingCart,
        roles: ["super_admin", "branch_admin"],
      },
      { label: "Riwayat Pemesanan", to: "/order-history", icon: History, roles: ["super_admin"] },
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
        label: "Stock Opname",
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
      {
        label: "Broken Stock",
        to: "/waste/broken-stock",
        icon: Trash2,
        roles: ["super_admin", "admin_pusat", "area_manager"],
      },
    ],
  },
  {
    label: "Supply Chain",
    roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
    items: [
      {
        label: "Purchase Requisition",
        to: "/purchase-requisitions",
        icon: FileText,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
      },
      {
        label: "Surat Jalan",
        to: "/delivery-notes",
        icon: Truck,
        roles: ["super_admin", "admin_pusat", "area_manager", "branch_admin"],
      },
      {
        label: "Invoice SCM",
        to: "/scm-invoices",
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
        to: "/stock-transfers",
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
        label: "Yield Tracking",
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
    label: "Master Data",
    roles: ["super_admin", "admin_pusat"],
    items: [
      { label: "Menu / Resep", to: "/recipes", icon: Tag, roles: ["super_admin", "admin_pusat"] },
      {
        label: "Modifier Groups",
        to: "/modifier-groups",
        icon: Tag,
        roles: ["super_admin", "admin_pusat"],
      },
      { label: "Users", to: "/admin/users", icon: Users, roles: ["super_admin"] },
      { label: "Cabang", to: "/admin/branches", icon: Store, roles: ["super_admin"] },
      { label: "Brand", to: "/admin/brands", icon: Tag, roles: ["super_admin", "admin_pusat"] },
      { label: "Voucher", to: "/admin/vouchers", icon: Percent, roles: ["super_admin"] },
    ],
  },
  {
    label: "Keuangan & Analitik",
    roles: ["super_admin"],
    items: [
      { label: "Finance & Recon", to: "/finance", icon: DollarSign, roles: ["super_admin"] },
      { label: "Dashboard Analytics", to: "/analytics", icon: BarChart3, roles: ["super_admin"] },
    ],
  },
  {
    label: "Sistem",
    roles: ["super_admin"],
    items: [
      { label: "Period Control", to: "/period-control", icon: Calendar, roles: ["super_admin"] },
      // { label: "Audit Logs", to: "/admin/audit-logs", icon: ShieldCheck, roles: ["super_admin"] },
      { label: "System Logs", to: "/admin/system-logs", icon: ScrollText, roles: ["super_admin"] },
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
      <span className="truncate">{item.label}</span>
    </Link>
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

export default function Sidebar({ userRole, mobileOpen, onClose }: SidebarProps) {
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
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Omoiyari POS
          </Link>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} group={group} userRole={userRole} />
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/login";
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
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Omoiyari POS
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} group={group} userRole={userRole} />
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={async () => {
              await authClient.signOut();
              window.location.href = "/login";
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
