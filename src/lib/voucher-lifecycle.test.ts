import { describe, expect, it } from "vite-plus/test";
import { voucherActionForStatus } from "./voucher-lifecycle";

describe("voucher lifecycle actions", () => {
  it("deactivates active vouchers before they can be deleted", () => {
    expect(voucherActionForStatus("Active")).toBe("deactivate");
  });

  it("allows inactive vouchers to be soft-deleted", () => {
    expect(voucherActionForStatus("Inactive")).toBe("delete");
  });

  it("does not expose actions for deleted vouchers", () => {
    expect(voucherActionForStatus("Deleted")).toBeNull();
  });
});
