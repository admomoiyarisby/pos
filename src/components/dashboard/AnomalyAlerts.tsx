import { AlertTriangle } from "lucide-react";

export interface Anomaly {
  type: string;
  message: string;
  severity: "error" | "warning";
}

interface AnomalyAlertsProps {
  anomalies: Anomaly[];
}

const severityStyles = {
  error: {
    border: "border-rose-500/30",
    bg: "bg-rose-500/10",
    iconBg: "bg-rose-500/20 text-rose-500",
  },
  warning: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    iconBg: "bg-amber-500/20 text-amber-500",
  },
} as const;

export function AnomalyAlerts({ anomalies }: AnomalyAlertsProps) {
  if (anomalies.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="anomaly-alerts-title">
      <h3
        id="anomaly-alerts-title"
        className="flex items-center text-base font-bold text-foreground"
      >
        <AlertTriangle className="mr-2 h-4 w-4 text-amber-500" />
        Deteksi Anomali
      </h3>
      <div className="space-y-3">
        {anomalies.map((a, i) => {
          const styles = severityStyles[a.severity];
          return (
            <div
              key={i}
              className={`flex items-start rounded-lg border p-4 ${styles.border} ${styles.bg}`}
            >
              <div className={`mr-4 rounded-md p-2 ${styles.iconBg}`}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{a.type}</p>
                <p className="text-sm text-muted-foreground">{a.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
