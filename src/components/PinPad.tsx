import { Delete, X } from "lucide-react";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onComplete: (pin: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

export default function PinPad({
  value,
  onChange,
  onComplete,
  maxLength = 4,
  disabled = false,
}: PinPadProps) {
  const handleDigit = (digit: string) => {
    if (disabled) return;
    if (value.length >= maxLength) return;
    const next = value + digit;
    onChange(next);
    if (next.length === maxLength) {
      onComplete(next);
    }
  };

  const handleBackspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  const handleClear = () => {
    if (disabled) return;
    onChange("");
  };

  return (
    <div className="w-full max-w-[280px] mx-auto space-y-4">
      {/* Display */}
      <div className="flex items-center justify-center gap-3 h-14 rounded-xl border bg-background">
        {Array.from({ length: maxLength }).map((_, i) => (
          <span
            key={i}
            className={`text-2xl font-mono transition-all ${
              i < value.length ? "text-foreground scale-100" : "text-muted-foreground/30 scale-75"
            }`}
          >
            {i < value.length ? "•" : "○"}
          </span>
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => handleDigit(digit)}
            disabled={disabled}
            className="h-16 rounded-xl bg-muted text-2xl font-bold text-foreground hover:bg-muted/80 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </button>
        ))}

        {/* Clear */}
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || value.length === 0}
          className="h-16 rounded-xl bg-muted/50 text-sm font-medium text-muted-foreground hover:bg-muted/80 active:scale-95 transition disabled:opacity-30 disabled:active:scale-100"
          aria-label="Clear"
        >
          <X className="mx-auto h-5 w-5" />
        </button>

        {/* 0 */}
        <button
          type="button"
          onClick={() => handleDigit("0")}
          disabled={disabled}
          className="h-16 rounded-xl bg-muted text-2xl font-bold text-foreground hover:bg-muted/80 active:scale-95 transition disabled:opacity-40 disabled:active:scale-100"
          aria-label="Digit 0"
        >
          0
        </button>

        {/* Backspace */}
        <button
          type="button"
          onClick={handleBackspace}
          disabled={disabled || value.length === 0}
          className="h-16 rounded-xl bg-muted/50 text-sm font-medium text-muted-foreground hover:bg-muted/80 active:scale-95 transition disabled:opacity-30 disabled:active:scale-100"
          aria-label="Backspace"
        >
          <Delete className="mx-auto h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
