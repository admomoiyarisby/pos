import { Badge } from "#/components/ui/badge";

interface Recipe {
  id: string;
  name: string;
  basePrice: number;
  ingredients: { ingredientId: string; quantity: number }[];
}

interface Ingredient {
  id: string;
  averageCost: number;
  conversionFactor: number;
}

export function computeHppAlerts(recipes: Recipe[], ingredients: Ingredient[]) {
  return recipes
    .map((r) => {
      const cogs = r.ingredients.reduce((acc, ri) => {
        const ing = ingredients.find((i) => i.id === ri.ingredientId);
        if (!ing) return acc;
        return acc + ri.quantity * (ing.averageCost / ing.conversionFactor);
      }, 0);
      const hppPercentage = r.basePrice > 0 ? (cogs / r.basePrice) * 100 : 0;
      return { ...r, cogs, hppPercentage };
    })
    .filter((item) => item.hppPercentage < 40);
}

export function HppAlertCards({ data }: { data: ReturnType<typeof computeHppAlerts> }) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-2">
        <h3 className="text-base font-bold text-foreground">HPP Monitoring Alert</h3>
        <p className="text-sm text-muted-foreground">Menu dengan HPP di bawah 40% (High Margin)</p>
      </div>
      <div className="space-y-4">
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Tidak ada menu dengan HPP &lt; 40%.
          </p>
        ) : (
          data.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3"
            >
              <div className="mb-2 flex items-start justify-between">
                <span className="text-sm font-bold text-foreground">{item.name}</span>
                <Badge variant="success">{item.hppPercentage.toFixed(1)}% HPP</Badge>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>COGS: Rp {Math.round(item.cogs).toLocaleString("id-ID")}</span>
                <span>Price: Rp {item.basePrice.toLocaleString("id-ID")}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
