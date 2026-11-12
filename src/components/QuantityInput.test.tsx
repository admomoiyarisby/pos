// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { QuantityInput } from "#/components/QuantityInput";

afterEach(cleanup);

/** Controlled harness: shows the committed value next to the field. */
function Harness({ max, initial = 0 }: { max?: number; initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <QuantityInput value={value} onChange={setValue} max={max} aria-label="qty" />
      <output data-testid="committed">{value}</output>
    </>
  );
}

const field = () => screen.getByLabelText<HTMLInputElement>("qty");
const committed = () => screen.getByTestId("committed").textContent;

describe("QuantityInput — decimals", () => {
  it("keeps the separator visible while the fraction is being typed", () => {
    // The old type=number field round-tripped through Number(), so "9732."
    // re-rendered as "9732" and the dot vanished before the next digit.
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "9732." } });
    expect(field().value).toBe("9732.");
    expect(committed()).toBe("0");

    fireEvent.change(field(), { target: { value: "9732.7" } });
    expect(committed()).toBe("9732.7");
  });

  it("accepts a comma as the decimal point (id-ID)", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "0,5" } });
    expect(committed()).toBe("0.5");
  });

  it("reads a 3-digit group as thousands, not as a fraction (id-ID)", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "6.000" } });
    expect(committed()).toBe("6000");
  });

  it("keeps a half-typed value in the field without committing it", () => {
    render(<Harness initial={23} />);
    fireEvent.change(field(), { target: { value: "23," } });
    expect(field().value).toBe("23,");
    expect(committed()).toBe("23");
  });
  it("renders an empty field when the value is still undecided", () => {
    render(<QuantityInput value={null} onChange={() => {}} aria-label="qty" placeholder="Jml" />);
    expect(field().value).toBe("");
    expect(field().placeholder).toBe("Jml");
  });
});

describe("QuantityInput — bounds and clearing", () => {
  it("clamps to max instead of committing more than was shipped", () => {
    render(<Harness max={9732.7} />);
    fireEvent.change(field(), { target: { value: "97327" } });
    expect(committed()).toBe("9732.7");
  });

  it("rejects negatives", () => {
    render(<Harness initial={5} />);
    fireEvent.change(field(), { target: { value: "-3" } });
    expect(committed()).toBe("5");
  });

  it("restores the last good value when a cleared field blurs", () => {
    // A cleared field must never read as a committed 0 — that is how the
    // 2026-09-30 full rejection happened.
    render(<Harness initial={12} />);
    fireEvent.change(field(), { target: { value: "" } });
    expect(committed()).toBe("12");
    fireEvent.blur(field());
    expect(field().value).toBe("12");
  });

  it("renders the canonical id-ID form once the field is left", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "6000" } });
    fireEvent.blur(field());
    expect(field().value).toBe("6.000");
  });
});
