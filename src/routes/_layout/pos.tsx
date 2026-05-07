import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import {
  getPosMenu,
  createOrder,
  getShiftStatus,
  openShift,
  closeShift,
  getOrders,
  voidOrder,
  requestReprint,
} from "#/lib/server/pos";
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getVouchers } from "#/lib/server/vouchers";
import { getInventory } from "#/lib/server/inventory";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  X,
  TicketPercent,
  Percent,
  Printer,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { usePageTitle } from "#/hooks/usePageTitle";
import { Badge } from "#/components/ui/badge";

interface CartModifier {
  groupId: string;
  modifierId: string;
  name: string;
  price: number;
  isExclusion: boolean;
}

interface CartItem {
  recipeId: string;
  brandId: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: CartModifier[];
  notes: string;
}

interface MenuItemModifier {
  id: string;
  name: string;
  price: number;
  isExclusion: boolean;
  excludedIngredientId: string | null;
}

interface ModifierGroup {
  modifierGroupId: string;
  groupName: string | null;
  minSelection: number | null;
  maxSelection: number | null;
  modifiers: MenuItemModifier[];
}

interface MenuItem {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  category: string;
  basePrice: number;
  brands: { id: string; name: string | null }[];
  modifierGroups: ModifierGroup[];
  ingredientIds: { ingredientId: string; quantity: number }[];
}

interface Voucher {
  id: string;
  code: string;
  description: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrder: number;
  validUntil: Date;
  isActive: boolean;
}

interface OrderResult {
  id: string;
  branchId: string;
  channel: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  totalCogs: number;
  orderCode: string | null;
  customerName: string | null;
  paymentMethod: string | null;
  voucherCode: string | null;
  voucherDiscount: number | null;
  status: string;
  voidReason: string | null;
  notes: string | null;
  shiftId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

const categories = [
  { key: "", label: "Semua" },
  { key: "makanan", label: "Makanan" },
  { key: "minuman", label: "Minuman" },
  { key: "snack", label: "Snack" },
  { key: "add_ons", label: "Add-on" },
];

const channels = [
  { key: "Dine-in", label: "Dine-in" },
  { key: "Gofood", label: "Gofood" },
  { key: "Grabfood", label: "Grabfood" },
  { key: "ShopeeFood", label: "ShopeeFood" },
];

export const Route = createFileRoute("/_layout/pos")({
  component: PosPage,
  loader: async () => {
    const [brandsData, branchesData, vouchersData] = await Promise.all([
      getBrands({ data: {} }),
      getBranches({ data: {} }),
      getVouchers({ data: { activeOnly: true } }),
    ]);
    return { brands: brandsData, branches: branchesData, vouchers: vouchersData };
  },
});

function printReceipt(order: OrderResult, cartItems: CartItem[], branchName: string) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = "";
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let modLines = "";
    if (item.modifiers.length > 0) {
      let parts: string[] = [];
      for (let j = 0; j < item.modifiers.length; j++) {
        let m = item.modifiers[j];
        parts.push((m.isExclusion ? "X " : "+ ") + m.name);
      }
      modLines =
        '<div style="font-size: 10px; color: #444; padding-left: 2mm;">' +
        parts.join("<br>") +
        "</div>";
    }
    let noteLine = item.notes
      ? '<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 2mm;">Note: ' +
        item.notes +
        "</div>"
      : "";
    itemsHtml +=
      '<div style="margin-bottom: 3mm;">' +
      '<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">' +
      '<div style="flex: 1;">' +
      item.name +
      "</div>" +
      '<div style="width: 10mm; text-align: center;">' +
      item.quantity +
      "</div>" +
      '<div style="width: 25mm; text-align: right;">' +
      (item.price * item.quantity).toLocaleString("id-ID") +
      "</div>" +
      "</div>" +
      modLines +
      noteLine +
      "</div>";
  }

  let idStr = order.id.slice(0, 8).toUpperCase();
  let lines = [
    "<html><head>",
    "<title>Struk - " + idStr + "</title>",
    "<style>",
    "@page { size: 80mm auto; margin: 0; }",
    "body { font-family: 'Courier New', monospace; width: 80mm; margin: 0; padding: 5mm; font-size: 12px; }",
    ".center { text-align: center; }",
    ".header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }",
    ".divider { border-top: 1px dashed #000; margin: 3mm 0; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 14px; font-weight: bold; margin-top: 2mm; }",
    ".footer { margin-top: 5mm; font-size: 10px; color: #444; text-align: center; }",
    "</style></head><body>",
    '<div class="center header">Omoiyari POS</div>',
    '<div class="center subheader">' + branchName + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    '<div class="row"><span>No. Order:</span><span>' + idStr + "</span></div>",
    '<div class="row"><span>Channel:</span><span>' + order.channel + "</span></div>",
    '<div class="row"><span>Pembayaran:</span><span>' +
      (order.paymentMethod || "-") +
      "</span></div>",
    '<div class="divider"></div>',
    itemsHtml,
    '<div class="divider"></div>',
    '<div class="row"><span>Subtotal</span><span>Rp ' +
      order.subtotal.toLocaleString("id-ID") +
      "</span></div>",
  ];
  if (order.voucherDiscount) {
    lines.push(
      '<div class="row"><span>Diskon</span><span>-Rp ' +
        order.voucherDiscount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  if (order.taxAmount) {
    lines.push(
      '<div class="row"><span>PB1</span><span>Rp ' +
        order.taxAmount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  lines.push(
    '<div class="row total"><span>TOTAL</span><span>Rp ' +
      order.totalAmount.toLocaleString("id-ID") +
      "</span></div>",
    '<div class="divider"></div>',
    '<div class="footer">Terima kasih telah berbelanja</div>',
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

function printBill(
  cartItems: CartItem[],
  branchName: string,
  subtotal: number,
  voucherDiscount: number,
  taxAmount: number,
  finalTotal: number,
) {
  let printWindow = window.open("", "_blank");
  if (!printWindow) return;

  let itemsHtml = "";
  for (let i = 0; i < cartItems.length; i++) {
    let item = cartItems[i];
    let modLines = "";
    if (item.modifiers.length > 0) {
      let parts: string[] = [];
      for (let j = 0; j < item.modifiers.length; j++) {
        let m = item.modifiers[j];
        parts.push((m.isExclusion ? "X " : "+ ") + m.name);
      }
      modLines =
        '<div style="font-size: 10px; color: #444; padding-left: 2mm;">' +
        parts.join("<br>") +
        "</div>";
    }
    let noteLine = item.notes
      ? '<div style="font-size: 10px; font-style: italic; color: #666; padding-left: 2mm;">' +
        item.notes +
        "</div>"
      : "";
    itemsHtml +=
      '<div style="margin-bottom: 3mm;">' +
      '<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">' +
      '<div style="flex: 1;">' +
      item.name +
      "</div>" +
      '<div style="width: 10mm; text-align: center;">' +
      item.quantity +
      "</div>" +
      '<div style="width: 25mm; text-align: right;">' +
      (item.price * item.quantity).toLocaleString("id-ID") +
      "</div>" +
      "</div>" +
      modLines +
      noteLine +
      "</div>";
  }

  let lines = [
    "<html><head>",
    "<title>Bill</title>",
    "<style>",
    "@page { size: 80mm auto; margin: 0; }",
    "body { font-family: 'Courier New', monospace; width: 80mm; margin: 0; padding: 5mm; font-size: 12px; }",
    ".center { text-align: center; }",
    ".watermark { text-align: center; border: 2px dashed #999; padding: 2mm; margin: 3mm 0; color: #999; font-weight: bold; font-size: 14px; }",
    ".header { font-size: 16px; font-weight: bold; margin-bottom: 2mm; }",
    ".subheader { font-size: 11px; color: #444; margin-bottom: 4mm; }",
    ".divider { border-top: 1px dashed #000; margin: 3mm 0; }",
    ".row { display: flex; justify-content: space-between; }",
    ".total { font-size: 14px; font-weight: bold; margin-top: 2mm; }",
    "</style></head><body>",
    '<div class="watermark">BELUM DIBAYAR / UNPAID</div>',
    '<div class="center header">' + branchName + "</div>",
    '<div class="center subheader">' + new Date().toLocaleString("id-ID") + "</div>",
    '<div class="divider"></div>',
    itemsHtml,
    '<div class="divider"></div>',
    '<div class="row"><span>Subtotal</span><span>Rp ' +
      subtotal.toLocaleString("id-ID") +
      "</span></div>",
  ];
  if (voucherDiscount > 0) {
    lines.push(
      '<div class="row"><span>Diskon</span><span>-Rp ' +
        voucherDiscount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  if (taxAmount > 0) {
    lines.push(
      '<div class="row"><span>PB1</span><span>Rp ' +
        taxAmount.toLocaleString("id-ID") +
        "</span></div>",
    );
  }
  lines.push(
    '<div class="row total"><span>TOTAL</span><span>Rp ' +
      finalTotal.toLocaleString("id-ID") +
      "</span></div>",
    '<div class="watermark">BELUM DIBAYAR</div>',
    "<script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>",
    "</body></html>",
  );

  printWindow.document.write(lines.join("\n"));
  printWindow.document.close();
}

function getStockQuantity(
  item: MenuItem,
  branchInventory: { ingredientId: string; quantity: number }[] | undefined,
): number {
  if (!branchInventory || item.ingredientIds.length === 0) return 999;
  let minQty = Infinity;
  for (let k = 0; k < item.ingredientIds.length; k++) {
    let ri = item.ingredientIds[k];
    let inv = branchInventory.find(function (i) {
      return i.ingredientId === ri.ingredientId;
    });
    let q = inv ? Math.floor(inv.quantity / ri.quantity) : 0;
    if (q < minQty) minQty = q;
  }
  return Number.isFinite(minQty) ? minQty : 999;
}

function PosPage() {
  usePageTitle("POS", "Point of Sale");

  let user = useAuth().user;
  let loaderData = Route.useLoaderData();
  let brands = loaderData.brands;
  let allBranches = loaderData.branches;
  let allVouchers = loaderData.vouchers;
  let queryClient = useQueryClient();

  let isAdmin = user?.role === "super_admin" || user?.role === "admin_pusat";
  let userBranch = allBranches.find(function (b) {
    return b.id === user?.branchId;
  });

  let _a = useState(user?.branchId ?? allBranches[0]?.id ?? "");
  let activeBranchId = _a[0];
  let setActiveBranchId = _a[1];
  let _b = useState("");
  let selectedBrandId = _b[0];
  let setSelectedBrandId = _b[1];
  let _c = useState("");
  let selectedCategory = _c[0];
  let setSelectedCategory = _c[1];
  let _d = useState("");
  let searchQuery = _d[0];
  let setSearchQuery = _d[1];
  let _e = useState<CartItem[]>([]);
  let cart = _e[0];
  let setCart = _e[1];
  let _f = useState("Dine-in");
  let channel = _f[0];
  let setChannel = _f[1];
  let _g = useState("");
  let customerName = _g[0];
  let setCustomerName = _g[1];
  let _h = useState("");
  let orderCode = _h[0];
  let setOrderCode = _h[1];
  let _i = useState("");
  let orderNotes = _i[0];
  let setOrderNotes = _i[1];
  let _j = useState("Cash");
  let paymentMethod = _j[0];
  let setPaymentMethod = _j[1];
  let _k = useState<Voucher | null>(null);
  let selectedVoucher = _k[0];
  let setSelectedVoucher = _k[1];
  let _l = useState(false);
  let ppnEnabled = _l[0];
  let setPpnEnabled = _l[1];
  let _m = useState<string | null>(null);
  let checkoutError = _m[0];
  let setCheckoutError = _m[1];
  let _n = useState<OrderResult | null>(null);
  let successOrder = _n[0];
  let setSuccessOrder = _n[1];
  let _o = useState<string | null>(null);
  let stockError = _o[0];
  let setStockError = _o[1];

  let _p = useState<{
    item: MenuItem;
    selectedModifiers: CartModifier[];
    itemNotes: string;
  } | null>(null);
  let modifierModal = _p[0];
  let setModifierModal = _p[1];

  let _q = useState<"open" | "close" | null>(null);
  let shiftModal = _q[0];
  let setShiftModal = _q[1];
  let _r = useState("");
  let cashFloat = _r[0];
  let setCashFloat = _r[1];
  let _s = useState("");
  let actualCash = _s[0];
  let setActualCash = _s[1];
  let _t = useState<{ orderId: string; reason: string } | null>(null);
  let voidModal = _t[0];
  let setVoidModal = _t[1];
  let _u = useState(false);
  let mobileCartOpen = _u[0];
  let setMobileCartOpen = _u[1];

  // PB1 rate from branch config
  let pb1Rate = 11;
  let activeBranch = allBranches.find(function (b) {
    return b.id === activeBranchId;
  });
  if (activeBranch && typeof activeBranch.pb1Rate === "number") {
    pb1Rate = activeBranch.pb1Rate;
  }

  // Reprint approval state
  let _v = useState<string | null>(null);
  let reprintRequestStatus = _v[0];
  let setReprintRequestStatus = _v[1];

  let menuResult = useQuery({
    queryKey: ["pos-menu", selectedBrandId, selectedCategory, searchQuery],
    queryFn: function () {
      return getPosMenu({
        data: {
          brandId: selectedBrandId || undefined,
          category: selectedCategory || undefined,
          search: searchQuery || undefined,
        },
      });
    },
  });
  let menuItems = menuResult.data || [];

  let shiftResult = useQuery({
    queryKey: ["shift", activeBranchId, user?.id],
    queryFn: function () {
      return getShiftStatus({ data: { branchId: activeBranchId, userId: user?.id ?? "" } });
    },
    enabled: !!activeBranchId && !!user?.id,
  });
  let activeShift = shiftResult.data;

  let invResult = useQuery({
    queryKey: ["inventory", activeBranchId],
    queryFn: function () {
      return getInventory({ data: { branchId: activeBranchId } });
    },
    enabled: !!activeBranchId,
  });
  let branchInventory = invResult.data?.data ?? [];

  let ordersResult = useQuery({
    queryKey: ["pos-recent-orders", activeBranchId],
    queryFn: function () {
      return getOrders({ data: { branchId: activeBranchId, limit: 20 } });
    },
    enabled: !!activeBranchId,
  });
  let recentOrders = ordersResult.data || [];

  let createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: function (order) {
      setSuccessOrder(order as unknown as OrderResult);
      resetForm();
      setMobileCartOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["pos-recent-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: function (error) {
      setCheckoutError(error instanceof Error ? error.message : "Gagal membuat order");
    },
  });

  let openShiftMutation = useMutation({
    mutationFn: openShift,
    onSuccess: async function () {
      await queryClient.invalidateQueries({ queryKey: ["shift"] });
      setShiftModal(null);
      setCashFloat("");
    },
  });

  let closeShiftMutation = useMutation({
    mutationFn: closeShift,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["shift"] });
      setShiftModal(null);
      setActualCash("");
    },
  });

  let voidOrderMutation = useMutation({
    mutationFn: voidOrder,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["pos-recent-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setVoidModal(null);
    },
  });

  let cartTotal = cart.reduce(function (sum, item) {
    return sum + item.price * item.quantity;
  }, 0);
  let cartCount = cart.reduce(function (sum, item) {
    return sum + item.quantity;
  }, 0);

  let voucherDiscount = useMemo(
    function () {
      if (!selectedVoucher) return 0;
      if (cartTotal < selectedVoucher.minOrder) return 0;
      if (selectedVoucher.discountType === "percentage") {
        return Math.round((cartTotal * selectedVoucher.discountValue) / 100);
      }
      return selectedVoucher.discountValue;
    },
    [selectedVoucher, cartTotal],
  );

  let subtotalAfterDiscount = Math.max(0, cartTotal - voucherDiscount);

  let taxAmount = useMemo(
    function () {
      if (!ppnEnabled || pb1Rate === 0) return 0;
      return Math.round(subtotalAfterDiscount * (pb1Rate / 100));
    },
    [ppnEnabled, pb1Rate, subtotalAfterDiscount],
  );

  let finalTotal = subtotalAfterDiscount + taxAmount;
  let isDineIn = channel === "Dine-in";

  let resetForm = useCallback(function () {
    setCart([]);
    setCustomerName("");
    setOrderCode("");
    setOrderNotes("");
    setSelectedVoucher(null);
    setPpnEnabled(false);
    setPaymentMethod("Cash");
    setChannel("Dine-in");
    setSelectedBrandId("");
    setSelectedCategory("");
    setSearchQuery("");
    setCheckoutError(null);
    setStockError(null);
  }, []);

  function handleAddToCart(item: MenuItem) {
    setCheckoutError(null);
    setStockError(null);

    let availableServings = getStockQuantity(item, branchInventory);
    let inCart = cart
      .filter(function (c) {
        return c.recipeId === item.id;
      })
      .reduce(function (sum, c) {
        return sum + c.quantity;
      }, 0);
    if (availableServings <= inCart) {
      setStockError("Stok tidak mencukupi untuk " + item.name);
      return;
    }

    if (item.modifierGroups.length > 0) {
      let defaults: CartModifier[] = [];
      for (let g = 0; g < item.modifierGroups.length; g++) {
        let grp = item.modifierGroups[g];
        if ((grp.minSelection ?? 0) > 0 && grp.modifiers.length > 0) {
          let first = grp.modifiers[0];
          defaults.push({
            groupId: grp.modifierGroupId,
            modifierId: first.id,
            name: first.name,
            price: first.price ?? 0,
            isExclusion: first.isExclusion,
          });
        }
      }
      setModifierModal({ item: item, selectedModifiers: defaults, itemNotes: "" });
    } else {
      addItemToCart(item, [], "");
    }
  }

  function addItemToCart(item: MenuItem, modifiers: CartItem["modifiers"], itemNotes: string) {
    let modPrice = modifiers.reduce(function (sum, m) {
      return sum + m.price;
    }, 0);
    let existingIdx = cart.findIndex(function (c) {
      return (
        c.recipeId === item.id &&
        c.notes === itemNotes &&
        JSON.stringify(
          c.modifiers
            .map(function (m) {
              return m.modifierId;
            })
            .sort(),
        ) ===
          JSON.stringify(
            modifiers
              .map(function (m) {
                return m.modifierId;
              })
              .sort(),
          )
      );
    });

    if (existingIdx >= 0) {
      let updated = cart.slice();
      updated[existingIdx].quantity += 1;
      setCart(updated);
    } else {
      setCart(
        cart.concat([
          {
            recipeId: item.id,
            brandId: item.brands[0]?.id ?? "",
            name: item.name,
            price: item.basePrice + modPrice,
            quantity: 1,
            modifiers: modifiers,
            notes: itemNotes,
          },
        ]),
      );
    }
    setModifierModal(null);
  }

  function updateQty(idx: number, delta: number) {
    setCheckoutError(null);
    let updated = cart.slice();
    updated[idx].quantity = Math.max(1, updated[idx].quantity + delta);
    setCart(updated);
  }

  function removeItem(idx: number) {
    setCheckoutError(null);
    setCart(
      cart.filter(function (_, i) {
        return i !== idx;
      }),
    );
  }

  function toggleVoucher(v: Voucher) {
    setCheckoutError(null);
    setSelectedVoucher(function (prev) {
      return prev?.id === v.id ? null : v;
    });
  }

  async function handleCheckout() {
    if (cart.length === 0 || !activeShift) return;
    setCheckoutError(null);

    let items = cart.map(function (c) {
      return {
        recipeId: c.recipeId,
        brandId: c.brandId,
        quantity: c.quantity,
        price: c.price,
        selectedModifiers: c.modifiers.map(function (m) {
          return {
            groupId: m.groupId,
            modifierId: m.modifierId,
            price: m.price,
            isExclusion: m.isExclusion,
          };
        }),
        notes: c.notes,
      };
    });

    try {
      await createOrderMutation.mutateAsync({
        data: {
          branchId: activeBranchId,
          channel: channel as "Dine-in" | "Gofood" | "Grabfood" | "ShopeeFood",
          customerName: channel === "Dine-in" ? customerName : undefined,
          orderCode: channel !== "Dine-in" ? orderCode : undefined,
          items: items,
          voucherCode: selectedVoucher?.code,
          voucherDiscount: voucherDiscount > 0 ? voucherDiscount : undefined,
          taxAmount: taxAmount > 0 ? taxAmount : undefined,
          paymentMethod: paymentMethod,
          shiftId: activeShift.id,
          notes: orderNotes || undefined,
        },
      });
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Transaksi gagal");
    }
  }

  let requestReprintMutation = useMutation({
    mutationFn: requestReprint,
    onSuccess: function (result: any) {
      if (result.alreadyPending) {
        setReprintRequestStatus("already_pending");
      } else {
        setReprintRequestStatus("pending");
      }
    },
    onError: function () {
      setReprintRequestStatus("error");
    },
  });

  function handleReprint(orderId: string) {
    setReprintRequestStatus(null);
    void requestReprintMutation.mutateAsync({
      data: { orderId: orderId, requestType: "reprint" },
    });
  }

  function handleVoid() {
    if (!voidModal) return;
    void voidOrderMutation.mutateAsync({
      data: { orderId: voidModal.orderId, reason: voidModal.reason },
    });
  }

  function handleOpenShift() {
    if (!cashFloat || !user) return;
    void openShiftMutation.mutateAsync({
      data: { branchId: activeBranchId, userId: user.id, cashFloat: Number(cashFloat) },
    });
  }

  function handleCloseShift() {
    if (!actualCash || !activeShift) return;
    void closeShiftMutation.mutateAsync({
      data: { shiftId: activeShift.id, actualCash: Number(actualCash) },
    });
  }

  let canVoid = user?.role === "super_admin" || user?.role === "admin_pusat";

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "branch_admin"]}>
      <div className="flex flex-col md:flex-row h-[calc(100vh-3rem)] -m-4 md:-m-6">
        {/* Main Content */}
        <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden">
          {/* Top Bar */}
          <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap">
            {isAdmin ? (
              <select
                value={activeBranchId}
                onChange={function (e) {
                  setActiveBranchId(e.target.value);
                  setSelectedBrandId("");
                  setSelectedCategory("");
                  setSearchQuery("");
                  setCart([]);
                  setCheckoutError(null);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium"
              >
                {allBranches.map(function (b) {
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm font-medium">
                <span>{}</span>
                {userBranch?.name ?? "Unknown"}
              </div>
            )}

            <select
              value={channel}
              onChange={function (e) {
                setChannel(e.target.value);
                setCheckoutError(null);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {channels.map(function (c) {
                return (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                );
              })}
            </select>
            {channel === "Dine-in" ? (
              <input
                placeholder="Nama Pelanggan"
                value={customerName}
                onChange={function (e) {
                  setCustomerName(e.target.value);
                }}
                className="h-9 flex-1 max-w-full sm:max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
            ) : (
              <input
                placeholder="Kode Order"
                value={orderCode}
                onChange={function (e) {
                  setOrderCode(e.target.value);
                }}
                className="h-9 flex-1 max-w-full sm:max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              {activeShift ? (
                <button
                  onClick={function () {
                    setShiftModal("close");
                  }}
                  className="h-9 px-3 rounded-md border text-sm text-muted-foreground hover:bg-muted"
                >
                  Tutup Shift
                </button>
              ) : (
                <button
                  onClick={function () {
                    setShiftModal("open");
                  }}
                  className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm"
                >
                  Buka Shift
                </button>
              )}
            </div>
          </div>

          {/* Brand Tabs */}
          <div className="flex gap-2 mb-3 shrink-0 overflow-x-auto">
            <button
              onClick={function () {
                setSelectedBrandId("");
                setCheckoutError(null);
              }}
              className={
                "h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
                (selectedBrandId === ""
                  ? "bg-primary text-primary-foreground"
                  : "border hover:bg-muted")
              }
            >
              Semua Brand
            </button>
            {brands.map(function (b) {
              return (
                <button
                  key={b.id}
                  onClick={function () {
                    setSelectedBrandId(b.id);
                    setCheckoutError(null);
                  }}
                  className={
                    "h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
                    (selectedBrandId === b.id
                      ? "bg-primary text-primary-foreground"
                      : "border hover:bg-muted")
                  }
                >
                  {b.name}
                </button>
              );
            })}
          </div>

          {/* Category + Search */}
          <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {categories.map(function (cat) {
                return (
                  <button
                    key={cat.key}
                    onClick={function () {
                      setSelectedCategory(cat.key);
                      setCheckoutError(null);
                    }}
                    className={
                      "h-8 px-3 rounded-md text-xs font-medium transition-colors " +
                      (selectedCategory === cat.key
                        ? "bg-secondary text-secondary-foreground"
                        : "border hover:bg-muted")
                    }
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <div className="relative flex-1 max-w-xs ml-auto">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari menu..."
                value={searchQuery}
                onChange={function (e) {
                  setSearchQuery(e.target.value);
                  setCheckoutError(null);
                }}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
              />
            </div>
          </div>

          {/* Menu Grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {menuItems.map(function (item: MenuItem) {
                let stockQty = getStockQuantity(item, branchInventory);
                let inCartCount = cart
                  .filter(function (c) {
                    return c.recipeId === item.id;
                  })
                  .reduce(function (s, c) {
                    return s + c.quantity;
                  }, 0);
                let isOutOfStock = stockQty <= inCartCount;
                return (
                  <button
                    key={item.id}
                    onClick={function () {
                      handleAddToCart(item);
                    }}
                    disabled={isOutOfStock && item.ingredientIds.length > 0}
                    className="group relative rounded-lg border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isOutOfStock && item.ingredientIds.length > 0 && (
                      <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center z-10">
                        <span className="text-white text-xs font-bold tracking-wider">HABIS</span>
                      </div>
                    )}
                    <div className="aspect-square mb-2 rounded-md bg-muted flex items-center justify-center relative overflow-hidden">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="h-full w-full object-cover rounded-md"
                        />
                      ) : (
                        <span className="text-2xl">{}</span>
                      )}
                      {/* + button overlay — visible on hover */}
                      <div className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg pointer-events-none">
                        <Plus className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
                    <p className="text-sm font-semibold text-primary mt-1">
                      Rp {item.basePrice.toLocaleString("id-ID")}
                    </p>
                    {item.modifierGroups.length > 0 && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        + {item.modifierGroups.length} Modifiers
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
            {menuItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Menu tidak ditemukan</p>
              </div>
            )}
          </div>
        </div>

        {/* Cart Sidebar — Desktop */}
        <div className="hidden md:flex w-72 border-l bg-card flex-col">
          {/* Header */}
          <div className="px-3 py-2 border-b shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              <h2 className="font-semibold text-sm">Keranjang</h2>
              {cartCount > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {cartCount}
                </Badge>
              )}
            </div>
          </div>

          {/* Cart items — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-2">
            {cart.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Keranjang kosong</p>
                <p className="text-xs">Pilih menu untuk memulai</p>
              </div>
            ) : (
              cart.map(function (item, idx) {
                return (
                  <div key={idx} className="rounded-md border p-2">
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">{item.name}</p>
                        {item.modifiers.length > 0 && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {item.modifiers
                              .map(function (m) {
                                return m.name;
                              })
                              .join(", ")}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-[10px] text-muted-foreground italic truncate">
                            {"\u201C" + item.notes + "\u201D"}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={function () {
                          removeItem(idx);
                        }}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={function () {
                            updateQty(idx, -1);
                          }}
                          className="h-5 w-5 rounded border flex items-center justify-center"
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-medium">{item.quantity}</span>
                        <button
                          onClick={function () {
                            updateQty(idx, 1);
                          }}
                          className="h-5 w-5 rounded border flex items-center justify-center"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <p className="text-xs font-semibold">
                        Rp {(item.price * item.quantity).toLocaleString("id-ID")}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Checkout section */}
          <div className="border-t px-3 py-2 space-y-1.5 shrink-0">
            {/* Vouchers */}
            {allVouchers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allVouchers.map(function (v) {
                  let meetsMinOrder = cartTotal >= v.minOrder;
                  let isSelected = selectedVoucher?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={function () {
                        toggleVoucher(v);
                      }}
                      disabled={!meetsMinOrder}
                      className={
                        "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] " +
                        (isSelected
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : meetsMinOrder
                            ? "hover:border-primary/50"
                            : "opacity-40 cursor-not-allowed")
                      }
                    >
                      <Percent className="h-2 w-2" />
                      <span>{v.code}</span>
                      <span className="text-muted-foreground">
                        {v.discountType === "percentage"
                          ? "-" + v.discountValue + "%"
                          : "-Rp" + v.discountValue.toLocaleString("id-ID")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Price lines */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span>Rp {cartTotal.toLocaleString("id-ID")}</span>
              </div>
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Diskon</span>
                  <span className="text-emerald-600">
                    -Rp {voucherDiscount.toLocaleString("id-ID")}
                  </span>
                </div>
              )}
              {isDineIn && pb1Rate > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-1 cursor-pointer text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={ppnEnabled}
                      onChange={function (e) {
                        setPpnEnabled(e.target.checked);
                      }}
                      className="h-3 w-3 rounded border-gray-300"
                    />
                    PB1 {pb1Rate}%
                  </label>
                  {taxAmount > 0 && (
                    <span className="text-muted-foreground">
                      +Rp {taxAmount.toLocaleString("id-ID")}
                    </span>
                  )}
                </div>
              )}
              <div className="flex justify-between text-sm font-bold border-t pt-1">
                <span>Total</span>
                <span>Rp {finalTotal.toLocaleString("id-ID")}</span>
              </div>
            </div>

            {/* Payment — Dine-in only */}
            {isDineIn && (
              <select
                value={paymentMethod}
                onChange={function (e) {
                  setPaymentMethod(e.target.value);
                  setCheckoutError(null);
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="Cash">Cash</option>
                <option value="QRIS">QRIS</option>
                <option value="Transfer">Transfer</option>
              </select>
            )}

            {/* Print Bill button */}
            {cart.length > 0 && (
              <button
                onClick={function () {
                  printBill(
                    cart,
                    userBranch?.name ?? "Cabang",
                    cartTotal,
                    voucherDiscount,
                    taxAmount,
                    finalTotal,
                  );
                }}
                className="w-full h-8 rounded-md border border-dashed text-xs font-medium text-muted-foreground hover:bg-muted flex items-center justify-center gap-1.5"
              >
                <Printer className="h-3 w-3" /> Cetak Tagihan
              </button>
            )}

            {/* Checkout button */}
            <button
              onClick={handleCheckout}
              disabled={cartTotal === 0 || !activeShift || createOrderMutation.isPending}
              className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createOrderMutation.isPending
                ? "Memproses..."
                : isDineIn
                  ? "Bayar Rp " + finalTotal.toLocaleString("id-ID")
                  : "Konfirmasi Pesanan"}
            </button>
            {!activeShift && (
              <p className="text-[10px] text-center text-destructive">Buka shift terlebih dahulu</p>
            )}

            {checkoutError && (
              <div className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{checkoutError}</span>
                <button
                  onClick={function () {
                    setCheckoutError(null);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {stockError && (
              <div className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{stockError}</span>
                <button
                  onClick={function () {
                    setStockError(null);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Reprint status */}
          {reprintRequestStatus && (
            <div className="shrink-0 border-t px-3 py-1.5 text-[10px] flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-amber-500 shrink-0" />
              <span
                className={reprintRequestStatus === "error" ? "text-destructive" : "text-amber-600"}
              >
                {reprintRequestStatus === "pending"
                  ? "Menunggu persetujuan Area Manager..."
                  : reprintRequestStatus === "already_pending"
                    ? "Permintaan cetak ulang sudah diajukan sebelumnya"
                    : "Gagal mengajukan permintaan"}
              </span>
              <button
                onClick={function () {
                  setReprintRequestStatus(null);
                }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Riwayat — fixed at bottom */}
          <div className="shrink-0 border-t h-40 flex flex-col">
            <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-muted-foreground border-b bg-muted/30 shrink-0">
              Riwayat Pesanan
            </h3>
            <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1">
              {recentOrders.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-3">
                  Belum ada pesanan
                </p>
              ) : (
                recentOrders.map(function (o: any) {
                  return (
                    <div
                      key={o.id}
                      className="flex items-center justify-between text-xs py-1 border-b border-dashed last:border-0"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] bg-muted px-1 rounded shrink-0">
                          #{(o.id || "").slice(0, 6).toUpperCase()}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {new Date(o.createdAt).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-semibold">
                          Rp {o.totalAmount.toLocaleString("id-ID")}
                        </span>
                        <button
                          onClick={function () {
                            handleReprint(o.id);
                          }}
                          className="h-5 w-5 inline-flex items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                          title="Cetak"
                        >
                          <Printer className="h-2.5 w-2.5" />
                        </button>
                        {canVoid && o.status !== "Void" && (
                          <button
                            onClick={function () {
                              setVoidModal({ orderId: o.id, reason: "" });
                            }}
                            className="h-5 w-5 inline-flex items-center justify-center rounded border text-destructive hover:bg-destructive/10"
                            title="Batal"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      <SuccessModal
        order={successOrder}
        cartItems={cart}
        branchName={userBranch?.name ?? "Cabang"}
        onClose={function () {
          setSuccessOrder(null);
        }}
        onNewTransaction={function () {
          setSuccessOrder(null);
          resetForm();
        }}
      />

      {/* Void Modal */}
      <Modal
        open={!!voidModal}
        onClose={function () {
          setVoidModal(null);
        }}
        title="Batalkan Pesanan"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Apakah Anda yakin ingin membatalkan pesanan ini? Stok bahan baku akan dikembalikan.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alasan Pembatalan</label>
            <input
              type="text"
              value={voidModal?.reason ?? ""}
              onChange={function (e) {
                setVoidModal(function (prev) {
                  return prev ? { ...prev, reason: e.target.value } : null;
                });
              }}
              placeholder="Alasan pembatalan..."
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={function () {
                setVoidModal(null);
              }}
              className="h-9 px-4 rounded-md border text-sm"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleVoid}
              disabled={!voidModal?.reason || voidOrderMutation.isPending}
              className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
            >
              {voidOrderMutation.isPending ? "Memproses..." : "Batalkan Pesanan"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modifier Modal */}
      {modifierModal && (
        <ModifierModal
          item={modifierModal.item}
          initial={modifierModal.selectedModifiers}
          initialNotes={modifierModal.itemNotes}
          onClose={function () {
            setModifierModal(null);
          }}
          onConfirm={function (modifiers, notes) {
            if (modifierModal) addItemToCart(modifierModal.item, modifiers, notes);
          }}
        />
      )}

      {/* Shift Modals */}
      <Modal
        open={shiftModal === "open"}
        onClose={function () {
          setShiftModal(null);
        }}
        title="Buka Shift"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Modal Awal Laci (Rp)</label>
            <input
              type="number"
              min={0}
              value={cashFloat}
              onChange={function (e) {
                setCashFloat(e.target.value);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="0"
              autoFocus
            />
          </div>
          <button
            onClick={handleOpenShift}
            disabled={!cashFloat || openShiftMutation.isPending}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Buka Shift
          </button>
        </div>
      </Modal>

      <Modal
        open={shiftModal === "close"}
        onClose={function () {
          setShiftModal(null);
        }}
        title="Tutup Shift"
      >
        <div className="space-y-4">
          {activeShift && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p>Modal Awal: Rp {activeShift.cashFloat.toLocaleString("id-ID")}</p>
              <p>
                Shift dimulai:{" "}
                {new Date(activeShift.startTime).toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Uang Fisik Aktual di Laci (Rp)</label>
            <input
              type="number"
              min={0}
              value={actualCash}
              onChange={function (e) {
                setActualCash(e.target.value);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="0"
              autoFocus
            />
          </div>
          <button
            onClick={handleCloseShift}
            disabled={!actualCash || closeShiftMutation.isPending}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Tutup Shift
          </button>
        </div>
      </Modal>

      {/* Mobile cart FAB */}
      {cart.length > 0 && (
        <>
          <button
            onClick={function () {
              setMobileCartOpen(true);
              setCheckoutError(null);
            }}
            className="fixed bottom-6 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
          >
            <ShoppingCart className="h-6 w-6" />
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[11px] font-bold text-destructive-foreground">
              {cartCount}
            </span>
          </button>

          {mobileCartOpen && (
            <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  <h2 className="font-semibold">Keranjang</h2>
                  <span className="text-sm text-muted-foreground">({cartCount} item)</span>
                </div>
                <button
                  onClick={function () {
                    setMobileCartOpen(false);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.map(function (item, idx) {
                  return (
                    <div key={idx} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.name}</p>
                          {item.modifiers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.modifiers.map(function (m, mi) {
                                return (
                                  <span
                                    key={mi}
                                    className={
                                      "text-[10px] px-1.5 py-0.5 rounded border " +
                                      (m.isExclusion
                                        ? "bg-amber-50 text-amber-700 border-amber-100"
                                        : "bg-emerald-50 text-emerald-700 border-emerald-100")
                                    }
                                  >
                                    {m.isExclusion ? "X " : ""}
                                    {m.name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {item.notes && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              {"\u201C" + item.notes + "\u201D"}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={function () {
                            removeItem(idx);
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={function () {
                              updateQty(idx, -1);
                            }}
                            className="h-7 w-7 rounded-md border flex items-center justify-center text-xs"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">
                            {item.quantity}
                          </span>
                          <button
                            onClick={function () {
                              updateQty(idx, 1);
                            }}
                            className="h-7 w-7 rounded-md border flex items-center justify-center text-xs"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-sm font-semibold">
                          Rp {(item.price * item.quantity).toLocaleString("id-ID")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mobile checkout */}
              <div className="border-t p-4 space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Catatan Order</label>
                  <textarea
                    value={orderNotes}
                    onChange={function (e) {
                      setOrderNotes(e.target.value);
                    }}
                    placeholder="Catatan untuk dapur / kasir..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-none"
                  />
                </div>

                {allVouchers.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TicketPercent className="h-3.5 w-3.5" />
                      <span className="font-semibold">Voucher</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {allVouchers.map(function (v) {
                        let meetsMinOrder = cartTotal >= v.minOrder;
                        let isSelected = selectedVoucher?.id === v.id;
                        return (
                          <button
                            key={v.id}
                            onClick={function () {
                              toggleVoucher(v);
                            }}
                            disabled={!meetsMinOrder}
                            className={
                              "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-all " +
                              (isSelected
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : meetsMinOrder
                                  ? "hover:border-primary/50 hover:bg-muted"
                                  : "opacity-40 cursor-not-allowed")
                            }
                          >
                            <Percent className="h-3 w-3" />
                            <span>{v.code}</span>
                            <span className="text-muted-foreground">
                              {v.discountType === "percentage"
                                ? "-" + v.discountValue + "%"
                                : "-Rp" + v.discountValue.toLocaleString("id-ID")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">Rp {cartTotal.toLocaleString("id-ID")}</span>
                </div>

                {voucherDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Diskon ({selectedVoucher?.code})</span>
                    <span className="font-medium text-emerald-600">
                      -Rp {voucherDiscount.toLocaleString("id-ID")}
                    </span>
                  </div>
                )}

                {isDineIn && pb1Rate > 0 && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ppnEnabled}
                        onChange={function (e) {
                          setPpnEnabled(e.target.checked);
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      PB1 {pb1Rate}%
                    </label>
                    {taxAmount > 0 && (
                      <span className="text-sm text-muted-foreground">
                        +Rp {taxAmount.toLocaleString("id-ID")}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-between text-sm font-bold border-t pt-2">
                  <span>Total</span>
                  <span>Rp {finalTotal.toLocaleString("id-ID")}</span>
                </div>

                {isDineIn && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Metode Pembayaran</label>
                    <select
                      value={paymentMethod}
                      onChange={function (e) {
                        setPaymentMethod(e.target.value);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="Cash">Cash / Tunai</option>
                      <option value="QRIS">QRIS</option>
                      <option value="Transfer">Transfer</option>
                    </select>
                  </div>
                )}

                {checkoutError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium">Gagal memproses transaksi</p>
                      <p className="text-xs opacity-80">{checkoutError}</p>
                    </div>
                    <button
                      onClick={function () {
                        setCheckoutError(null);
                      }}
                      className="shrink-0 rounded-md p-0.5 hover:bg-destructive/20"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={cart.length === 0 || !activeShift || createOrderMutation.isPending}
                  className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createOrderMutation.isPending
                    ? "Memproses..."
                    : isDineIn
                      ? "Bayar"
                      : "Konfirmasi"}
                </button>
                {!activeShift && (
                  <p className="text-xs text-center text-destructive">Buka shift terlebih dahulu</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </RoleGuard>
  );
}

function SuccessModal(props: {
  order: OrderResult | null;
  cartItems: CartItem[];
  branchName: string;
  onClose: () => void;
  onNewTransaction: () => void;
}) {
  if (!props.order) return null;

  let o = props.order;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg">
        <div className="text-center mb-4">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-2" />
          <h2 className="text-lg font-bold">Transaksi Berhasil!</h2>
        </div>

        <div className="rounded-md bg-muted p-4 space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Order</span>
            <span className="font-mono font-bold">#{(o.id || "").slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Channel</span>
            <span>{o.channel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pembayaran</span>
            <span>{o.paymentMethod ?? "-"}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-lg">Rp {o.totalAmount.toLocaleString("id-ID")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={function () {
              printReceipt(o, props.cartItems, props.branchName);
            }}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" /> Cetak Struk
          </button>
          <button
            onClick={props.onNewTransaction}
            className="w-full h-10 rounded-md border text-sm font-medium"
          >
            Transaksi Baru
          </button>
          <button
            onClick={props.onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function ModifierModal(props: {
  item: MenuItem;
  initial: CartModifier[];
  initialNotes: string;
  onClose: () => void;
  onConfirm: (modifiers: CartModifier[], notes: string) => void;
}) {
  let _a = useState(props.initial);
  let selected = _a[0];
  let setSelected = _a[1];
  let _b = useState(props.initialNotes);
  let notes = _b[0];
  let setNotes = _b[1];

  function isSingleChoice(groupId: string): boolean {
    let grp = props.item.modifierGroups.find(function (g) {
      return g.modifierGroupId === groupId;
    });
    return (grp?.maxSelection ?? 1) === 1;
  }

  function toggleModifier(grp: ModifierGroup, mod: MenuItemModifier) {
    let groupSelected = selected.filter(function (s) {
      return s.groupId === grp.modifierGroupId;
    });
    let hasThis = groupSelected.some(function (s) {
      return s.modifierId === mod.id;
    });

    if (hasThis) {
      setSelected(
        selected.filter(function (s) {
          return s.modifierId !== mod.id;
        }),
      );
    } else if (isSingleChoice(grp.modifierGroupId)) {
      setSelected(
        selected
          .filter(function (s) {
            return s.groupId !== grp.modifierGroupId;
          })
          .concat([
            {
              groupId: grp.modifierGroupId,
              modifierId: mod.id,
              name: mod.name,
              price: mod.price,
              isExclusion: mod.isExclusion,
            },
          ]),
      );
    } else if (groupSelected.length < (grp.maxSelection ?? 99)) {
      setSelected(
        selected.concat([
          {
            groupId: grp.modifierGroupId,
            modifierId: mod.id,
            name: mod.name,
            price: mod.price,
            isExclusion: mod.isExclusion,
          },
        ]),
      );
    }
  }

  let modTotal = selected.reduce(function (s, m) {
    return s + m.price;
  }, 0);
  let totalPrice = props.item.basePrice + modTotal;

  let isValid = props.item.modifierGroups.every(function (grp) {
    let count = selected.filter(function (s) {
      return s.groupId === grp.modifierGroupId;
    }).length;
    return count >= (grp.minSelection ?? 0);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-4 sm:p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">{props.item.name}</h2>
            <p className="text-sm text-muted-foreground">
              Rp {props.item.basePrice.toLocaleString("id-ID")}
            </p>
          </div>
          <button
            onClick={props.onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {props.item.modifierGroups.map(function (grp) {
            let groupSelected = selected.filter(function (s) {
              return s.groupId === grp.modifierGroupId;
            });
            let required = (grp.minSelection ?? 0) > 0;
            let meetsMin = groupSelected.length >= (grp.minSelection ?? 0);
            return (
              <div key={grp.modifierGroupId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{grp.groupName ?? "Modifier"}</h3>
                  <span className="text-[10px] font-bold uppercase">
                    {required ? (
                      <span className="text-destructive">Wajib</span>
                    ) : (
                      <span className="text-muted-foreground">Opsional</span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      &bull; {grp.maxSelection === 1 ? "Pilih 1" : "Maks " + grp.maxSelection}
                    </span>
                  </span>
                </div>
                {!meetsMin && required && (
                  <p className="text-[10px] text-destructive">Pilih minimal {grp.minSelection}</p>
                )}
                <div className="space-y-1.5">
                  {grp.modifiers.map(function (mod) {
                    let isSel = groupSelected.some(function (s) {
                      return s.modifierId === mod.id;
                    });
                    let single = isSingleChoice(grp.modifierGroupId);
                    return (
                      <button
                        key={mod.id}
                        onClick={function () {
                          toggleModifier(grp, mod);
                        }}
                        className={
                          "w-full flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer " +
                          (isSel
                            ? mod.isExclusion
                              ? "bg-amber-50 border-amber-200 ring-1 ring-amber-200"
                              : "bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200"
                            : "bg-card border-border hover:bg-muted")
                        }
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={
                              "flex items-center justify-center transition-colors " +
                              (single
                                ? "w-5 h-5 rounded-full border-2" +
                                  (isSel ? " border-emerald-500" : " border-muted-foreground/30")
                                : "w-5 h-5 rounded border-2" +
                                  (isSel
                                    ? " border-emerald-500 bg-emerald-500"
                                    : " border-muted-foreground/30"))
                            }
                          >
                            {isSel &&
                              (single ? (
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                              ) : (
                                <svg
                                  className="w-3 h-3 text-white"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ))}
                          </div>
                          <span
                            className={
                              "text-sm font-medium " +
                              (isSel
                                ? mod.isExclusion
                                  ? "text-amber-900"
                                  : "text-emerald-900"
                                : "")
                            }
                          >
                            {mod.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {mod.price > 0 && !mod.isExclusion && (
                            <span className="text-xs font-bold text-emerald-600">
                              +Rp {mod.price.toLocaleString("id-ID")}
                            </span>
                          )}
                          {mod.isExclusion && (
                            <span className="text-xs font-bold text-amber-600">Exclude</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <label className="text-sm font-medium">Catatan</label>
            <textarea
              value={notes}
              onChange={function (e) {
                setNotes(e.target.value);
              }}
              placeholder="Contoh: Pisah sambal, jangan pakai sayur..."
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Total Tambahan</p>
              <p className="text-sm font-bold text-primary">
                Rp {modTotal.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Item</p>
              <p className="text-lg font-bold">Rp {totalPrice.toLocaleString("id-ID")}</p>
            </div>
          </div>

          <button
            onClick={function () {
              props.onConfirm(selected, notes);
            }}
            disabled={!isValid}
            className="w-full px-8 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Tambah ke Keranjang
          </button>
        </div>
      </div>
    </div>
  );
}
