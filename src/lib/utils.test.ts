import { describe, expect, it } from "vite-plus/test";
import { formatJakartaDateTime, formatQuantity } from "./utils";

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
