import { describe, expect, it } from "vite-plus/test";
import {
  formatJakartaDate,
  formatJakartaDateTime,
  formatJakartaTime,
  formatQuantity,
  parseDateOnlyInput,
  parseQuantityInput,
  roundQuantity,
  toDateInputValue,
  todayDateInputValue,
} from "./utils";

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

describe("formatJakartaDate", () => {
  it("renders the picked day even on a device set behind UTC", () => {
    // Regression: input 14/10 stored as UTC midnight rendered as 13 Okt on a
    // tablet whose system timezone was behind UTC.
    const storedAsUtcMidnight = new Date("2026-10-14T00:00:00.000Z");
    expect(formatJakartaDate(storedAsUtcMidnight)).toBe("14 Okt 2026");
  });
});

describe("formatJakartaTime", () => {
  it("renders the Jakarta clock regardless of device timezone", () => {
    expect(formatJakartaTime(new Date("2026-10-13T15:02:00.000Z"))).toBe("22.02");
  });
});

describe("parseDateOnlyInput", () => {
  it("anchors a picked day at noon so no timezone renders it as a neighbour day", () => {
    const parsed = parseDateOnlyInput("2026-10-14");
    expect(parsed).not.toBeNull();
    // SAFETY: null is ruled out by the assertion above, so the value is a Date here.
    const at = parsed as Date;
    expect(at.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    // Noon UTC is the same calendar day from UTC-12 to UTC+12, unlike the old
    // `new Date("2026-10-14")` (UTC midnight) which is the 13th behind UTC.
    for (const timeZone of ["Asia/Jakarta", "America/Los_Angeles", "Pacific/Midway"]) {
      const rendered = at.toLocaleDateString("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      expect(rendered).toBe("2026-10-14");
    }
    expect(formatJakartaDate(at)).toBe("14 Okt 2026");
  });

  it("rejects non-dates", () => {
    expect(parseDateOnlyInput("")).toBeNull();
    expect(parseDateOnlyInput("14/10/2026")).toBeNull();
    expect(parseDateOnlyInput("2026-10-14T00:00:00.000Z")).toBeNull();
    expect(parseDateOnlyInput("2026-13-01")).toBeNull();
    expect(parseDateOnlyInput("2026-02-30")).toBeNull();
  });
});

describe("todayDateInputValue", () => {
  it("is the Jakarta date, not the UTC date", () => {
    // 03:00 WIB on the 14th is still the 13th in UTC — the old
    // `toISOString().slice(0, 10)` default opened the form on the wrong day.
    expect(todayDateInputValue(new Date("2026-10-13T20:00:00.000Z"))).toBe("2026-10-14");
    expect(todayDateInputValue(new Date("2026-10-14T16:00:00.000Z"))).toBe("2026-10-14");
  });
});

describe("toDateInputValue", () => {
  it("renders the Jakarta calendar day of any instant", () => {
    // 02:00 WIB on the 14th is still the 13th in UTC — UTC-day bucketing
    // attributed it to the previous day.
    expect(toDateInputValue(new Date("2026-10-13T19:00:00.000Z"))).toBe("2026-10-14");
    expect(toDateInputValue(new Date("2026-10-14T00:00:00.000Z"))).toBe("2026-10-14");
    expect(toDateInputValue("2026-10-14")).toBe("2026-10-14");
  });
});
