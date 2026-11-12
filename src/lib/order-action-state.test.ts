import { describe, expect, it } from "vite-plus/test";
import { deriveOrderActionState } from "./order-action-state";

const base = { status: "New", canDirectPrint: false };

describe("deriveOrderActionState", () => {
  it("prints directly when the device has a bridge, even for a voided order", () => {
    expect(deriveOrderActionState({ ...base, status: "Void", canDirectPrint: true })).toMatchObject(
      { print: "direct", printIntent: "direct", cancel: "hidden" },
    );
  });

  it("hides both approval actions on a voided order", () => {
    expect(
      deriveOrderActionState({
        ...base,
        status: "Void",
        printRequestStatus: "Pending",
        cancelRequestStatus: "Pending",
      }),
    ).toEqual({
      print: "hidden",
      cancel: "hidden",
      printIntent: "none",
      cancelIntent: "none",
    });
  });

  it("consumes an approved reprint before printing", () => {
    expect(deriveOrderActionState({ ...base, printRequestStatus: "Approved" })).toMatchObject({
      print: "active",
      printIntent: "consume-and-print",
    });
  });

  it("blocks the print button while a reprint is pending", () => {
    expect(deriveOrderActionState({ ...base, printRequestStatus: "Pending" })).toMatchObject({
      print: "pending",
      printIntent: "none",
    });
  });

  it("requests a reprint when there is no live request", () => {
    for (const status of [null, undefined, "Rejected", "Consumed"]) {
      expect(deriveOrderActionState({ ...base, printRequestStatus: status })).toMatchObject({
        print: "neutral",
        printIntent: "request",
      });
    }
  });

  it("blocks cancel while a request is pending, otherwise offers one", () => {
    expect(deriveOrderActionState({ ...base, cancelRequestStatus: "Pending" })).toMatchObject({
      cancel: "pending",
      cancelIntent: "none",
    });
    expect(deriveOrderActionState({ ...base, cancelRequestStatus: null })).toMatchObject({
      cancel: "neutral",
      cancelIntent: "request",
    });
    expect(deriveOrderActionState({ ...base, cancelRequestStatus: "Rejected" })).toMatchObject({
      cancel: "neutral",
      cancelIntent: "request",
    });
  });

  it("works without an order status (history callback only has the request)", () => {
    expect(
      deriveOrderActionState({ canDirectPrint: false, printRequestStatus: "Approved" }),
    ).toMatchObject({ print: "active", printIntent: "consume-and-print" });
    expect(
      deriveOrderActionState({ canDirectPrint: false, cancelRequestStatus: "Pending" }),
    ).toMatchObject({ cancel: "pending", cancelIntent: "none" });
  });
});
