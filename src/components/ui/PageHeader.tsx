import { Plus } from "lucide-react";

interface PageHeaderProps {
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function PageHeader({ action }: PageHeaderProps) {
  if (!action) return null;

  return (
    <div className="mb-6 flex justify-end">
      <button
        onClick={action.onClick}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" />
        {action.label}
      </button>
    </div>
  );
}
