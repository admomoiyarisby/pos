import { describe, expect, it } from "vite-plus/test";
import { branchInfoPayload, branchContactPayload } from "./branch-form";

/** A FormData holding only the fields the Kontak & PIN form renders. */
function contactForm(entries: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

function infoForm(entries: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("code", "PUS");
  fd.set("name", "Pusat");
  fd.set("location", "Wiyung");
  fd.set("type", "Central");
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

describe("branch edit sheet payloads", () => {
  it("builds the contact payload from fields the contact form owns", () => {
    const payload = branchContactPayload(
      "branch-1",
      contactForm({ pin: "1234", phone: "08123", complaintPhone: "08987" }),
    );

    expect(payload).toEqual({
      id: "branch-1",
      pin: "1234",
      phone: "08123",
      complaintPhone: "08987",
    });
  });

  it("omits blank contact fields so saving does not clear them", () => {
    expect(branchContactPayload("branch-1", contactForm({ pin: "1234" }))).toEqual({
      id: "branch-1",
      pin: "1234",
      phone: undefined,
      complaintPhone: undefined,
    });
  });

  it("does not read the info fields when saving contact details", () => {
    // Regression: the contact form renders no `type` input, so a shared handler
    // parsed "" into the Central|Outlet enum and threw, leaving the button inert.
    const payload = branchContactPayload("branch-1", contactForm({ pin: "1234" }));
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("code");
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("location");
  });

  it("builds the info payload without touching the PIN", () => {
    const payload = branchInfoPayload("branch-1", infoForm());

    expect(payload).toEqual({
      id: "branch-1",
      code: "PUS",
      name: "Pusat",
      location: "Wiyung",
      type: "Central",
    });
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("phone");
  });

  it("rejects a missing or unknown branch type", () => {
    const fd = infoForm();
    fd.delete("type");
    expect(() => branchInfoPayload("branch-1", fd)).toThrow();

    expect(() => branchInfoPayload("branch-1", infoForm({ type: "Franchise" }))).toThrow();
  });
});
