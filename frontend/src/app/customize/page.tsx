"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import PriceBar from "@/components/PriceBar";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { getCombo, getProducts, mediaUrl, type ProductListItem } from "@/lib/api";
import { applyExclusive, exclusiveGroups } from "@/lib/exclusive";

function CustomizeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const comboSlug = params.get("combo");

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    getProducts()
      .then((list) => {
        // Only customizable items belong in the configurator (not plain e-commerce products).
        // Order comes from the admin (customize_order), not from hardcoded code.
        const custom = list.filter((p) => p.is_customizable);
        const sorted = [...custom].sort(
          (a, b) => a.customize_order - b.customize_order || a.name.localeCompare(b.name),
        );
        setProducts(sorted);
      })
      .catch(() => setError("পণ্য লোড করা যায়নি"));
  }, []);

  // Preselect the combo's items when arriving from a combo "make changes", and
  // stash its pictured design so the wizard starts from it (customer tweaks, not redesigns).
  useEffect(() => {
    if (!comboSlug) {
      sessionStorage.removeItem("wizard_presets");
      return;
    }
    getCombo(comboSlug)
      .then((c) => {
        setSelected(new Set(c.product_slugs));
        sessionStorage.setItem("wizard_presets", JSON.stringify(c.preset_by_slug ?? {}));
      })
      .catch(() => {});
  }, [comboSlug]);

  function toggle(slug: string) {
    const product = products.find((p) => p.slug === slug);
    if (!product) return;
    // Auto-swaps within an exclusive group (e.g. picking ফ্রেম drops বই).
    setSelected((prev) => applyExclusive(prev, product, products));
  }

  const range = useMemo(() => {
    let lo = 0, hi = 0;
    for (const p of products) {
      if (selected.has(p.slug)) {
        lo += Number(p.min_price);
        hi += Number(p.max_price);
      }
    }
    return { lo, hi };
  }, [products, selected]);

  function proceed() {
    const slugs = products.filter((p) => selected.has(p.slug)).map((p) => p.slug);
    if (slugs.length === 0) {
      setError("অন্তত একটি পণ্য বেছে নিন");
      return;
    }
    sessionStorage.setItem("wizard_slugs", JSON.stringify(slugs));
    sessionStorage.setItem("wizard_index", "0");
    router.push("/customize/build");
  }

  const priceLabel = range.lo === range.hi ? `${range.lo}` : `${range.lo} – ${range.hi}`;

  return (
    <div className="flex flex-1 flex-col">
      <Container className="flex-1 py-8 lg:py-12">
        <div className="mx-auto w-full max-w-lg">
          <Eyebrow>নিজের মতো সাজান</Eyebrow>
          <h1 className="mt-2 font-display text-2xl font-semibold text-plum sm:text-3xl">
            কোন কোন পণ্য চান?
          </h1>
          <p className="mt-1 text-sm text-muted">যা যা চান বেছে নিন, দাম নিচে দেখা যাবে।</p>

          {/* Rule note built from the group's product names — no hardcoded Bengali. */}
          {exclusiveGroups(products).map((names) => (
            <p key={names.join()} className="mt-2 text-sm font-semibold text-gold">
              {names.join(" / ")} — যেকোনো একটি
            </p>
          ))}

          {error && <p className="mt-3 text-sm text-error">{error}</p>}

          <ul className="mt-6 space-y-3">
            {products.map((p) => {
              const on = selected.has(p.slug);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => toggle(p.slug)}
                    className={`flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-sm ring-1 transition active:scale-[0.99] ${
                      on ? "ring-2 ring-plum" : "ring-border"
                    }`}
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                      {p.thumbnail ? (
                        <Image src={mediaUrl(p.thumbnail)} alt="" fill sizes="64px" className="object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-plum/25">
                          <Icon name="image" size={24} />
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-display text-base font-semibold text-foreground">{p.name}</div>
                      <div className="text-sm text-muted">
                        ৳{p.min_price} {p.min_price !== p.max_price && `– ৳${p.max_price}`}
                      </div>
                    </div>
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                        on ? "bg-plum text-white" : "ring-1 ring-border text-transparent"
                      }`}
                    >
                      <Icon name="check" size={16} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 rounded-2xl bg-surface-2 p-5 text-center">
            <div className="text-sm text-muted">আনুমানিক মোট দাম</div>
            <div className="mt-1 font-display text-2xl font-bold text-plum">৳ {priceLabel}</div>
            <div className="mt-1 text-xs text-muted">চূড়ান্ত দাম আপনার ডিজাইন অনুযায়ী হবে</div>
          </div>
        </div>
      </Container>

      <PriceBar price={priceLabel} actionLabel="এগিয়ে যান" onAction={proceed} disabled={selected.size === 0} />
    </div>
  );
}

export default function CustomizePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">লোড হচ্ছে...</div>}>
      <CustomizeInner />
    </Suspense>
  );
}
