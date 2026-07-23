"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import PriceBar from "@/components/PriceBar";
import { useCustomerInputs } from "@/components/configurator/CustomerInputs";
import { addToCart, editCartItem, mediaUrl, type ProductDetail } from "@/lib/api";
import { matchDupatta, type PresetConfig } from "./preset";

// Dupatta: two-step choice (lace type -> text lines). Price is a direct lookup
// from the matched option, not additive (plan §5).
const LACE_LABEL: Record<string, string> = { single: "সিঙ্গেল লেইস", four: "চার লেইস" };

export default function DupattaConfigurator({
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
  const opts = product.dupatta_options;
  const laceTypes = Array.from(new Set(opts.map((o) => o.lace_type)));

  // Seed from the combo's pictured design (by option id, else lace + lines).
  const presetOpt = matchDupatta(initialConfig?.dupatta, opts);
  const [lace, setLace] = useState<string | null>(presetOpt?.lace_type ?? null);
  const [lines, setLines] = useState<number | null>(presetOpt?.text_lines ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useCustomerInputs(product);
  const router = useRouter();

  const lineChoices = useMemo(
    () => (lace ? opts.filter((o) => o.lace_type === lace) : []),
    [lace, opts],
  );
  const matched = useMemo(
    () => opts.find((o) => o.lace_type === lace && o.text_lines === lines) ?? null,
    [lace, lines, opts],
  );

  async function handleAdd() {
    setError("");
    if (!matched) {
      setError("লেইস ও লাইন বেছে নিন");
      return;
    }
    if (!inputs.validate()) {
      setError("প্রয়োজনীয় তথ্য পূরণ করুন");
      return;
    }
    setBusy(true);
    try {
      if (editId) await editCartItem(editId, { dupatta: matched.id }, inputs.payload());
      else await addToCart(product.slug, { dupatta: matched.id }, false, inputs.payload());
      if (onAdded) onAdded();
      else router.push("/cart");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সমস্যা হয়েছে");
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 pb-2">
      {matched && (
        <div className="sticky top-(--site-header-h,57px) z-[5] bg-background px-4 pt-3">
          <div className="relative mx-auto aspect-square h-[32svh] max-h-[360px] w-auto max-w-full overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-border sm:h-auto sm:w-full sm:max-w-xs">
            <Image src={mediaUrl(matched.preview_image)} alt="" fill sizes="320px" className="object-cover" priority />
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md space-y-5 p-4">
        <section>
          <h2 className="mb-2 font-display text-base font-semibold text-foreground">লেইস বেছে নিন</h2>
          <div className="grid grid-cols-2 gap-3">
            {laceTypes.map((lt) => (
              <button
                key={lt} type="button"
                onClick={() => { setLace(lt); setLines(null); }}
                className={`rounded-2xl p-5 text-center font-display font-semibold shadow-sm ring-1 transition active:scale-95 ${
                  lace === lt ? "bg-surface-2 text-plum ring-2 ring-plum" : "bg-surface text-foreground ring-border"
                }`}
              >
                {LACE_LABEL[lt] ?? lt}
              </button>
            ))}
          </div>
        </section>

        {lace && (
          <section>
            <h2 className="mb-2 font-display text-base font-semibold text-foreground">লেখার লাইন সংখ্যা</h2>
            <div className="grid grid-cols-3 gap-3">
              {lineChoices.map((o) => (
                <button
                  key={o.id} type="button"
                  onClick={() => setLines(o.text_lines)}
                  className={`rounded-2xl p-5 text-center font-display text-lg font-bold shadow-sm ring-1 transition active:scale-95 ${
                    lines === o.text_lines ? "bg-surface-2 text-plum ring-2 ring-plum" : "bg-surface text-foreground ring-border"
                  }`}
                >
                  {o.text_lines}
                </button>
              ))}
            </div>
          </section>
        )}

        {inputs.node}

        {error && <p className="text-center text-sm text-error">{error}</p>}
      </div>

      <PriceBar
        price={matched ? Number(matched.price).toFixed(2) : "0.00"}
        actionLabel={submitLabel}
        onAction={handleAdd}
        busy={busy}
      />
    </div>
  );
}
