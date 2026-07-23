import * as React from "react";

import { cn } from "#/lib/utils";

/**
 * MoneyInput — a Rupiah money field that live-formats as the user types.
 *
 * Renders <input type="text" inputMode="numeric"> showing "Rp 1.234.567" with
 * id-ID thousands separators. The raw integer value is tracked separately from the
 * displayed string and surfaced via:
 *   - controlled: value / onChange(raw: number | null)
 *   - uncontrolled: name + defaultValue — posts the RAW integer (not the formatted
 *     string) into FormData on native <form> submit.
 *
 * Integer Rupiah only: no sen/decimals, no negatives.
 */

export interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "defaultValue"
> {
  /** Controlled raw integer value. Omit to use uncontrolled mode. */
  value?: number | null;
  /** Controlled change handler receiving the parsed raw integer (null when empty). */
  onChange?: (raw: number | null) => void;
  /** Uncontrolled initial raw integer. */
  defaultValue?: number | null;
  /** When set, the raw integer is posted under this name in FormData on submit. */
  name?: string;
  className?: string;
}

const PREFIX = "Rp ";

function parseRupiahInput(s: string): number | null {
  const digits = s.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? null : n;
}

function formatRupiahInput(value: number | null): string {
  if (value === null) return "";
  return `${PREFIX}${value.toLocaleString("id-ID")}`;
}

/** Count digits before a given index in a string. */
function digitsBefore(str: string, index: number): number {
  return str.slice(0, index).replace(/[^\d]/g, "").length;
}

/** Find the char index in `formatted` that sits just after the Nth digit. */
function caretAfterNthDigit(formatted: string, n: number): number {
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i] ?? "")) count++;
    if (count === n) return i + 1;
  }
  return formatted.length;
}

export function MoneyInput({
  value,
  onChange,
  defaultValue = null,
  name,
  className,
  disabled,
  placeholder = PREFIX.trim(),
  id,
  ...rest
}: MoneyInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<number | null>(defaultValue);
  const raw = isControlled ? value : internal;

  const [display, setDisplay] = React.useState<string>(formatRupiahInput(raw));
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Keep display in sync when the controlled value changes from outside.
  React.useEffect(() => {
    setDisplay(formatRupiahInput(raw));
  }, [raw]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const rawStr = el.value;
    const selectionStart = el.selectionStart ?? rawStr.length;
    const dBefore = digitsBefore(rawStr, selectionStart);

    const parsed = parseRupiahInput(rawStr);
    const formatted = formatRupiahInput(parsed);

    if (!isControlled) setInternal(parsed);
    setDisplay(formatted);
    onChange?.(parsed);

    // Restore caret after the same number of digits as before the edit.
    const pos = caretAfterNthDigit(formatted, dBefore);
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        id={id}
        disabled={disabled}
        placeholder={placeholder}
        value={display}
        onChange={handleChange}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        {...rest}
      />
      {name ? <input type="hidden" name={name} value={raw ?? ""} /> : null}
    </>
  );
}

export default MoneyInput;
