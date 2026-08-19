// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MoneyInput from "#/components/MoneyInput";

afterEach(cleanup);

beforeAll(() => {
  if (globalThis.requestAnimationFrame == null) {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 0);
  }
});

describe("MoneyInput — typing a zero", () => {
  it("keeps 'Rp 0' visible when the user types a single zero (price can be Rp 0)", () => {
    render(<MoneyInput />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Rp");

    // Simulate the user typing "0" into an empty field.
    fireEvent.change(input, { target: { value: "0" } });

    // BUG: the field clears to "" instead of showing "Rp 0", so the digit
    // appears to "not type". A legitimate Rp 0 price (e.g. free add-on) must
    // be enterable.
    expect(input.value).toBe("Rp 0");
  });

  it("does not regress normal amounts (e.g. '10' shows 'Rp 10')", () => {
    render(<MoneyInput />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Rp");

    fireEvent.change(input, { target: { value: "10" } });
    expect(input.value).toBe("Rp 10");
  });

  it("allows clearing the field back to empty", () => {
    render(<MoneyInput />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Rp");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
  });
});
