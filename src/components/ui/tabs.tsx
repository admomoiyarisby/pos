import * as React from "react";
import { cn } from "#/lib/utils";

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const activeTab = value ?? internalValue;
  const setActiveTab = React.useCallback(
    (id: string) => {
      setInternalValue(id);
      onValueChange?.(id);
    },
    [onValueChange],
  );

  const baseId = React.useId();

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: React.ReactNode;
  className?: string;
}

function TabsList({ children, className }: TabsListProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!tabs) return;
    const current = Array.from(tabs).findIndex((t) => t === document.activeElement);
    const next =
      e.key === "ArrowRight"
        ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex h-10 items-center gap-1 rounded-lg border bg-muted p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { activeTab, setActiveTab, baseId } = useTabs();
  const isActive = activeTab === value;

  return (
    <button
      role="tab"
      id={`${baseId}-trigger-${value}`}
      aria-controls={`${baseId}-content-${value}`}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-state={isActive ? "active" : "inactive"}
      onClick={() => setActiveTab(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

function TabsContent({ value, children, className }: TabsContentProps) {
  const { activeTab, baseId } = useTabs();
  if (activeTab !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-content-${value}`}
      aria-labelledby={`${baseId}-trigger-${value}`}
      data-state="active"
      tabIndex={0}
      className={cn("mt-4 outline-none", className)}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
