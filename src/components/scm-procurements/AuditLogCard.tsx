import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProcurementAuditLog } from "#/lib/server/scm-queries";
import { AuditLogTimeline, type AuditLogEntry } from "./AuditLogTimeline";

const PAGE_SIZE = 10;

/**
 * AuditLogCard — fetches and paginates the procurement's audit log.
 * Loads the first 10 entries; the "Tampilkan lebih lama" button loads
 * 10 more via the same endpoint with offset.
 *
 * Intentionally does NOT include the surrounding <Card>. The caller
 * wraps it in whatever layout they want.
 */
export function AuditLogCard({ procurementId }: { procurementId: string }) {
  const [offset, setOffset] = useState(0);
  const [allEntries, setAllEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["scm-procurement-audit", procurementId, offset],
    queryFn: () => getProcurementAuditLog({ data: { procurementId, limit: PAGE_SIZE, offset } }),
  });

  useEffect(() => {
    if (!data) return;
    if (offset === 0) {
      setAllEntries(data.entries as unknown as AuditLogEntry[]);
    } else {
      setAllEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const additions = (data.entries as unknown as AuditLogEntry[]).filter(
          (e) => !seen.has(e.id),
        );
        return [...prev, ...additions];
      });
    }
    setTotal(data.total);
  }, [data, offset]);

  // Reset when procurementId changes
  useEffect(() => {
    setAllEntries([]);
    setOffset(0);
  }, [procurementId]);

  const hasMore = allEntries.length < total;

  function loadMore() {
    setOffset(allEntries.length);
  }

  if (isLoading && allEntries.length === 0) {
    return <p className="text-sm text-muted-foreground">Memuat...</p>;
  }

  return (
    <AuditLogTimeline
      entries={allEntries}
      hasMore={hasMore}
      onLoadMore={loadMore}
      isLoadingMore={isFetching && allEntries.length > 0}
    />
  );
}
