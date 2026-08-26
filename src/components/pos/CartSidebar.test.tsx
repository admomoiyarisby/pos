// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CartSidebar from "#/components/pos/CartSidebar";
import type { CartItem, Voucher } from "#/lib/pos-types";

const cartItem: CartItem = {
  recipeId: "recipe-1",
  name: "Nasi Goreng",
  price: 15000,
  quantity: 2,
  modifiers: [],
  notes: "Tanpa pedas",
};

const voucher: Voucher = {
  id: "voucher-1",
  code: "HEMAT10",
  description: "Diskon",
  discountType: "percentage",
  discountValue: 10,
  minOrder: 20000,
  validUntil: new Date("2030-01-01"),
  status: "Active",
};

function renderCart(overrides: Partial<React.ComponentProps<typeof CartSidebar>> = {}) {
  const callbacks = {
    onRemoveItem: vi.fn(),
    onUpdateQty: vi.fn(),
    onToggleVoucher: vi.fn(),
    onPaymentMethodChange: vi.fn(),
    onCheckout: vi.fn(),
    onPrintBill: vi.fn(),
    onClearError: vi.fn(),
    onClearStockError: vi.fn(),
    onPpnToggle: vi.fn(),
  };

  render(
    <CartSidebar
      cart={[cartItem]}
      cartCount={2}
      cartTotal={30000}
      voucherDiscount={0}
      taxAmount={0}
      finalTotal={30000}
      ppnEnabled={false}
      pb1Rate={11}
      channel="Dine-in"
      isDineIn
      paymentMethod="Cash"
      selectedVoucher={null}
      allVouchers={[voucher]}
      checkoutError={null}
      stockError={null}
      activeShift={{ id: "shift-1" }}
      createOrderPending={false}
      {...callbacks}
      {...overrides}
    />,
  );

  return callbacks;
}

afterEach(cleanup);

describe("CartSidebar", () => {
  it("renders cart lines and sends quantity/removal actions", () => {
    const callbacks = renderCart();

    expect(screen.getByText("Nasi Goreng")).toBeTruthy();
    expect(screen.getByText(/Tanpa pedas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    fireEvent.click(screen.getByRole("button", { name: "Kurangi jumlah" }));
    fireEvent.click(screen.getByRole("button", { name: "Hapus Nasi Goreng" }));

    expect(callbacks.onUpdateQty).toHaveBeenNthCalledWith(1, 0, 1);
    expect(callbacks.onUpdateQty).toHaveBeenNthCalledWith(2, 0, -1);
    expect(callbacks.onRemoveItem).toHaveBeenCalledWith(0);
  });

  it("disables checkout without an open Shift or cart items", () => {
    const { rerender } = render(
      <CartSidebar
        cart={[]}
        cartCount={0}
        cartTotal={0}
        voucherDiscount={0}
        taxAmount={0}
        finalTotal={0}
        ppnEnabled={false}
        pb1Rate={11}
        channel="Dine-in"
        isDineIn
        paymentMethod="Cash"
        selectedVoucher={null}
        allVouchers={[]}
        checkoutError={null}
        stockError={null}
        activeShift={null}
        createOrderPending={false}
        onRemoveItem={vi.fn()}
        onUpdateQty={vi.fn()}
        onToggleVoucher={vi.fn()}
        onPaymentMethodChange={vi.fn()}
        onCheckout={vi.fn()}
        onPrintBill={vi.fn()}
        onClearError={vi.fn()}
        onClearStockError={vi.fn()}
        onPpnToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Bayar/ })).toHaveProperty("disabled", true);
    rerender(
      <CartSidebar
        cart={[cartItem]}
        cartCount={2}
        cartTotal={30000}
        voucherDiscount={0}
        taxAmount={0}
        finalTotal={30000}
        ppnEnabled={false}
        pb1Rate={11}
        channel="Dine-in"
        isDineIn
        paymentMethod="Cash"
        selectedVoucher={null}
        allVouchers={[]}
        checkoutError={null}
        stockError={null}
        activeShift={null}
        createOrderPending={false}
        onRemoveItem={vi.fn()}
        onUpdateQty={vi.fn()}
        onToggleVoucher={vi.fn()}
        onPaymentMethodChange={vi.fn()}
        onCheckout={vi.fn()}
        onPrintBill={vi.fn()}
        onClearError={vi.fn()}
        onClearStockError={vi.fn()}
        onPpnToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Bayar/ })).toHaveProperty("disabled", true);
  });

  it("shows Online Payment for non-dine-in channels", () => {
    renderCart({ channel: "Gofood", isDineIn: false });

    expect(screen.getByText("Online Payment")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Konfirmasi Pesanan" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("only enables a voucher after its minimum order is met", () => {
    const callbacks = renderCart({ cartTotal: 10000, finalTotal: 10000 });
    const voucherButton = screen.getByRole("button", { name: /HEMAT10/ });
    expect(voucherButton).toHaveProperty("disabled", true);

    fireEvent.click(voucherButton);
    expect(callbacks.onToggleVoucher).not.toHaveBeenCalled();
  });

  it("switches to the history panel", () => {
    renderCart({ children: <p>Order history content</p> });

    fireEvent.click(screen.getByRole("button", { name: "Riwayat" }));
    expect(screen.getByText("Order history content")).toBeTruthy();
    expect(screen.queryByText("Nasi Goreng")).toBeNull();
  });
});
