"use client";

import Image from "next/image";
import Link from "next/link";
import { PriceTag } from "@/components/ui/PriceTag";
import { Icon } from "@/components/ui/Icon";
import { mediaUrl, type ComboListItem } from "@/lib/api";
import { markProgress } from "@/lib/progress";

// Editorial combo card: tall image-dominant tile, no heavy border, soft depth.
export default function ComboCard({ combo }: { combo: ComboListItem }) {
  return (
    <Link href={`/combo/${combo.slug}`} className="group block" onClick={() => markProgress()}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-black/5 transition duration-300 group-hover:shadow-xl">
        {combo.thumbnail ? (
          <Image
            src={mediaUrl(combo.thumbnail)}
            alt={combo.name}
            fill
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 300px"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted">
            <Icon name="gift" size={44} />
          </span>
        )}
        {/* A listing with one linked product is a single item, so the badge shows
            its category — calling a dupatta "কম্বো" reads as a mistake. */}
        <span className="absolute left-3 top-3 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-white shadow">
          {combo.category || "কম্বো"}
        </span>
      </div>
      <div className="px-1 pt-3">
        <p className="line-clamp-1 font-display text-lg font-semibold text-foreground">
          {combo.name}
        </p>
        <div className="mt-1">
          <PriceTag price={combo.price} size="md" />
        </div>
      </div>
    </Link>
  );
}
