"use client";
import { useState } from "react";
import { Lightbox } from "@/components/Lightbox";
import type { GalleryPhoto } from "@/lib/gallery";

export function TagGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (photos.length === 0) {
    return <p className="mt-8 text-muted">এই বিভাগে কোনো ছবি নেই।</p>;
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, idx) => (
          <button
            key={p.id}
            onClick={() => setOpen(idx)}
            className="aspect-square overflow-hidden rounded-xl bg-surface-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.thumb}
              alt={p.alt || p.caption || ""}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 hover:scale-105"
            />
          </button>
        ))}
      </div>
      {open !== null && (
        <Lightbox
          images={photos.map((p) => ({ full: p.full, caption: p.caption }))}
          startIndex={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
