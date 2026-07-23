"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import OptionCard from "@/components/OptionCard";
import PriceBar from "@/components/PriceBar";
import { useCustomerInputs } from "@/components/configurator/CustomerInputs";
import { addToCart, editCartItem, mediaUrl, type ProductDetail } from "@/lib/api";
import { validId, type PresetConfig } from "./preset";

// Pen & mirror: pick one finished design from a gallery. No layering.
export default function GalleryConfigurator({
  product,
  onAdded,
  submitLabel = "কার্টে যোগ করুন",
  editId,
  initialConfig,
}: {
  product: ProductDetail;
  onAdded?: () => void;
  submitLabel?: string;
  editId?: number;
  initialConfig?: PresetConfig;
}) {
  // Seed from the combo's pictured design; ignore a deleted option id.
  const [staticId, setStaticId] = useState<number | null>(
    validId(initialConfig?.static?.id, product.static_designs.map((d) => d.id)),
  );
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useCustomerInputs(product);
  const router = useRouter();

  const hasDesigns = product.static_designs.length > 0;
  const chosen = product.static_designs.find((d) => d.id === staticId);

  const price = useMemo(() => {
    let p = Number(product.base_price);
    if (chosen) p += Number(chosen.price_modifier);
    return p.toFixed(2);
  }, [product.base_price, chosen]);

  async function handleAdd() {
    setError("");
    // Simple products with no designs are buy-as-is; only require a pick when designs exist.
    if (!custom && hasDesigns && !staticId) {
      setError("একটি ডিজাইন বেছে নিন");
      return;
    }
    if (!inputs.validate()) {
      setError("প্রয়োজনীয় তথ্য পূরণ করুন");
      return;
    }
    setBusy(true);
    const selection: Record<string, number> = {};
    if (staticId) selection.static = staticId;
    try {
      if (editId) await editCartItem(editId, selection, inputs.payload());
      else await addToCart(product.slug, selection, custom, inputs.payload());
      if (onAdded) onAdded();
      else router.push("/cart");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সমস্যা হয়েছে");
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 pb-2">
      {chosen && (
        <div className="sticky top-(--site-header-h,57px) z-[5] bg-background px-4 pt-3">
          <div className="relative mx-auto aspect-square h-[32svh] max-h-[360px] w-auto max-w-full overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-border sm:h-auto sm:w-full sm:max-w-xs">
            <Image src={mediaUrl(chosen.image)} alt="" fill sizes="320px" className="object-cover" priority />
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md space-y-5 p-4">
        {hasDesigns && (
          <>
            <h2 className="font-display text-base font-semibold text-foreground">ডিজাইন বেছে নিন</h2>
            <div className="grid grid-cols-3 gap-3">
              {product.static_designs.map((d) => (
                <OptionCard key={d.id} image={mediaUrl(d.image)} selected={d.id === staticId} onClick={() => setStaticId(d.id)} />
              ))}
            </div>
          </>
        )}
        {!hasDesigns && (
          <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted shadow-sm ring-1 ring-border">
            এই পণ্যটি সরাসরি কার্টে যোগ করুন।
          </p>
        )}

        <label className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="h-5 w-5 accent-plum" />
          <span className="text-sm text-foreground">আমার নিজের ডিজাইন আছে (দাম পরে জানানো হবে)</span>
        </label>

        {inputs.node}

        {error && <p className="text-center text-sm text-error">{error}</p>}
      </div>

      <PriceBar price={custom ? "—" : price} actionLabel={submitLabel} onAction={handleAdd} busy={busy} />
    </div>
  );
}
