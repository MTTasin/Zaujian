"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCart, removeCartItem, mediaUrl, type CartState } from "@/lib/api";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";

export default function CartPage() {
  const [cart, setCart] = useState<CartState | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    getCart()
      .then(setCart)
      .catch(() => setCart({ items: [], subtotal: "0", count: 0 }))
      .finally(() => setLoading(false));
  }, []);

  async function handleRemove(id: number) {
    const next = await removeCartItem(id);
    setCart(next);
  }

  return (
    <div className="flex flex-1 flex-col">
      <Container className="max-w-3xl py-8 lg:py-12">
        <Eyebrow>আপনার কার্ট</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-semibold text-plum">
          কার্ট
        </h1>

        {loading ? (
          <p className="mt-8 text-center text-muted">লোড হচ্ছে...</p>
        ) : !cart || cart.count === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-6 py-16 text-center">
            <span className="text-plum/30"><Icon name="cart" size={44} /></span>
            <p className="font-display text-lg font-bold text-plum">আপনার কার্ট খালি</p>
            <p className="text-sm text-muted">সুন্দর কিছু বেছে নিন।</p>
            <Link
              href="/products"
              className="mt-2 inline-flex min-h-12 items-center rounded-full bg-plum px-6 font-semibold text-white"
            >
              পণ্য দেখুন
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
            <ul className="space-y-3">
              {cart.items.map((it) => (
                <li key={it.id} className="flex gap-4 rounded-2xl bg-surface p-3 shadow-sm ring-1 ring-border">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                    {it.preview_image ? (
                      <Image src={mediaUrl(it.preview_image)} alt={it.product_name} fill sizes="96px" className="object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-plum/30"><Icon name="gift" size={28} /></span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <p className="font-display text-base font-semibold text-foreground">{it.product_name}</p>
                      {it.is_custom_request ? (
                        <p className="mt-0.5 text-sm text-muted">কাস্টম ডিজাইন — দাম পরে জানানো হবে</p>
                      ) : (
                        <div className="mt-1"><PriceTag price={it.price_snapshot} size="sm" /></div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
                      {!it.is_custom_request && (
                        <Link
                          href={
                            it.category === "combo"
                              ? `/combo/${it.product_slug}?edit=${it.id}`
                              : `/product/${it.product_slug}?edit=${it.id}`
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-plum active:scale-95"
                        >
                          <Icon name="edit" size={16} /> এডিট
                        </Link>
                      )}
                      <button
                        onClick={() => handleRemove(it.id)}
                        aria-label="কার্ট থেকে মুছুন"
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-error/30 bg-error/5 px-4 text-error active:scale-95"
                      >
                        <Icon name="trash" size={16} /> মুছুন
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Summary */}
            <div className="h-max rounded-2xl bg-surface-2 p-5 lg:sticky lg:top-28">
              <p className="font-display text-lg font-semibold text-plum">সারসংক্ষেপ</p>
              <div className="mt-3 flex items-center justify-between text-muted">
                <span>পণ্যের দাম</span>
                <PriceTag price={cart.subtotal} size="sm" />
              </div>
              <p className="mt-1 text-xs text-muted">ডেলিভারি চার্জ চেকআউটে যোগ হবে।</p>
              <button
                onClick={() => router.push("/checkout")}
                className="mt-5 inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-plum text-base font-semibold text-white shadow-sm transition hover:bg-wine active:scale-[0.98]"
              >
                চেকআউট <Icon name="arrowRight" size={18} />
              </button>
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}
