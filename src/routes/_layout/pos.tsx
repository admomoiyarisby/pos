import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "#/lib/auth-context";
import RoleGuard from "#/components/RoleGuard";
import Modal from "#/components/ui/Modal";
import { getPosMenu, createOrder, getShiftStatus, openShift, closeShift } from "#/lib/server/pos";
import { getBrands } from "#/lib/server/brands";
import { Search, ShoppingCart, Trash2, Plus, Minus, X, Clock } from "lucide-react";
import { Badge } from "#/components/ui/badge";

interface CartItem {
  recipeId: string;
  brandId: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: { groupId: string; modifierId: string; name: string; price: number }[];
  notes: string;
}

interface ModifierGroup {
  modifierGroupId: string;
  groupName: string | null;
  minSelection: number | null;
  maxSelection: number | null;
  modifiers: { id: string; name: string; price: number; isExclusion: boolean }[];
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
    const brands = await getBrands({ data: {} });
    return { brands };
  },
});

function PosPage() {
  const { user } = useAuth();
  const { brands } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const branchId = user?.branchId ?? "";

  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [channel, setChannel] = useState("Dine-in");
  const [customerName, setCustomerName] = useState("");
  const [orderCode, setOrderCode] = useState("");
  const [, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const [modifierModal, setModifierModal] = useState<{
    item: MenuItem;
    selectedModifiers: { groupId: string; modifierId: string; name: string; price: number }[];
    itemNotes: string;
  } | null>(null);

  const [shiftModal, setShiftModal] = useState<"open" | "close" | null>(null);
  const [cashFloat, setCashFloat] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [lastOrders, setLastOrders] = useState<
    { id: string; total: number; items: string; time: string }[]
  >([]);

  const { data: menuItems = [] } = useQuery({
    queryKey: ["pos-menu", branchId, selectedBrandId, selectedCategory, searchQuery],
    queryFn: () =>
      getPosMenu({
        data: {
          branchId,
          brandId: selectedBrandId || undefined,
          category: selectedCategory || undefined,
          search: searchQuery || undefined,
        },
      }),
    enabled: !!branchId,
  });

  const { data: activeShift } = useQuery({
    queryKey: ["shift", branchId, user?.id],
    queryFn: () => getShiftStatus({ data: { branchId, userId: user?.id ?? "" } }),
    enabled: !!branchId && !!user?.id,
  });

  const createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      setCart([]);
      setCustomerName("");
      setOrderCode("");
      setNotes("");
      // Add to last orders
      setLastOrders((prev) => [
        {
          id: order.id,
          total: order.totalAmount,
          items: cart.map((i) => `${i.quantity}x ${i.name}`).join(", "),
          time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        },
        ...prev.slice(0, 2),
      ]);
      void queryClient.invalidateQueries({ queryKey: ["pos-menu"] });
    },
  });

  const openShiftMutation = useMutation({
    mutationFn: openShift,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shift"] });
      setShiftModal(null);
      setCashFloat("");
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: closeShift,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shift"] });
      setShiftModal(null);
      setActualCash("");
    },
  });

  const handleAddToCart = (item: MenuItem) => {
    if (item.modifierGroups.length > 0) {
      setModifierModal({
        item,
        selectedModifiers: [],
        itemNotes: "",
      });
    } else {
      addItemToCart(item, [], "");
    }
  };

  const addItemToCart = (item: MenuItem, modifiers: CartItem["modifiers"], itemNotes: string) => {
    const modPrice = modifiers.reduce((sum, m) => sum + m.price, 0);
    const existingIdx = cart.findIndex(
      (c) =>
        c.recipeId === item.id &&
        c.notes === itemNotes &&
        JSON.stringify(c.modifiers.map((m) => m.modifierId).sort()) ===
          JSON.stringify(modifiers.map((m) => m.modifierId).sort()),
    );

    if (existingIdx >= 0) {
      const updated = [...cart];
      updated[existingIdx].quantity += 1;
      setCart(updated);
    } else {
      setCart([
        ...cart,
        {
          recipeId: item.id,
          brandId: item.brands[0]?.id ?? "",
          name: item.name,
          price: item.basePrice + modPrice,
          quantity: 1,
          modifiers,
          notes: itemNotes,
        },
      ]);
    }
    setModifierModal(null);
  };

  const updateQty = (idx: number, delta: number) => {
    const updated = [...cart];
    updated[idx].quantity = Math.max(1, updated[idx].quantity + delta);
    setCart(updated);
  };

  const removeItem = (idx: number) => {
    setCart(cart.filter((_, i) => i !== idx));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckout = () => {
    if (cart.length === 0 || !activeShift) return;
    const items = cart.map((c) => ({
      recipeId: c.recipeId,
      brandId: c.brandId,
      quantity: c.quantity,
      price: c.price,
      selectedModifiers: c.modifiers.map((m) => ({
        groupId: m.groupId,
        modifierId: m.modifierId,
        price: m.price,
      })),
      notes: c.notes,
    }));
    void createOrderMutation.mutateAsync({
      data: {
        branchId,
        channel: channel as "Dine-in" | "Gofood" | "Grabfood" | "ShopeeFood",
        customerName: channel === "Dine-in" ? customerName : undefined,
        orderCode: channel !== "Dine-in" ? orderCode : undefined,
        items,
        paymentMethod,
        shiftId: activeShift.id,
      },
    });
  };

  const handleOpenShift = () => {
    if (!cashFloat || !user) return;
    void openShiftMutation.mutateAsync({
      data: {
        branchId,
        userId: user.id,
        cashFloat: Number(cashFloat),
      },
    });
  };

  const handleCloseShift = () => {
    if (!actualCash || !activeShift) return;
    void closeShiftMutation.mutateAsync({
      data: {
        shiftId: activeShift.id,
        actualCash: Number(actualCash),
      },
    });
  };

  return (
    <RoleGuard allowedRoles={["super_admin", "branch_admin"]}>
      <div className="flex h-[calc(100vh-3rem)] -m-6">
        {/* Main Content */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* Top Bar */}
          <div className="flex items-center gap-3 mb-4 shrink-0">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {channel === "Dine-in" ? (
              <input
                placeholder="Nama Pelanggan"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-9 flex-1 max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
            ) : (
              <input
                placeholder="Kode Order"
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                className="h-9 flex-1 max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              {activeShift ? (
                <button
                  onClick={() => setShiftModal("close")}
                  className="h-9 px-3 rounded-md border text-sm text-muted-foreground hover:bg-muted"
                >
                  Tutup Shift
                </button>
              ) : (
                <button
                  onClick={() => setShiftModal("open")}
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
              onClick={() => setSelectedBrandId("")}
              className={`h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedBrandId === "" ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
            >
              Semua Brand
            </button>
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBrandId(b.id)}
                className={`h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedBrandId === b.id ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
              >
                {b.name}
              </button>
            ))}
          </div>

          {/* Category + Search */}
          <div className="flex items-center gap-3 mb-4 shrink-0">
            <div className="flex gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${selectedCategory === cat.key ? "bg-secondary text-secondary-foreground" : "border hover:bg-muted"}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-xs ml-auto">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
              />
            </div>
          </div>

          {/* Menu Grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleAddToCart(item)}
                  className="group relative rounded-lg border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-sm"
                >
                  <div className="aspect-square mb-2 rounded-md bg-muted flex items-center justify-center">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-cover rounded-md"
                      />
                    ) : (
                      <span className="text-2xl">🍱</span>
                    )}
                  </div>
                  <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
                  <p className="text-sm font-semibold text-primary mt-1">
                    Rp {item.basePrice.toLocaleString("id-ID")}
                  </p>
                  {item.modifierGroups.length > 0 && (
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      + Modifiers
                    </Badge>
                  )}
                </button>
              ))}
            </div>
            {menuItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Menu tidak ditemukan</p>
              </div>
            )}
          </div>
        </div>

        {/* Cart Sidebar */}
        <div className="w-80 border-l bg-card flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="h-5 w-5" />
              <h2 className="font-semibold">Keranjang</h2>
              {cartCount > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  {cartCount} item
                </Badge>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Keranjang kosong</p>
                <p className="text-xs">Pilih menu untuk memulai</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.name}</p>
                      {item.modifiers.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {item.modifiers.map((m, mi) => (
                            <p key={mi} className="text-xs text-muted-foreground">
                              + {m.name}
                            </p>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">"{item.notes}"</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQty(idx, -1)}
                        className="h-7 w-7 rounded-md border flex items-center justify-center text-xs"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(idx, 1)}
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
              ))
            )}
          </div>

          <div className="border-t p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">Rp {cartTotal.toLocaleString("id-ID")}</span>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Metode Pembayaran</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Cash">Cash / Tunai</option>
                <option value="QRIS">QRIS</option>
                <option value="Transfer">Transfer</option>
              </select>
            </div>
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || !activeShift || createOrderMutation.isPending}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createOrderMutation.isPending ? "Memproses..." : "Bayar"}
            </button>
            {!activeShift && (
              <p className="text-xs text-center text-destructive">Buka shift terlebih dahulu</p>
            )}
          </div>

          {/* Last Orders */}
          {lastOrders.length > 0 && (
            <div className="border-t p-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Pesanan Terakhir
              </h3>
              <div className="space-y-2">
                {lastOrders.slice(0, 3).map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">{o.time}</span>
                      <span className="truncate max-w-[120px]">{o.items}</span>
                    </div>
                    <span className="font-medium">Rp {o.total.toLocaleString("id-ID")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modifier Modal */}
      {modifierModal && (
        <ModifierModal
          modal={modifierModal}
          onClose={() => setModifierModal(null)}
          onConfirm={(modifiers, notes) => addItemToCart(modifierModal.item, modifiers, notes)}
        />
      )}

      {/* Shift Modals */}
      <Modal open={shiftModal === "open"} onClose={() => setShiftModal(null)} title="Buka Shift">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Modal Awal Laci (Rp)</label>
            <input
              type="number"
              min={0}
              value={cashFloat}
              onChange={(e) => setCashFloat(e.target.value)}
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

      <Modal open={shiftModal === "close"} onClose={() => setShiftModal(null)} title="Tutup Shift">
        <div className="space-y-4">
          {activeShift && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p>Modal Awal: Rp {activeShift.cashFloat.toLocaleString("id-ID")}</p>
              <p>Shift dimulai: {new Date(activeShift.startTime).toLocaleTimeString("id-ID")}</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Uang Fisik Aktual di Laci (Rp)</label>
            <input
              type="number"
              min={0}
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
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
    </RoleGuard>
  );
}

function ModifierModal({
  modal,
  onClose,
  onConfirm,
}: {
  modal: {
    item: MenuItem;
    selectedModifiers: { groupId: string; modifierId: string; name: string; price: number }[];
    itemNotes: string;
  };
  onClose: () => void;
  onConfirm: (modifiers: CartItem["modifiers"], notes: string) => void;
}) {
  const [selected, setSelected] = useState(modal.selectedModifiers);
  const [notes, setNotes] = useState(modal.itemNotes);

  const toggleModifier = (
    groupId: string,
    modifierId: string,
    name: string,
    price: number,
    maxSelection: number,
  ) => {
    const existing = selected.filter((s) => s.groupId === groupId);
    const hasThis = existing.some((s) => s.modifierId === modifierId);

    if (hasThis) {
      setSelected(selected.filter((s) => !(s.groupId === groupId && s.modifierId === modifierId)));
    } else {
      if (maxSelection === 1) {
        // Single selection - replace all in group
        setSelected([
          ...selected.filter((s) => s.groupId !== groupId),
          { groupId, modifierId, name, price },
        ]);
      } else {
        // Multi selection
        if (existing.length < maxSelection) {
          setSelected([...selected, { groupId, modifierId, name, price }]);
        }
      }
    }
  };

  const modTotal = selected.reduce((sum, m) => sum + m.price, 0);
  const totalPrice = modal.item.basePrice + modTotal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{modal.item.name}</h2>
            <p className="text-sm text-muted-foreground">
              Rp {modal.item.basePrice.toLocaleString("id-ID")}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {modal.item.modifierGroups.map((group) => {
            const groupSelected = selected.filter((s) => s.groupId === group.modifierGroupId);
            return (
              <div key={group.modifierGroupId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{group.groupName ?? "Modifier"}</h3>
                  <span className="text-xs text-muted-foreground">
                    Pilih {group.minSelection === 0 ? "0" : group.minSelection}-{group.maxSelection}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {group.modifiers.map((mod) => {
                    const isSelected = groupSelected.some((s) => s.modifierId === mod.id);
                    return (
                      <button
                        key={mod.id}
                        onClick={() =>
                          toggleModifier(
                            group.modifierGroupId,
                            mod.id,
                            mod.name,
                            mod.price ?? 0,
                            group.maxSelection ?? 0,
                          )
                        }
                        className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                      >
                        <span>{mod.name}</span>
                        {mod.price > 0 && (
                          <span className="text-muted-foreground">
                            +Rp {mod.price.toLocaleString("id-ID")}
                          </span>
                        )}
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
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Pisah sambal, jangan pakai sayur..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold">Rp {totalPrice.toLocaleString("id-ID")}</p>
            </div>
            <button
              onClick={() => onConfirm(selected, notes)}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              Tambah
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
