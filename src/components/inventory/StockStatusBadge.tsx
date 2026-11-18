import { Badge } from "#/components/ui/badge";
import {
  LEAD_TIME_DAYS,
  STOCK_STATUS_LABEL,
  STOCK_STATUS_VARIANT,
  stockStatusHint,
  type StockStatus,
} from "#/lib/stock-recommendation";

/**
 * Colour marker for the safety-stock rule: red below the configured lead-time
 * reference, amber up to two days past it, green above. The hint doubles as the
 * accessible description, so the colour is never the only signal.
 */
export function StockStatusBadge({
  status,
  leadTimeDays = LEAD_TIME_DAYS,
}: {
  status: StockStatus;
  leadTimeDays?: number;
}) {
  return (
    <Badge variant={STOCK_STATUS_VARIANT[status]} title={stockStatusHint(status, leadTimeDays)}>
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}
