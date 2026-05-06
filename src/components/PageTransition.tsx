export default function PageTransition() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Memuat...</p>
    </div>
  );
}
