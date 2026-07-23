"use client";
import { useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/ui/Icon";
import { mediaUrl, type ProductImageItem } from "@/lib/api";

// Catalog gallery: large main image + thumbnail strip (Heritage Atelier).
export default function ProductGallery({
  images,
  fallback,
  name,
}: {
  images?: ProductImageItem[] | null;
  fallback?: string | null;
  name: string;
}) {
  const list = images ?? [];
  const urls = list.length
    ? list.map((i) => mediaUrl(i.image))
    : fallback
      ? [mediaUrl(fallback)]
      : [];
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[1.5rem] bg-surface-2 shadow-sm ring-1 ring-border">
        {urls.length ? (
          <Image
            src={urls[active]}
            alt={name}
            fill
            priority
            sizes="(max-width:1024px) 100vw, 560px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-plum/25">
            <Icon name="image" size={72} />
          </span>
        )}
      </div>
      {urls.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {urls.map((u, i) => (
            <button
              key={i}
              type="button"
              aria-label={`ছবি ${i + 1}`}
              onClick={() => setActive(i)}
              className={`relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-2 transition ${
                i === active ? "ring-gold" : "ring-border hover:ring-plum/40"
              }`}
            >
              <Image src={u} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
