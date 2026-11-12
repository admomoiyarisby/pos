import * as React from "react";

import { Input } from "#/components/ui/input";
import { formatQuantity, parseQuantityInput } from "#/lib/utils";

/**
 * QuantityInput — a stock/quantity field that can hold a half-typed value.
 *
 * A controlled text field, not `type="number"`. A number-backed field cannot
 * hold a half-typed value: `Number("9732.")` is 9732, so writing the parsed
 * number straight back into `value` re-renders "9732." as "9732" and deletes
 * the separator before the next digit arrives — decimals become untypable even
 * though `step="any"` allows them. Keeping the raw text lets "9732," survive
 * the keystroke it takes to finish it, and `parseQuantityInput` reads the
 * result with the id-ID convention that `formatQuantity` writes
 * ("9.732,7" = 9732.7, "6.000" = 6000 — never 6).
 *
 * `inputMode="decimal"` is what asks a phone for a keypad with a separator;
 * `"numeric"` asks for digits only.
 *
 * Contract:
 *   - `onChange` fires only for a complete number, already clamped to
 *     [min, max]. Half-typed text ("0,") and cleared fields do not commit, so a
 *     cleared field shows the last good value again on blur instead of
 *     inventing a 0 (Jambangan, 2026-09-30: cleared Diterima fields were read
 *     as a deliberate 100% rejection).
 *   - `max` is a hard ceiling, not a validation style: the committed value is
 *     clamped, so callers never have to re-clamp.
 *   - `value: null` renders an empty field, for quantities that are still
 *     undecided (a blank line in a multi-row form).
 */

export interface QuantityInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "defaultValue"
> {
  /** Committed quantity to display; null renders empty. */
  value: number | null;
  /** Called with the parsed, clamped quantity on every complete edit. */
  onChange: (quantity: number) => void;
  min?: number;
  /** Optional ceiling; omitted means no upper bound. */
  max?: number;
}

export function QuantityInput({
  value,
  onChange,
  min = 0,
  max,
  className,
  onBlur,
  ...rest
}: QuantityInputProps) {
  const [draft, setDraft] = React.useState<string | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    setDraft(raw);
    const parsed = parseQuantityInput(raw);
    if (parsed === null) return;
    onChange(Math.min(Math.max(min, parsed), max ?? Number.POSITIVE_INFINITY));
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft ?? (value === null ? "" : formatQuantity(value))}
      onChange={handleChange}
      onBlur={(event) => {
        // Drop the draft so the field snaps back to the canonical rendering.
        setDraft(null);
        onBlur?.(event);
      }}
      className={className}
      {...rest}
    />
  );
}

export default QuantityInput;
