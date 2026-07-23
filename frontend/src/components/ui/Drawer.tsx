"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function Drawer({
  open,
  onClose,
  title,
  side = "bottom",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: "bottom" | "right";
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const panel =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl"
      : "inset-y-0 right-0 w-[85vw] max-w-sm";

  // Portal to <body> so a blurred/transformed ancestor (e.g. the sticky header
  // with backdrop-blur) can't trap our `fixed` positioning in its containing block.
  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "drawer-title" : undefined}
    >
      <div
        data-testid="drawer-backdrop"
        className="absolute inset-0 bg-foreground/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute overflow-y-auto bg-surface p-4 shadow-2xl",
          panel,
        )}
      >
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <h3 id="drawer-title" className="font-display text-lg font-bold text-plum">
              {title}
            </h3>
            <button
              type="button"
              aria-label="বন্ধ করুন"
              className="flex h-12 w-12 cursor-pointer items-center justify-center text-2xl text-muted"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
