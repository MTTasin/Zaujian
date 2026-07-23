"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfiguratorSwitch, { type PresetConfig } from "@/components/configurator/ConfiguratorSwitch";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { getProduct, type ProductDetail } from "@/lib/api";

// Sequential wizard: customize each selected product, confirm -> next -> cart.
export default function WizardBuild() {
  const router = useRouter();
  const [slugs, setSlugs] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  // Pictured design per product slug when this wizard came from a combo.
  const [presets, setPresets] = useState<Record<string, PresetConfig>>({});

  // Load wizard state once.
  useEffect(() => {
    const raw = sessionStorage.getItem("wizard_slugs");
    const parsed: string[] = raw ? JSON.parse(raw) : [];
    if (parsed.length === 0) {
      router.replace("/customize");
      return;
    }
    setSlugs(parsed);
    setIndex(Number(sessionStorage.getItem("wizard_index") ?? "0"));
    try {
      setPresets(JSON.parse(sessionStorage.getItem("wizard_presets") || "{}"));
    } catch {
      setPresets({});
    }
  }, [router]);

  // Fetch the current product whenever the index changes.
  useEffect(() => {
    if (slugs.length === 0) return;
    const slug = slugs[index];
    if (!slug) return;
    setProduct(null);
    getProduct(slug).then(setProduct).catch(() => setError("পণ্য লোড করা যায়নি"));
  }, [slugs, index]);

  const goBack = useCallback(() => {
    const prev = index - 1;
    if (prev < 0) return;
    sessionStorage.setItem("wizard_index", String(prev));
    setIndex(prev);
    window.scrollTo(0, 0);
  }, [index]);

  const handleAdded = useCallback(() => {
    const next = index + 1;
    if (next >= slugs.length) {
      sessionStorage.removeItem("wizard_slugs");
      sessionStorage.removeItem("wizard_index");
      router.push("/cart");
    } else {
      sessionStorage.setItem("wizard_index", String(next));
      setIndex(next);
      window.scrollTo(0, 0);
    }
  }, [index, slugs, router]);

  if (error) {
    return (
      <Shell>
        <p className="py-10 text-center text-error">{error}</p>
      </Shell>
    );
  }
  if (slugs.length === 0 || !product) {
    return (
      <Shell>
        <p className="py-10 text-center text-muted">লোড হচ্ছে...</p>
      </Shell>
    );
  }

  const isLast = index === slugs.length - 1;

  return (
    <Shell>
      {/* Progress + clear "what am I customizing now" title */}
      <div className="mx-auto w-full max-w-md pt-3">
        <Eyebrow>ধাপ {index + 1} / {slugs.length}</Eyebrow>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-plum transition-all"
            style={{ width: `${((index + 1) / slugs.length) * 100}%` }}
          />
        </div>
        <div className="mt-4 rounded-2xl bg-wine px-4 py-3 text-center text-white shadow-sm">
          <div className="text-xs text-white/75">এখন সাজাচ্ছেন</div>
          <div className="font-display text-xl font-bold">{product.name}</div>
        </div>

        {index > 0 && (
          <button
            onClick={goBack}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-plum active:scale-95"
          >
            ← পূর্ববর্তী
          </button>
        )}
      </div>

      <ConfiguratorSwitch
        key={product.slug}
        product={product}
        onAdded={handleAdded}
        submitLabel={isLast ? "শেষ করুন ✓" : "নিশ্চিত করে পরবর্তী →"}
        initialConfig={presets[product.slug]}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Container className="flex flex-1 flex-col">{children}</Container>
    </div>
  );
}
