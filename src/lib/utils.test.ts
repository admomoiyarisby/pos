import { describe, expect, it } from "vite-plus/test";
import { formatJakartaDateTime, formatQuantity, parseQuantityInput, roundQuantity } from "./utils";

describe("formatJakartaDateTime", () => {
  it("uses Jakarta time regardless of the runtime timezone", () => {
    const date = new Date("2026-12-31T00:00:00.000Z");
    const originalTimezone = process.env.TZ;

    try {
      process.env.TZ = "Etc/GMT-8";
      const serverValue = formatJakartaDateTime(date);

      process.env.TZ = "Etc/GMT+7";
      const clientValue = formatJakartaDateTime(date);

      expect(serverValue).toBe("31 Des 2026, 07.00");
      expect(clientValue).toBe(serverValue);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});

describe("formatQuantity", () => {
  it("formats integers compactly in id-ID", () => {
    expect(formatQuantity(6000)).toBe("6.000");
    expect(formatQuantity(0)).toBe("0");
    expect(formatQuantity(90)).toBe("90");
  });

  it("formats decimals with a comma", () => {
    expect(formatQuantity(2.25)).toBe("2,25");
    expect(formatQuantity(0.5)).toBe("0,5");
    expect(formatQuantity(7.75)).toBe("7,75");
  });

  it("cleans up float32 round-off artifacts", () => {
    expect(formatQuantity(0.1 + 0.2)).toBe("0,3");
    expect(formatQuantity(7.7500001)).toBe("7,75");
  });

  it("keeps up to 3 fraction digits", () => {
    expect(formatQuantity(0.125)).toBe("0,125");
    expect(formatQuantity(0.0001)).toBe("0");
  });

  it("tolerates null/undefined as zero", () => {
    expect(formatQuantity(null)).toBe("0");
    expect(formatQuantity(undefined)).toBe("0");
  });
});

describe("roundQuantity", () => {
  it("cleans float32 residue at display precision", () => {
    expect(roundQuantity(23.499999)).toBe(23.5);
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(7.7500001)).toBe(7.75);
  });

  it("leaves exact values and non-numbers alone", () => {
    expect(roundQuantity(23.5)).toBe(23.5);
    expect(roundQuantity(0)).toBe(0);
    expect(roundQuantity(-2.25)).toBe(-2.25);
    expect(roundQuantity(Number.NaN)).toBeNaN();
    expect(roundQuantity(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("parseQuantityInput", () => {
  it("reads the id-ID decimal comma", () => {
    expect(parseQuantityInput("23,5")).toBe(23.5);
    expect(parseQuantityInput("0,5")).toBe(0.5);
    expect(parseQuantityInput("  7,75 ")).toBe(7.75);
  });

  it("treats exact 3-digit dot groups as thousands, not as a decimal", () => {
    // The case that motivated this parser: Number("6.000") is 6, and reading a
    // count of 6000 as 6 would silently miscount stock.
    expect(parseQuantityInput("6.000")).toBe(6000);
    expect(parseQuantityInput("1.234")).toBe(1234);
    expect(parseQuantityInput("1.234.567")).toBe(1234567);
  });

  it("treats a dot as a decimal point when it is not a thousands group", () => {
    expect(parseQuantityInput("23.5")).toBe(23.5);
    expect(parseQuantityInput("1.5")).toBe(1.5);
    expect(parseQuantityInput("1234.5")).toBe(1234.5);
  });

  it("handles grouped values that also carry a decimal comma", () => {
    expect(parseQuantityInput("1.234,5")).toBe(1234.5);
  });

  it("parses plain integers", () => {
    expect(parseQuantityInput("0")).toBe(0);
    expect(parseQuantityInput("90")).toBe(90);
    expect(parseQuantityInput("6000")).toBe(6000);
  });

  it("returns null for a value still being typed or not a number", () => {
    expect(parseQuantityInput("")).toBeNull();
    expect(parseQuantityInput("   ")).toBeNull();
    expect(parseQuantityInput("23,")).toBeNull();
    expect(parseQuantityInput("23.")).toBeNull();
    expect(parseQuantityInput("abc")).toBeNull();
    expect(parseQuantityInput("-5")).toBeNull();
    expect(parseQuantityInput("1.2.3.4")).toBeNull();
  });

  it("round-trips what formatQuantity renders", () => {
    for (const value of [0, 90, 6000, 1234.5, 23.5, 0.5, 0.125]) {
      expect(parseQuantityInput(formatQuantity(value))).toBe(value);
    }
  });
});
