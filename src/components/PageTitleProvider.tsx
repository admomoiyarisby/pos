import { createContext, useContext, useState, type ReactNode } from "react";

interface PageTitleState {
  title: string;
  description?: string;
}

interface PageTitleContextValue {
  state: PageTitleState;
  setState: (s: PageTitleState) => void;
}

const PageTitleContext = createContext<PageTitleContextValue>({
  state: { title: "" },
  setState: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageTitleState>({ title: "" });
  return (
    <PageTitleContext.Provider value={{ state, setState }}>{children}</PageTitleContext.Provider>
  );
}

export function usePageTitleContext() {
  return useContext(PageTitleContext);
}
