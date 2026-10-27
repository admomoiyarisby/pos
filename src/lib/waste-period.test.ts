import { describe, expect, it } from "vite-plus/test";
import { wasteCycleRange } from "./waste-period";

describe("wasteCycleRange", () => {
  it("uses the cycle that is still open on the 25th", () => {
    // 25 Oct 23:00 WIB — the cycle runs 26 Sep → 25 Oct.
    expect(wasteCycleRange(new Date("2026-10-25T16:00:00.000Z"))).toEqual({
      from: "2026-09-26",
      to: "2026-10-25",
    });
  });

  it("rolls over at Jakarta midnight, not UTC midnight", () => {
    // 26 Oct 00:00 WIB is still 25 Oct 17:00 UTC. The server runs in UTC; the
    // reported bug was this exact instant showing the old cycle then flipping.
    expect(wasteCycleRange(new Date("2026-10-25T17:00:00.000Z"))).toEqual({
      from: "2026-10-26",
      to: "2026-11-25",
    });
  });

  it("keeps the same answer for the first and last day of the cycle", () => {
    expect(wasteCycleRange(new Date("2026-10-26T00:00:00.000Z"))).toEqual({
      from: "2026-10-26",
      to: "2026-11-25",
    });
    expect(wasteCycleRange(new Date("2026-11-25T16:59:00.000Z"))).toEqual({
      from: "2026-10-26",
      to: "2026-11-25",
    });
  });

  it("wraps the year at the December cycle", () => {
    expect(wasteCycleRange(new Date("2026-12-27T05:00:00.000Z"))).toEqual({
      from: "2026-12-26",
      to: "2027-01-25",
    });
  });

  it("wraps the year backwards in January", () => {
    expect(wasteCycleRange(new Date("2027-01-10T05:00:00.000Z"))).toEqual({
      from: "2026-12-26",
      to: "2027-01-25",
    });
  });
});
