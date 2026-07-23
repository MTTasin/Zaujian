"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error";
interface Item {
  id: number;
  msg: string;
  tone: Tone;
}
interface Ctx {
  toast: (msg: string, tone?: Tone) => void;
}

const ToastContext = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const toast = useCallback((msg: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div
            key={i.id}
            role="status"
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg",
              i.tone === "error" ? "bg-error" : "bg-success",
            )}
          >
            {i.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
