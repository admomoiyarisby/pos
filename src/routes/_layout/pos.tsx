import { createFileRoute } from "@tanstack/react-router";
import { ORDER_CHANNEL_VALUES } from "#/db/schema";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import MoneyInput from "#/components/MoneyInput";
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
  getOrderWithItems,
  createCancelRequest,
  executeApprovedCancel,
  consumePrintRequest,
  getActiveRequestsForOrders,
} from "#/lib/server/pos";
import { getBrands } from "#/lib/server/brands";
import { getBranches } from "#/lib/server/branches";
import { getVouchers } from "#/lib/server/vouchers";
import { getInventory } from "#/lib/server/inventory";
import { getCategories } from "#/lib/server/categories";
import {
  ShoppingCart,
  Plus,
  Minus,
  X,
  TicketPercent,
  Percent,
  AlertCircle,
  History,
  UtensilsCrossed,
  Receipt,
  Store,
  Clock3,
} from "lucide-react";
import { usePageTitle } from "#/hooks/usePageTitle";

import type { CartModifier, CartItem, MenuItem, Voucher, OrderResult } from "#/lib/pos-types";
import { printReceipt, printBill } from "#/lib/pos-print";
import { getStockQuantity } from "#/lib/pos-utils";

import MenuGrid from "#/components/pos/MenuGrid";
import CartSidebar from "#/components/pos/CartSidebar";
import OrderHistory from "#/components/pos/OrderHistory";
import { default as SuccessModal } from "#/components/pos/SuccessModal";
import { default as ModifierModalComp } from "#/components/pos/ModifierModal";

const channels = [
  { key: "Dine-in", label: "Dine-in" },
  { key: "Gofood", label: "Gofood" },
  { key: "Grabfood", label: "Grabfood" },
  { key: "ShopeeFood", label: "ShopeeFood" },
  { key: "TikTok", label: "TikTok" },
];

export const Route = createFileRoute("/_layout/pos")({
  component: PosPage,
  loader: async () => {
    const [brandsData, branchesData, vouchersData, categoriesData] = await Promise.all([
      getBrands({ data: {} }),
      getBranches({ data: {} }),
      getVouchers({ data: { activeOnly: true } }),
      // Category tabs come from the categories table (single source of truth,
      // same as the recipe wizard); the legacy enum codes order the tabs and
      // the DB names label them.
      getCategories({}),
    ]);
    return {
      brands: brandsData,
      branches: branchesData,
      vouchers: vouchersData,
      categories: categoriesData,
    };
  },
});

// printReceipt, printBill, and getStockQuantity are now imported from #/lib/pos-print and #/lib/pos-utils

function PosPage() {
  usePageTitle("POS", "Titik Penjualan");

  let user = useAuth().user;
  let loaderData = Route.useLoaderData();
  let brands = loaderData.brands;
  let allBranches = loaderData.branches;
  let allVouchers = loaderData.vouchers;
  let dbCategories = loaderData.categories;
  let queryClient = useQueryClient();

  // Category display hierarchy for the POS — controls both the filter tabs and
  // the menu-grid section order (MenuGrid follows the tab order). Makanan and
  // Minuman always lead, Add-Ons is second-to-last and Jatah Makan Staff last;
  // any category not pinned here falls in the middle, alphabetically.
  const CATEGORY_PRIORITY = new Map<string, number>([
    ["makanan", 0],
    ["minuman", 1],
    ["add_ons", 100],
    ["jatah_makan_staff", 101],
  ]);
  const CATEGORY_MIDDLE_RANK = 50;

  // Build the category tabs from ALL categories table rows (keyed by category
  // id), with an "all categories" tab prepended. Filtering runs on
  // recipes.category_id, so non-enum categories like "Jatah Makan Staff" work.
  let categories = [
    { key: "", label: "Semua" },
    ...[...dbCategories]
      .sort(function (a, b) {
        const ra = CATEGORY_PRIORITY.get(a.code) ?? CATEGORY_MIDDLE_RANK;
        const rb = CATEGORY_PRIORITY.get(b.code) ?? CATEGORY_MIDDLE_RANK;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      })
      .map(function (c) {
        return { key: c.id, label: c.name };
      }),
  ];

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
  let _f = useState<(typeof ORDER_CHANNEL_VALUES)[number]>("Dine-in");
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
  let _p = useState(false);
  let confirmPaymentModal = _p[0];
  let setConfirmPaymentModal = _p[1];

  let _q = useState<{
    item: MenuItem;
    selectedModifiers: CartModifier[];
    itemNotes: string;
  } | null>(null);
  let modifierModal = _q[0];
  let setModifierModal = _q[1];

  let _r = useState<"open" | "close" | null>(null);
  let shiftModal = _r[0];
  let setShiftModal = _r[1];
  let _s = useState("");
  let cashFloat = _s[0];
  let setCashFloat = _s[1];
  let _t = useState("");
  let actualCash = _t[0];
  let setActualCash = _t[1];
  let _u = useState<{
    orderId: string;
    reason: string;
    mode?: "direct" | "request" | "execute";
    requestId?: string;
  } | null>(null);
  let voidModal = _u[0];
  let setVoidModal = _u[1];
  let _v = useState(false);
  let mobileCartOpen = _v[0];
  let setMobileCartOpen = _v[1];
  let _w = useState<"menu" | "cart" | "history">("menu");
  let mobileTab = _w[0];
  let setMobileTab = _w[1];
  // PB1 rate from branch config
  let pb1Rate = 11;
  let activeBranch = allBranches.find(function (b) {
    return b.id === activeBranchId;
  });
  if (activeBranch) {
    pb1Rate = activeBranch.pb1Rate;
  }

  let ordersResult = useQuery({
    queryKey: ["pos-recent-orders", activeBranchId],
    queryFn: function () {
      return getOrders({ data: { branchId: activeBranchId, limit: 20 } });
    },
    enabled: !!activeBranchId,
    retry: 1,
  });
  let recentOrders = ordersResult.data || [];

  // ─── Active Requests (print / cancel) polling ───
  let orderIds = recentOrders.map(function (o) {
    return o.id;
  });
  let activeRequestsResult = useQuery({
    queryKey: ["active-requests", orderIds],
    queryFn: function () {
      return getActiveRequestsForOrders({ data: { orderIds: orderIds } });
    },
    enabled: orderIds.length > 0,
    refetchInterval: 5000,
  });
  let activeRequestsData = activeRequestsResult.data ?? [];

  // Convert array to a record keyed by orderId for O(1) lookup
  let activeRequestsMap: Record<
    string,
    {
      print: { requestId: string; status: string } | null;
      cancel: { requestId: string; status: string; reason: string } | null;
    }
  > = {};
  for (let i = 0; i < activeRequestsData.length; i++) {
    let r = activeRequestsData[i];
    activeRequestsMap[r.orderId] = r;
  }

  // Server tracks consumed approvals — no client-side state needed

  // Fetch and print an approved reprint order
  async function printApprovedOrder(orderId: string) {
    const orderData = await getOrderWithItems({ data: { id: orderId } });
    if (!orderData) return;

    const branch = allBranches.find((b: any) => b.id === orderData.branchId);
    const branchName = branch?.name ?? "Cabang";

    const cartItems: CartItem[] = orderData.items.map((item: any) => ({
      recipeId: item.recipeId,
      brandId: undefined,
      name: item.recipeName ?? item.recipeId,
      price: item.price,
      quantity: item.quantity,
      modifiers: (item.modifiers ?? []).map((mName: string) => ({
        groupId: "",
        modifierId: "",
        name: mName,
        price: 0,
        isExclusion: false,
      })),
      notes: item.notes ?? "",
    }));

    const printOrder: OrderResult = {
      id: orderData.id,
      branchId: orderData.branchId,
      channel: orderData.channel,
      subtotal: orderData.subtotal,
      taxAmount: orderData.taxAmount ?? 0,
      totalAmount: orderData.totalAmount,
      totalCogs: orderData.totalCogs ?? 0,
      orderCode: orderData.orderCode,
      customerName: orderData.customerName,
      paymentMethod: orderData.paymentMethod,
      voucherCode: orderData.voucherCode,
      voucherDiscount: orderData.voucherDiscount,
      status: orderData.status,
      voidReason: orderData.voidReason,
      notes: orderData.notes,
      shiftId: orderData.shiftId,
      createdAt: orderData.createdAt,
      completedAt: orderData.completedAt,
    };

    printReceipt({ order: printOrder, cartItems: cartItems, branchName: branchName });
  }

  let menuResult = useQuery({
    queryKey: ["pos-menu", activeBranchId, selectedBrandId, selectedCategory, searchQuery],
    queryFn: function () {
      return getPosMenu({
        data: {
          branchId: activeBranchId || undefined,
          brandId: selectedBrandId || undefined,
          categoryId: selectedCategory || undefined,
          search: searchQuery || undefined,
        },
      });
    },
    retry: 1,
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
      return getInventory({ data: { branchId: activeBranchId, limit: 500 } });
    },
    enabled: !!activeBranchId,
  });
  let branchInventory = invResult.data?.data ?? [];

  let createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: function (order) {
      // SAFETY: createOrder returns the created order row, which carries every
      // OrderResult field (channel enum widens to string).
      setSuccessOrder(order as OrderResult);
      setMobileCartOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["pos-recent-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: function (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Transaksi gagal. Keranjang tetap tersimpan — coba lagi atau mulai transaksi baru.",
      );
    },
  });

  // Keyboard shortcuts for POS speed
  //
  // FEATURE FLAG: Number-key shortcuts (1–9) are disabled because they fire
  // even when focus is inside the search box or other inputs, causing unintended
  // add-to-cart actions while typing. The flag is here for a future harness
  // that will properly guard all keyboard shortcuts.
  //
  // To re-enable: set to true. Long-term fix: add an input-focus guard
  // (matching the Enter-key guard) and remove this flag.
  const ENABLE_POS_NUMBER_KEYS = false;

  useEffect(
    function () {
      function handleKeyDown(e: KeyboardEvent) {
        // Only active when no modal is open
        if (modifierModal || voidModal || shiftModal || successOrder) return;

        // Escape clears cart
        if (e.key === "Escape" && cart.length > 0 && !mobileCartOpen) {
          e.preventDefault();
          setCart([]);
          setCheckoutError(null);
          setStockError(null);
          return;
        }

        // Enter to checkout
        if (e.key === "Enter" && cart.length > 0 && activeShift && !createOrderMutation.isPending) {
          // Don't intercept if focus is in an input
          // SAFETY: keyboard events on the page originate from a DOM element;
          // non-Element targets simply don't match the tag checks below.
          var target = e.target as HTMLElement;
          if (
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT")
          )
            return;
          e.preventDefault();
          setConfirmPaymentModal(true);
          return;
        }

        // Forward slash focuses search
        if (e.key === "/" && !mobileCartOpen) {
          e.preventDefault();
          var searchInput = document.querySelector<HTMLInputElement>(
            'input[placeholder*="Cari menu"]',
          );
          if (searchInput) searchInput.focus();
        }

        // Number keys 1-9 map to first 9 visible menu items
        // (disabled via feature flag — see ENABLE_POS_NUMBER_KEYS)
        if (ENABLE_POS_NUMBER_KEYS) {
          var digit = parseInt(e.key);
          if (digit >= 1 && digit <= 9 && !mobileCartOpen) {
            var visibleItems = menuItems.filter(function (item) {
              return (
                item.ingredientIds.length === 0 ||
                getStockQuantity(item, branchInventory) >
                  cart
                    .filter(function (c) {
                      return c.recipeId === item.id;
                    })
                    .reduce(function (s, c) {
                      return s + c.quantity;
                    }, 0)
              );
            });
            if (digit <= visibleItems.length) {
              e.preventDefault();
              handleAddToCart(visibleItems[digit - 1]);
            }
          }
        }
      }

      document.addEventListener("keydown", handleKeyDown);
      return function () {
        document.removeEventListener("keydown", handleKeyDown);
      };
    },
    [
      modifierModal,
      voidModal,
      shiftModal,
      successOrder,
      mobileCartOpen,
      cart,
      activeShift,
      createOrderMutation.isPending,
      menuItems,
      branchInventory,
    ],
  );

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

  let cancelRequestMutation = useMutation({
    mutationFn: createCancelRequest,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["pos-recent-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["active-requests"] });
      setVoidModal(null);
      setCheckoutError(null);
    },
    onError: function (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Gagal mengajukan permintaan pembatalan",
      );
    },
  });

  let executeCancelMutation = useMutation({
    mutationFn: executeApprovedCancel,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["pos-recent-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["active-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setVoidModal(null);
    },
    onError: function (err) {
      setCheckoutError(err instanceof Error ? err.message : "Gagal menjalankan pembatalan");
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

  // Auto-select Online Payment for non Dine-In channels
  useEffect(
    function () {
      if (!isDineIn && paymentMethod !== "Online Payment") {
        setPaymentMethod("Online Payment");
      } else if (isDineIn && paymentMethod === "Online Payment") {
        setPaymentMethod("Cash");
      }
    },
    [channel],
  );

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
      // Staff meals display as Rp 0 but HPP is still calculated
      const displayPrice = item.isStaffMeal ? 0 : item.basePrice + modPrice;

      setCart(
        cart.concat([
          {
            recipeId: item.id,
            brandId: item.brands[0]?.id ?? undefined,
            name: item.name,
            price: displayPrice,
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

  // Wrappers for component callbacks
  function handleSearchChange(q: string) {
    setSearchQuery(q);
    setCheckoutError(null);
  }
  function handleCategoryChange(c: string) {
    setSelectedCategory(c);
    setCheckoutError(null);
  }
  function handleBrandChange(b: string) {
    setSelectedBrandId(b);
    setCheckoutError(null);
  }
  function handlePaymentMethodChange(m: string) {
    setPaymentMethod(m);
    setCheckoutError(null);
  }
  function handlePpnToggle(checked: boolean) {
    setPpnEnabled(checked);
  }
  function getStockForItem(item: MenuItem) {
    return getStockQuantity(item, branchInventory);
  }

  async function handleCheckout() {
    if (cart.length === 0 || !activeShift) return;
    setCheckoutError(null);
    setConfirmPaymentModal(true);
  }

  async function handleConfirmPayment() {
    if (cart.length === 0 || !activeShift) return;
    setConfirmPaymentModal(false);

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
          channel,
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
      console.error("Checkout error:", err);
      setCheckoutError(err instanceof Error ? err.message : "Transaksi gagal");
    }
  }

  let consumePrintMutation = useMutation({
    mutationFn: consumePrintRequest,
    onMutate: async function (vars) {
      await queryClient.cancelQueries({ queryKey: ["active-requests"] });
      let prev = queryClient.getQueryData(["active-requests", orderIds]);
      // Remove the consumed print request from cache by requestId
      queryClient.setQueryData(["active-requests", orderIds], function (old: any) {
        if (!old) return old;
        return old.map(function (r: any) {
          if (r.print?.requestId === vars.data.requestId) {
            return { ...r, print: null };
          }
          return r;
        });
      });
      return { prev };
    },
    onError: function (_err, _vars, context) {
      if (context?.prev != null) {
        queryClient.setQueryData(["active-requests", orderIds], context.prev);
      }
    },
    onSettled: function () {
      void queryClient.invalidateQueries({ queryKey: ["active-requests"] });
    },
  });

  let requestReprintMutation = useMutation({
    mutationFn: requestReprint,
    onSuccess: function () {
      void queryClient.invalidateQueries({ queryKey: ["active-requests"] });
    },
  });

  function handleReprint(orderId: string) {
    void requestReprintMutation.mutateAsync({
      data: { orderId: orderId, requestType: "reprint" },
    });
  }

  function handleVoid() {
    if (!voidModal) return;
    if (voidModal.mode === "execute" && voidModal.requestId) {
      // Cashier executing an approved cancel request
      void executeCancelMutation.mutateAsync({
        data: { requestId: voidModal.requestId },
      });
    } else if (voidModal.mode === "request") {
      // Cashier requesting cancel approval
      // SAFETY: the reason select is required and only offers the three
      // literal options; the submit button is disabled until one is chosen.
      void cancelRequestMutation.mutateAsync({
        data: {
          orderId: voidModal.orderId,
          reason: voidModal.reason as "Stok Habis" | "Salah Input" | "Customer Cancel",
        },
      });
    } else {
      // Admin direct void (no approval needed)
      void voidOrderMutation.mutateAsync({
        data: { orderId: voidModal.orderId, reason: voidModal.reason },
      });
    }
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
  let canRequestCancel = user?.role === "branch_admin";
  let canDirectPrint = !canRequestCancel; // super_admin, admin_pusat skip approval

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat", "branch_admin"]}>
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row lg:items-start lg:gap-6 -m-4 md:-m-6 overflow-hidden lg:overflow-visible">
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 p-4 md:p-6 min-h-0 overflow-hidden lg:overflow-visible">
          {/* ── Compact Top Bar — branch as floating legend, channel + shift on one row ── */}
          <div className="relative shrink-0 rounded-xl border bg-card px-3 pt-5 pb-2.5 md:px-4 md:pt-5 md:pb-2.5 mb-2.5 space-y-2.5">
            {/* Branch — floating legend overlapping border */}
            <div className="absolute -top-2.5 left-3 md:left-4 inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-sm max-w-[60%]">
              <Store className="h-3 w-3 text-muted-foreground shrink-0" />
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
                  className="h-5 bg-transparent border-0 p-0 pr-6 text-xs font-medium focus:ring-0 focus:outline-none min-w-0 truncate"
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
                <span className="truncate">{userBranch?.name ?? "Unknown"}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={channel}
                onChange={function (e) {
                  // SAFETY: select only renders ORDER_CHANNEL_VALUES options
                  setChannel(e.target.value as (typeof ORDER_CHANNEL_VALUES)[number]);
                  setCheckoutError(null);
                }}
                className="h-8 flex-1 min-w-[140px] sm:flex-none sm:min-w-[160px] rounded-full border border-input bg-background px-3 text-sm font-medium"
              >
                {channels.map(function (c) {
                  return (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  );
                })}
              </select>
              {/* Shift — same row as channel, ml-auto pushes to right */}
              {activeShift ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border bg-emerald-500/10 border-emerald-500/20 p-1 pl-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Aktif
                  </span>
                  <button
                    onClick={function () {
                      setShiftModal("close");
                    }}
                    className="h-7 shrink-0 whitespace-nowrap rounded-full bg-card border px-3 text-xs font-medium hover:bg-muted"
                  >
                    Tutup
                  </button>
                </span>
              ) : (
                <button
                  onClick={function () {
                    setShiftModal("open");
                  }}
                  className="ml-auto inline-flex items-center gap-1.5 h-8 shrink-0 whitespace-nowrap rounded-full bg-primary text-primary-foreground px-3.5 text-xs font-medium shadow-sm"
                >
                  <Clock3 className="h-3 w-3" />
                  Buka Shift
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative flex-1 md:max-w-[360px]">
                {channel === "Dine-in" ? (
                  <input
                    placeholder="Nama Pelanggan (opsional)"
                    value={customerName}
                    onChange={function (e) {
                      setCustomerName(e.target.value);
                    }}
                    className="h-9 w-full rounded-full border border-input bg-background px-3.5 text-sm"
                  />
                ) : (
                  <input
                    placeholder="Kode Order (Gofood / Grab / Shopee...)"
                    value={orderCode}
                    onChange={function (e) {
                      setOrderCode(e.target.value);
                    }}
                    className="h-9 w-full rounded-full border border-input bg-background px-3.5 text-sm"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Desktop MenuGrid ── */}
          <div className="hidden lg:block">
            <MenuGrid
              menuItems={menuItems}
              onAddToCart={handleAddToCart}
              getStockQuantity={getStockForItem}
              cart={cart}
              selectedBrandId={selectedBrandId}
              selectedCategory={selectedCategory}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              onCategoryChange={handleCategoryChange}
              onBrandChange={handleBrandChange}
              categories={categories}
              brands={brands}
              cartTotal={cartTotal}
              voucherDiscount={voucherDiscount}
              taxAmount={taxAmount}
              finalTotal={finalTotal}
              ppnEnabled={ppnEnabled}
              pb1Rate={pb1Rate}
              channel={channel}
              isDineIn={isDineIn}
            />
          </div>
          {/* ── Mobile Tab Contents ── */}
          <div className="flex lg:hidden flex-1 flex-col min-h-0 overflow-hidden">
            {mobileTab === "menu" && (
              <div className={"flex-1 overflow-y-auto " + (cartCount > 0 ? "pb-32" : "pb-20")}>
                <MenuGrid
                  menuItems={menuItems}
                  onAddToCart={handleAddToCart}
                  getStockQuantity={getStockForItem}
                  cart={cart}
                  selectedBrandId={selectedBrandId}
                  selectedCategory={selectedCategory}
                  searchQuery={searchQuery}
                  onSearchChange={handleSearchChange}
                  onCategoryChange={handleCategoryChange}
                  onBrandChange={handleBrandChange}
                  categories={categories}
                  brands={brands}
                  cartTotal={cartTotal}
                  voucherDiscount={voucherDiscount}
                  taxAmount={taxAmount}
                  finalTotal={finalTotal}
                  ppnEnabled={ppnEnabled}
                  pb1Rate={pb1Rate}
                  channel={channel}
                  isDineIn={isDineIn}
                />
              </div>
            )}
            {mobileTab === "cart" && (
              <div className="flex-1 overflow-y-auto space-y-3 p-1 pb-20">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-3">
                      <ShoppingCart className="h-7 w-7 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm font-medium">Keranjang kosong</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Pilih menu untuk memulai pesanan
                    </p>
                    <button
                      onClick={function () {
                        setMobileTab("menu");
                      }}
                      className="mt-4 h-9 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium"
                    >
                      Lihat Menu
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {cart.map(function (item, idx) {
                        return (
                          <div key={idx} className="rounded-xl border bg-card p-3 flex gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium leading-tight">{item.name}</p>
                              {item.modifiers.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {item.modifiers.map(function (m, mi) {
                                    return (
                                      <span
                                        key={mi}
                                        className={
                                          "text-[10px] px-1.5 py-0.5 rounded-full border " +
                                          (m.isExclusion
                                            ? "bg-destructive/10 text-destructive border-destructive/20"
                                            : "bg-primary/10 text-primary border-primary/20")
                                        }
                                      >
                                        {m.isExclusion ? "Tanpa " : ""}
                                        {m.name}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {item.notes && (
                                <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                                  \u201C{item.notes}\u201D
                                </p>
                              )}
                              <p className="text-sm font-semibold text-primary mt-1">
                                Rp {(item.price * item.quantity).toLocaleString("id-ID")}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <button
                                onClick={function () {
                                  removeItem(idx);
                                }}
                                className="h-7 w-7 rounded-full border flex items-center justify-center text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <div className="flex items-center gap-1 rounded-full border bg-muted/30 p-1">
                                <button
                                  onClick={function () {
                                    updateQty(idx, -1);
                                  }}
                                  className="h-7 w-7 rounded-full bg-card border flex items-center justify-center shadow-sm"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span
                                  key={item.quantity}
                                  className="w-7 text-center text-sm font-semibold"
                                >
                                  {item.quantity}
                                </span>
                                <button
                                  onClick={function () {
                                    updateQty(idx, 1);
                                  }}
                                  className="h-7 w-7 rounded-full bg-card border flex items-center justify-center shadow-sm"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="rounded-xl border bg-card p-3 space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Catatan Order
                      </label>
                      <textarea
                        value={orderNotes}
                        onChange={function (e) {
                          setOrderNotes(e.target.value);
                        }}
                        placeholder="Catatan untuk dapur / kasir..."
                        className="w-full rounded-xl border bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
                      />
                    </div>
                    {allVouchers.length > 0 && (
                      <div className="rounded-xl border bg-card p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <TicketPercent className="h-3.5 w-3.5" /> Voucher
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
                                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs " +
                                  (isSelected
                                    ? "border-primary bg-primary text-primary-foreground font-semibold"
                                    : meetsMinOrder
                                      ? "bg-card hover:border-primary/50"
                                      : "opacity-40 cursor-not-allowed")
                                }
                              >
                                <Percent className="h-3 w-3" />
                                {v.code}
                                <span
                                  className={
                                    isSelected
                                      ? "text-primary-foreground/80"
                                      : "text-muted-foreground"
                                  }
                                >
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
                    <div className="rounded-xl border bg-card p-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium">Rp {cartTotal.toLocaleString("id-ID")}</span>
                      </div>
                      {voucherDiscount > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Diskon</span>
                          <span className="font-medium text-primary">
                            -Rp {voucherDiscount.toLocaleString("id-ID")}
                          </span>
                        </div>
                      )}
                      {isDineIn && pb1Rate > 0 && (
                        <label className="flex items-center justify-between py-1 cursor-pointer">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={ppnEnabled}
                              onChange={function (e) {
                                handlePpnToggle(e.target.checked);
                              }}
                              className="h-4 w-4 rounded border-input"
                            />{" "}
                            PB1 {pb1Rate}%
                          </span>
                          {taxAmount > 0 && (
                            <span className="text-sm text-muted-foreground">
                              +Rp {taxAmount.toLocaleString("id-ID")}
                            </span>
                          )}
                        </label>
                      )}
                      <div className="flex justify-between text-base font-bold border-t pt-2">
                        <span>Total</span>
                        <span>Rp {finalTotal.toLocaleString("id-ID")}</span>
                      </div>
                      {isDineIn ? (
                        <select
                          value={paymentMethod}
                          onChange={function (e) {
                            handlePaymentMethodChange(e.target.value);
                          }}
                          className="h-9 w-full rounded-full border bg-background px-3 text-sm"
                        >
                          <option value="Cash">Cash / Tunai</option>
                          <option value="QRIS">QRIS</option>
                          <option value="Transfer">Transfer</option>
                        </select>
                      ) : (
                        <div className="h-9 w-full rounded-full border bg-muted px-3 text-sm flex items-center text-muted-foreground">
                          Online Payment
                        </div>
                      )}
                      {cart.length > 0 && (
                        <button
                          onClick={function () {
                            printBill({
                              cartItems: cart,
                              branchName: userBranch?.name ?? "Cabang",
                              subtotal: cartTotal,
                              voucherDiscount: voucherDiscount,
                              taxAmount: taxAmount,
                              finalTotal: finalTotal,
                              customerName: customerName || undefined,
                              orderCode: orderCode || undefined,
                            });
                          }}
                          className="w-full h-9 rounded-full border border-dashed text-sm font-medium text-muted-foreground hover:bg-muted flex items-center justify-center gap-1.5"
                        >
                          <Receipt className="h-3.5 w-3.5" /> Cetak Tagihan
                        </button>
                      )}
                      <button
                        onClick={handleCheckout}
                        disabled={
                          cart.length === 0 || !activeShift || createOrderMutation.isPending
                        }
                        className="w-full h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-sm disabled:opacity-50"
                      >
                        {createOrderMutation.isPending
                          ? "Memproses..."
                          : isDineIn
                            ? "Bayar Rp " + finalTotal.toLocaleString("id-ID")
                            : "Konfirmasi Pesanan"}
                      </button>
                      {!activeShift && (
                        <p className="text-xs text-center text-destructive">
                          Buka shift terlebih dahulu
                        </p>
                      )}
                      {checkoutError && (
                        <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-medium">Gagal</p>
                            <p className="text-xs opacity-80">{checkoutError}</p>
                          </div>
                          <button
                            onClick={function () {
                              setCheckoutError(null);
                            }}
                            className="shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      {stockError && (
                        <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" />
                          <span className="flex-1">{stockError}</span>
                          <button
                            onClick={function () {
                              setStockError(null);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {mobileTab === "history" && (
              <div className="flex-1 overflow-y-auto pb-20">
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="px-3 py-2 border-b bg-muted/20 flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <History className="h-4 w-4" /> Riwayat Pesanan
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {recentOrders.length} pesanan
                    </span>
                  </div>
                  <div className="divide-y max-h-[60vh] overflow-y-auto md:max-h-none">
                    {recentOrders.length === 0 ? (
                      <div className="py-12 text-center">
                        <History className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground">Belum ada pesanan</p>
                      </div>
                    ) : (
                      recentOrders.map(function (o) {
                        const isVoid = o.status === "Void";
                        const req = activeRequestsMap[o.id];
                        const printStatus = req?.print?.status ?? null;
                        const cancelStatus = req?.cancel?.status ?? null;
                        const printState = canDirectPrint
                          ? "direct"
                          : isVoid
                            ? "hidden"
                            : printStatus === "Approved"
                              ? "active"
                              : printStatus === "Pending"
                                ? "pending"
                                : "neutral";
                        const cancelState = isVoid
                          ? "hidden"
                          : cancelStatus === "Approved"
                            ? "active"
                            : cancelStatus === "Pending"
                              ? "pending"
                              : "neutral";
                        return (
                          <div key={o.id} className="flex items-center justify-between px-3 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded font-medium">
                                  #{(o.id || "").slice(0, 6).toUpperCase()}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(o.createdAt).toLocaleTimeString("id-ID", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {isVoid && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-bold">
                                    VOID
                                  </span>
                                )}
                                {!isVoid && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border text-muted-foreground">
                                    {o.status}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                {o.channel} • {o.orderCode || o.customerName || "-"}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="text-sm font-semibold">
                                Rp {o.totalAmount.toLocaleString("id-ID")}
                              </span>
                              {printState !== "hidden" && (
                                <button
                                  onClick={function () {
                                    if (canDirectPrint) {
                                      void printApprovedOrder(o.id);
                                      return;
                                    }
                                    let rs = printStatus;
                                    let rid = req?.print?.requestId;
                                    if (rs === "Approved") {
                                      if (rid)
                                        void consumePrintMutation.mutateAsync({
                                          data: { requestId: rid },
                                        });
                                      void printApprovedOrder(o.id);
                                    } else if (!rs || rs === "Rejected") handleReprint(o.id);
                                  }}
                                  disabled={printState === "pending"}
                                  className={
                                    "h-8 w-8 inline-flex items-center justify-center rounded-full border " +
                                    (printState === "direct" || printState === "active"
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : printState === "pending"
                                        ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
                                        : "bg-card")
                                  }
                                >
                                  <Receipt className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {!canVoid && canRequestCancel && cancelState !== "hidden" && (
                                <button
                                  onClick={function () {
                                    let cs = cancelStatus;
                                    if (cs === "Approved" && req?.cancel?.requestId)
                                      setVoidModal({
                                        orderId: o.id,
                                        reason: req?.cancel?.reason ?? "",
                                        mode: "execute",
                                        requestId: req.cancel.requestId,
                                      });
                                    else if (!cs || cs === "Rejected")
                                      setVoidModal({ orderId: o.id, reason: "", mode: "request" });
                                  }}
                                  disabled={cancelState === "pending"}
                                  className={
                                    "h-8 px-2 inline-flex items-center justify-center rounded-full border text-xs font-medium " +
                                    (cancelState === "active"
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : cancelState === "pending"
                                        ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
                                        : "border-destructive/30 text-destructive")
                                  }
                                >
                                  {cancelState === "pending"
                                    ? "..."
                                    : cancelState === "active"
                                      ? "Batal"
                                      : "Btl"}
                                </button>
                              )}
                              {canVoid && !isVoid && (
                                <button
                                  onClick={function () {
                                    setVoidModal({ orderId: o.id, reason: "" });
                                  }}
                                  className="h-8 w-8 inline-flex items-center justify-center rounded-full border text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
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
            )}
          </div>
          {/* Mobile Tabs — floating, follows sidebar */}
          <div className="fixed bottom-0 right-0 z-30 flex lg:hidden border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 p-2 pb-[max(8px,env(safe-area-inset-bottom))] left-0 md:left-[var(--sidebar-width)]">
            <div className="inline-flex w-full p-1 bg-muted rounded-full gap-1">
              <button
                onClick={function () {
                  setMobileTab("menu");
                }}
                aria-label="Menu"
                title="Menu"
                className={
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-2 min-h-[44px] text-sm font-medium transition-colors " +
                  (mobileTab === "menu"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground")
                }
              >
                <UtensilsCrossed className="h-4 w-4" />
                <span className="sr-only">Menu</span>
              </button>
              <button
                onClick={function () {
                  setMobileTab("cart");
                }}
                aria-label={"Keranjang" + (cartCount > 0 ? " (" + cartCount + ")" : "")}
                title="Keranjang"
                className={
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-2 min-h-[44px] text-sm font-medium transition-colors relative " +
                  (mobileTab === "cart"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground")
                }
              >
                <ShoppingCart className="h-4 w-4" />
                <span className="sr-only">Keranjang</span>
                {cartCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-1">
                    {cartCount}
                  </span>
                )}
              </button>
              <button
                onClick={function () {
                  setMobileTab("history");
                }}
                aria-label={
                  "Riwayat" + (recentOrders.length > 0 ? " (" + recentOrders.length + ")" : "")
                }
                title="Riwayat"
                className={
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-2 min-h-[44px] text-sm font-medium transition-colors relative " +
                  (mobileTab === "history"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground")
                }
              >
                <History className="h-4 w-4" />
                <span className="sr-only">Riwayat</span>
                {recentOrders.length > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted-foreground/10 text-muted-foreground text-[11px] font-bold px-1">
                    {recentOrders.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Cart Sidebar — Desktop */}
        <CartSidebar
          cart={cart}
          cartCount={cartCount}
          cartTotal={cartTotal}
          voucherDiscount={voucherDiscount}
          taxAmount={taxAmount}
          finalTotal={finalTotal}
          ppnEnabled={ppnEnabled}
          pb1Rate={pb1Rate}
          channel={channel}
          isDineIn={isDineIn}
          paymentMethod={paymentMethod}
          selectedVoucher={selectedVoucher}
          allVouchers={allVouchers}
          checkoutError={checkoutError}
          stockError={stockError}
          activeShift={activeShift}
          createOrderPending={createOrderMutation.isPending}
          onRemoveItem={removeItem}
          onUpdateQty={updateQty}
          onToggleVoucher={toggleVoucher}
          onPaymentMethodChange={handlePaymentMethodChange}
          onCheckout={handleCheckout}
          onPrintBill={function () {
            printBill({
              cartItems: cart,
              branchName: userBranch?.name ?? "Cabang",
              subtotal: cartTotal,
              voucherDiscount: voucherDiscount,
              taxAmount: taxAmount,
              finalTotal: finalTotal,
              customerName: customerName || undefined,
              orderCode: orderCode || undefined,
            });
          }}
          onClearError={function () {
            setCheckoutError(null);
          }}
          onClearStockError={function () {
            setStockError(null);
          }}
          onPpnToggle={handlePpnToggle}
        >
          <OrderHistory
            recentOrders={recentOrders}
            canVoid={canVoid}
            canRequestCancel={canRequestCancel}
            canDirectPrint={canDirectPrint}
            activeRequests={activeRequestsMap}
            onPrintClick={function (orderId: string) {
              if (canDirectPrint) {
                void printApprovedOrder(orderId);
                return;
              }
              let req = activeRequestsMap[orderId];
              let printStatus = req?.print?.status;
              let printRequestId = req?.print?.requestId;
              if (printStatus === "Approved") {
                if (printRequestId) {
                  void consumePrintMutation.mutateAsync({
                    data: { requestId: printRequestId },
                  });
                }
                void printApprovedOrder(orderId);
              } else if (!printStatus || printStatus === "Rejected") {
                handleReprint(orderId);
              }
            }}
            onCancelClick={function (orderId: string) {
              // State machine: null → open modal, Pending → no-op, Approved → open execute modal
              let req = activeRequestsMap[orderId];
              let cancelStatus = req?.cancel?.status;
              if (cancelStatus === "Approved" && req?.cancel?.requestId) {
                setVoidModal({
                  orderId: orderId,
                  reason: req?.cancel?.reason ?? "",
                  mode: "execute",
                  requestId: req.cancel.requestId,
                });
              } else if (!cancelStatus || cancelStatus === "Rejected") {
                setVoidModal({ orderId: orderId, reason: "", mode: "request" });
              }
              // Pending → no-op
            }}
            onDirectVoid={function (orderId: string) {
              setVoidModal({ orderId: orderId, reason: "" });
            }}
          />
        </CartSidebar>
      </div>

      {/* Payment Confirmation Modal */}
      <Modal
        open={confirmPaymentModal}
        onClose={function () {
          setConfirmPaymentModal(false);
        }}
        title="Konfirmasi Pembayaran"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-muted p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Channel</span>
              <span className="font-medium">{channel}</span>
            </div>
            {channel !== "Dine-in" && orderCode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kode Order</span>
                <span className="font-medium">{orderCode}</span>
              </div>
            )}
            {channel === "Dine-in" && customerName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pelanggan</span>
                <span className="font-medium">{customerName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jumlah Item</span>
              <span className="font-medium">{cart.length} item</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Metode Pembayaran</span>
              <span className="font-medium">{paymentMethod}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="font-semibold">Total</span>
              <span className="font-bold text-lg text-primary">
                Rp {finalTotal.toLocaleString("id-ID")}
              </span>
            </div>
          </div>

          {voucherDiscount > 0 && (
            <div className="rounded-md bg-primary/5 border border-primary/10 px-4 py-2 text-sm flex items-center gap-2">
              <TicketPercent className="h-4 w-4 text-primary" />
              <span>
                Diskon <strong>{selectedVoucher?.code}</strong>: - Rp{" "}
                {voucherDiscount.toLocaleString("id-ID")}
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Pastikan pesanan sudah benar sebelum melanjutkan pembayaran.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={function () {
                setConfirmPaymentModal(false);
              }}
              className="h-10 px-6 rounded-md border text-sm font-medium"
            >
              Batal
            </button>
            <button
              onClick={handleConfirmPayment}
              disabled={createOrderMutation.isPending}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {createOrderMutation.isPending ? "Memproses..." : isDineIn ? "Bayar" : "Konfirmasi"}
            </button>
          </div>
        </div>
      </Modal>

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
        onPrintReceipt={function (order, cartItems, branchName) {
          printReceipt({ order: order, cartItems: cartItems, branchName: branchName });
        }}
      />

      {/* Void / Cancel Request Modal */}
      <Modal
        open={!!voidModal}
        onClose={function () {
          setVoidModal(null);
        }}
        title={
          voidModal?.mode === "request"
            ? "Minta Pembatalan"
            : voidModal?.mode === "execute"
              ? "Eksekusi Pembatalan"
              : "Batalkan Pesanan"
        }
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {voidModal?.mode === "request"
              ? "Ajukan permintaan pembatalan pesanan ini. Area Manager akan menyetujui atau menolak permintaan Anda."
              : voidModal?.mode === "execute"
                ? "Apakah Anda yakin ingin membatalkan pesanan ini? Permintaan telah disetujui oleh Area Manager. Stok bahan baku akan dikembalikan."
                : "Apakah Anda yakin ingin membatalkan pesanan ini? Stok bahan baku akan dikembalikan."}
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alasan Pembatalan</label>
            {voidModal?.mode === "request" ? (
              <select
                value={voidModal?.reason ?? ""}
                onChange={function (e) {
                  setVoidModal(function (prev) {
                    return prev ? { ...prev, reason: e.target.value } : null;
                  });
                }}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Pilih alasan...
                </option>
                <option value="Stok Habis">Stok Habis</option>
                <option value="Salah Input">Salah Input</option>
                <option value="Customer Cancel">Customer Cancel</option>
              </select>
            ) : (
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
                readOnly={voidModal?.mode === "execute"}
              />
            )}
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
              disabled={
                !voidModal?.reason ||
                voidOrderMutation.isPending ||
                cancelRequestMutation.isPending ||
                executeCancelMutation.isPending
              }
              className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
            >
              {voidOrderMutation.isPending ||
              cancelRequestMutation.isPending ||
              executeCancelMutation.isPending
                ? "Memproses..."
                : voidModal?.mode === "request"
                  ? "Ajukan Permintaan"
                  : "Batalkan Pesanan"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modifier Modal */}
      {modifierModal && (
        <ModifierModalComp
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
            <MoneyInput
              value={cashFloat ? Number(cashFloat) : null}
              onChange={(raw) => setCashFloat(raw === null ? "" : String(raw))}
              placeholder="0"
              autoFocus
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <MoneyInput
              value={actualCash ? Number(actualCash) : null}
              onChange={(raw) => setActualCash(raw === null ? "" : String(raw))}
              placeholder="0"
              autoFocus
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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

      {/* Mobile sticky cart bar — thumb-reach when browsing menu */}
      {cartCount > 0 && mobileTab === "menu" && (
        <div className="fixed bottom-[68px] left-3 right-3 z-30 flex items-center justify-between rounded-full bg-primary text-primary-foreground shadow-lg pl-3 pr-1.5 py-1.5 lg:hidden safe-inset">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <ShoppingCart className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold leading-none">{cartCount} item</p>
              <p className="text-xs opacity-80 leading-none">
                Rp {finalTotal.toLocaleString("id-ID")}
              </p>
            </div>
          </div>
          <button
            onClick={function () {
              setMobileTab("cart");
            }}
            className="h-9 px-5 rounded-full bg-white text-primary text-sm font-semibold shadow-sm"
          >
            Lihat
          </button>
        </div>
      )}
    </RoleGuard>
  );
}
