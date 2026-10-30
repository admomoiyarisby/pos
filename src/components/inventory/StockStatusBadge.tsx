import { Badge } from "#/components/ui/badge";
import {
  STOCK_STATUS_HINT,
  STOCK_STATUS_LABEL,
  STOCK_STATUS_VARIANT,
  type StockStatus,
} from "#/lib/stock-recommendation";

/**
 * Colour marker for the safety-stock rule: red below the 5-day reference,
 * amber while cover is 5–7 days, green above it. The hint doubles as the
 * accessible description, so the colour is never the only signal.
 */
export function StockStatusBadge({ status }: { status: StockStatus }) {
  return (
    <Badge variant={STOCK_STATUS_VARIANT[status]} title={STOCK_STATUS_HINT[status]}>
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}
