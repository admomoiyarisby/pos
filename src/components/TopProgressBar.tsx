import { useEffect, useState, useRef, useCallback } from "react";
import { useRouterState } from "@tanstack/react-router";

export default function TopProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  const [state, setState] = useState<"idle" | "starting" | "active" | "finishing">("idle");
  const [width, setWidth] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reset = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState("idle");
    setWidth(0);
  }, []);

  useEffect(() => {
    if (isLoading) {
      // Navigation started
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setState("starting");
      setWidth(10);
      // Animate to 80%
      timeoutRef.current = setTimeout(() => {
        setState("active");
        setWidth(80);
      }, 50);
    } else if (state !== "idle") {
      // Navigation ended — animate to 100% then hide
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setWidth(100);
      setState("finishing");
      timeoutRef.current = setTimeout(() => {
        reset();
      }, 300);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isLoading, state, reset]);

  if (state === "idle") return null;

  return (
    <div className="fixed top-0 left-0 z-[9999] h-1 w-full bg-transparent">
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
