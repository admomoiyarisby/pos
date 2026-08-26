import { describe, expect, it } from "vite-plus/test";
import { formatJakartaDateTime } from "./utils";

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
