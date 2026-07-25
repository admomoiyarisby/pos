import { Button } from "#/components/ui/button";

interface RestoreDraftBannerProps {
  onRestore: () => void;
  onDiscard: () => void;
  message?: string;
}

/**
 * Shown on a creation form when a previously-saved Unsaved Draft is found in
 * localStorage (ADR 0011 D3). The user explicitly restores or discards — we never
 * silently re-apply a stale creation draft, since it may be from an unrelated attempt.
 */
export function RestoreDraftBanner({ onRestore, onDiscard, message }: RestoreDraftBannerProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-blue-900">
        {message ?? "Anda memiliki draft sebelumnya yang belum disimpan."}
      </span>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" onClick={onDiscard}>
          Buang
        </Button>
        <Button size="sm" onClick={onRestore}>
          Pulihkan
        </Button>
      </div>
    </div>
  );
}
