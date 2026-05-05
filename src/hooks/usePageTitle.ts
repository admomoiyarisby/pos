import { useEffect } from "react";
import { usePageTitleContext } from "#/components/PageTitleProvider";

export function usePageTitle(title: string, description?: string) {
  const { setState } = usePageTitleContext();
  useEffect(() => {
    setState({ title, description });
  }, [title, description, setState]);
}
