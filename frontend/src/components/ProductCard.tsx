import Image from "next/image";
import Link from "next/link";
import { PriceTag } from "@/components/ui/PriceTag";
import { Icon } from "@/components/ui/Icon";
import { mediaUrl, type ProductListItem } from "@/lib/api";

// Editorial product card: tall image-dominant tile, no heavy border, soft depth.
export default function ProductCard({ product }: { product: ProductListItem }) {
  const showFrom = product.min_price !== product.max_price;
  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-black/5 transition duration-300 group-hover:shadow-xl">
        {product.thumbnail ? (
          <Image
            src={mediaUrl(product.thumbnail)}
            alt={product.name}
            fill
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 300px"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted">
            <Icon name="image" size={44} />
          </span>
        )}
      </div>
      <div className="px-1 pt-3">
        {product.category && (
          <p className="text-xs font-medium uppercase tracking-wide text-gold">
            {product.category}
          </p>
        )}
        <p className="line-clamp-1 font-display text-lg font-semibold text-foreground">
          {product.name}
        </p>
        <div className="mt-1 flex items-baseline gap-1">
          {showFrom && <span className="text-xs text-muted">থেকে</span>}
          <PriceTag price={product.min_price} size="md" />
        </div>
      </div>
    </Link>
  );
}
