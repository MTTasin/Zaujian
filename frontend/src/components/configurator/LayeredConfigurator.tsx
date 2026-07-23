"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import OptionCard from "@/components/OptionCard";
import PriceBar from "@/components/PriceBar";
import { useCustomerInputs } from "@/components/configurator/CustomerInputs";
import { Icon } from "@/components/ui/Icon";
import { addToCart, editCartItem, mediaUrl, type ProductDetail } from "@/lib/api";
import { validId, type PresetConfig } from "./preset";

// Book & box: layered preview (color base + corner + center overlays).
// Book adds a standalone inside-page gallery step.
export default function LayeredConfigurator({
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
  const corners = product.toppings.filter((t) => t.placement === "corner");
  const centers = product.toppings.filter((t) => t.placement === "center");

  // Driven by data, never by the free-text `category` label — an admin typing
  // "বই" or "Book" instead of "book" must not silently drop the inside step.
  const hasInside = product.inside_designs.length > 0;

  // Seed from the combo's pictured design; validId ignores an option that was
  // deleted after the combo was built, so it falls back instead of breaking.
  const [colorId, setColorId] = useState<number | null>(
    validId(initialConfig?.color?.id, product.colors.map((c) => c.id))
      ?? product.colors[0]?.id ?? null,
  );
  const [cornerId, setCornerId] = useState<number | null>(
    validId(initialConfig?.corner?.id, corners.map((t) => t.id)),
  );
  const [centerId, setCenterId] = useState<number | null>(
    validId(initialConfig?.center?.id, centers.map((t) => t.id)),
  );
  const [insideId, setInsideId] = useState<number | null>(
    validId(initialConfig?.inside?.id, product.inside_designs.map((d) => d.id)),
  );
  const [custom, setCustom] = useState(false);
  // Book flow has two separate screens: "cover" then "inside" (plan §3).
  const [phase, setPhase] = useState<"cover" | "inside">("cover");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useCustomerInputs(product);
  const router = useRouter();

  function goInside() {
    setError("");
    if (!custom && !colorId) {
      setError("একটি রং বেছে নিন");
      return;
    }
    setPhase("inside");
    window.scrollTo(0, 0);
  }

  const color = product.colors.find((c) => c.id === colorId);
  const corner = corners.find((t) => t.id === cornerId);
  const center = centers.find((t) => t.id === centerId);
  const inside = product.inside_designs.find((d) => d.id === insideId);

  // If an admin uploaded a real photo for this exact combination, show it instead
  // of stacking overlays. Best match = most specified fields that all match.
  const configPhoto = useMemo(() => {
    const imgs = product.config_images ?? [];
    const matches = imgs.filter((ci) =>
      (ci.color == null || ci.color === colorId) &&
      (ci.corner == null || ci.corner === cornerId) &&
      (ci.center == null || ci.center === centerId));
    if (matches.length === 0) return null;
    const score = (ci: typeof matches[0]) =>
      (ci.color != null ? 1 : 0) + (ci.corner != null ? 1 : 0) + (ci.center != null ? 1 : 0);
    return matches.sort((a, b) => score(b) - score(a))[0].image;
  }, [product.config_images, colorId, cornerId, centerId]);

  // Client-side live price (no per-tap network on slow connections).
  const price = useMemo(() => {
    let p = Number(product.base_price);
    if (color) p += Number(color.price_modifier);
    if (corner) p += Number(corner.price_modifier);
    if (center) p += Number(center.price_modifier);
    if (inside) p += Number(inside.price_modifier);
    return p.toFixed(2);
  }, [product.base_price, color, corner, center, inside]);

  async function handleAdd() {
    setError("");
    if (!custom && !colorId) {
      setError("একটি রং বেছে নিন");
      return;
    }
    if (!inputs.validate()) {
      setError("প্রয়োজনীয় তথ্য পূরণ করুন");
      return;
    }
    setBusy(true);
    const selection: Record<string, number> = {};
    if (colorId) selection.color = colorId;
    if (cornerId) selection.corner = cornerId;
    if (centerId) selection.center = centerId;
    if (insideId) selection.inside = insideId;
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

  // ---- Inside-page screen (book only): same shape as the mirror/pen picker —
  // big preview of the chosen design on top, tappable thumbnail grid below.
  if (phase === "inside") {
    return (
      <div className="flex-1 pb-2">
        {inside && (
          <div className="sticky top-(--site-header-h,57px) z-[5] bg-background px-4 pt-3">
            {/* Inside pages are portrait spreads -> contain, not cover. */}
            <div className="relative mx-auto aspect-[3/4] h-[32svh] max-h-[360px] w-auto max-w-full overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-border sm:h-auto sm:w-full sm:max-w-xs">
              <Image src={mediaUrl(inside.preview_image)} alt="" fill sizes="320px" className="object-contain" priority />
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-md space-y-4 p-4">
          <button
            type="button"
            onClick={() => setPhase("cover")}
            className="inline-flex items-center gap-1 text-sm font-semibold text-plum"
          >
            <Icon name="chevronRight" size={16} className="rotate-180" /> কভারে ফিরুন
          </button>
          <h2 className="font-display text-lg font-semibold text-plum">ভেতরের পাতার ডিজাইন</h2>
          <p className="text-sm text-muted">একটি ডিজাইন বেছে নিন, উপরে বড় করে দেখা যাবে।</p>

          <div className="grid grid-cols-3 gap-3">
            {product.inside_designs.map((d) => (
              <div key={d.id}>
                <OptionCard
                  image={mediaUrl(d.preview_image)}
                  selected={d.id === insideId}
                  onClick={() => setInsideId(d.id === insideId ? null : d.id)}
                />
                {Number(d.price_modifier) > 0 && (
                  <p className="mt-1 text-center text-xs font-semibold text-gold">
                    +৳ {d.price_modifier}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Inside screen is the final step for books — collect inputs here. */}
          {inputs.node}

          {error && <p className="text-center text-sm text-error">{error}</p>}
        </div>

        <PriceBar price={custom ? "—" : price} actionLabel={submitLabel} onAction={handleAdd} busy={busy} />
      </div>
    );
  }

  // ---- Cover screen (color + corner + center, with live preview) ---- //
  return (
    <div className="flex-1 pb-2">
      {/* Live preview — always visible while configuring the cover (plan §13). */}
      <div className="sticky top-(--site-header-h,57px) z-[5] bg-background px-4 pt-3">
        <div
          className="relative mx-auto h-[32svh] max-h-[360px] w-auto max-w-full overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-border sm:h-auto sm:w-full sm:max-w-xs"
          style={{ aspectRatio: product.preview_ratio || "1 / 1" }}
        >
          {configPhoto ? (
            // Real photo for this exact combination. `contain`, not `cover`: these
            // are whole-product photos and cropping the edges cuts off the design.
            <Image src={mediaUrl(configPhoto)} alt="" fill sizes="320px" className="object-contain" priority />
          ) : (
            <>
              {color && (
                <Image src={mediaUrl(color.base_image)} alt="" fill sizes="320px" className="object-cover" priority />
              )}
              {corner && (
                <Image
                  src={mediaUrl(corner.image)} alt="" fill sizes="320px"
                  className="object-cover"
                  style={{ transform: `translate(${corner.pos_x}px, ${corner.pos_y}px) scale(${corner.scale})` }}
                />
              )}
              {center && (
                <Image
                  src={mediaUrl(center.image)} alt="" fill sizes="320px"
                  className="object-cover"
                  style={{ transform: `translate(${center.pos_x}px, ${center.pos_y}px) scale(${center.scale})` }}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-md space-y-5 p-4">
        <Step title="রং বেছে নিন">
          <Grid>
            {product.colors.map((c) => (
              <OptionCard
                key={c.id} image={mediaUrl(c.base_image)} label={c.name}
                selected={c.id === colorId} onClick={() => setColorId(c.id)}
              />
            ))}
          </Grid>
        </Step>

        {corners.length > 0 && (
          <Step title="কোণার ডিজাইন">
            <Grid>
              <OptionCard label="কোনোটি নয়" selected={cornerId === null} onClick={() => setCornerId(null)} />
              {corners.map((t) => (
                <OptionCard key={t.id} image={mediaUrl(t.image)} selected={t.id === cornerId} onClick={() => setCornerId(t.id)} />
              ))}
            </Grid>
          </Step>
        )}

        {centers.length > 0 && (
          <Step title="মাঝের ডিজাইন">
            <Grid>
              <OptionCard label="কোনোটি নয়" selected={centerId === null} onClick={() => setCenterId(null)} />
              {centers.map((t) => (
                <OptionCard key={t.id} image={mediaUrl(t.image)} selected={t.id === centerId} onClick={() => setCenterId(t.id)} />
              ))}
            </Grid>
          </Step>
        )}

        <label className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="h-5 w-5 accent-plum" />
          <span className="text-sm text-foreground">আমার নিজের ডিজাইন আছে (দাম পরে জানানো হবে)</span>
        </label>

        {/* Only when this screen is the final step (no inside page to follow). */}
        {(!hasInside || custom) && inputs.node}

        {error && <p className="text-center text-sm text-error">{error}</p>}
      </div>

      <PriceBar
        price={custom ? "—" : price}
        actionLabel={hasInside && !custom ? "পরবর্তী →" : submitLabel}
        onAction={hasInside && !custom ? goInside : handleAdd}
        busy={busy}
      />
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// Horizontal slider (swipe on touch, arrow buttons on desktop). Edge fades on
// both sides hint that there is more to scroll — on every screen size.
function Grid({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) =>
    ref.current?.scrollBy({ left: dir * 220, behavior: "smooth" });
  const arrow =
    // Shown on touch too: swiping is not obvious to this audience, and the
    // scroller now reserves room for them at every width.
    "absolute top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-plum shadow-md ring-1 ring-border transition hover:bg-surface-2 active:scale-95";
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-gradient-to-l from-background to-transparent" />
      <button type="button" aria-label="আগেরগুলো" onClick={() => scroll(-1)} className={`${arrow} left-0`}>
        <Icon name="chevronRight" size={18} className="rotate-180" />
      </button>
      <button type="button" aria-label="পরেরগুলো" onClick={() => scroll(1)} className={`${arrow} right-0`}>
        <Icon name="chevronRight" size={18} />
      </button>
      <div
        ref={ref}
        // px-12 always: the arrows overlap the first/last tile otherwise, and on
        // narrow screens that hid the "কোনোটি নয়" label behind the chevron.
        className="flex snap-x gap-3 overflow-x-auto px-12 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden *:w-24! *:shrink-0 *:snap-start"
      >
        {children}
      </div>
    </div>
  );
}
