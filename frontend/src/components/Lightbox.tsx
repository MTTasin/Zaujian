"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LightboxImage = { full: string; caption?: string };

export function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: LightboxImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(startIndex);
  const [mounted, setMounted] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  const prev = () => setI((n) => (n - 1 + images.length) % images.length);
  const next = () => setI((n) => (n + 1) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose]);

  if (!mounted) return null;
  const cur = images[i];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx > 50) prev();
        else if (dx < -50) next();
        touchX.current = null;
      }}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white"
      >
        ×
      </button>
      {images.length > 1 && (
        <>
          <button
            aria-label="Previous"
            onClick={prev}
            className="absolute left-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-3xl text-white"
          >
            ‹
          </button>
          <button
            aria-label="Next"
            onClick={next}
            className="absolute right-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-3xl text-white"
          >
            ›
          </button>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cur.full}
        alt={cur.caption || ""}
        className="max-h-[85vh] max-w-[92vw] object-contain"
      />
      {cur.caption && (
        <p className="mt-3 px-4 text-center text-sm text-white/80">{cur.caption}</p>
      )}
    </div>,
    document.body,
  );
}
