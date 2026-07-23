"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getProduct, mediaUrl, type ProductDetail } from "@/lib/api";
import type { AdminProduct } from "@/lib/adminApi";

export type PresetEntry = {
  color?: { id: number };
  corner?: { id: number };
  center?: { id: number };
  inside?: { id: number };
  static?: { id: number };
  dupatta?: { id: number; lace_type: string; text_lines: number };
};

// Picks the pictured design for one product inside a combo. Mirrors what the
// customer sees, so the wizard can open pre-filled with exactly this.
export default function ComboPresetEditor({
  product,
  value,
  onChange,
}: {
  product: AdminProduct;
  value: PresetEntry;
  onChange: (v: PresetEntry) => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  useEffect(() => {
    getProduct(product.slug).then(setDetail).catch(() => setDetail(null));
  }, [product.slug]);

  if (!detail) {
    return <p className="text-xs text-slate-400">Loading options…</p>;
  }

  const corners = detail.toppings.filter((t) => t.placement === "corner");
  const centers = detail.toppings.filter((t) => t.placement === "center");
  const set = (patch: PresetEntry) => onChange({ ...value, ...patch });

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
      <Preview detail={detail} value={value} corners={corners} centers={centers} />
      {detail.kind === "layered" && (
        <>
          <Picker
            title="রং / Colour"
            options={detail.colors.map((c) => ({ id: c.id, image: c.base_image, label: c.name }))}
            selected={value.color?.id}
            onPick={(id) => set({ color: id == null ? undefined : { id } })}
          />
          <Picker
            title="কোণার / Corner"
            options={corners.map((t) => ({ id: t.id, image: t.image }))}
            selected={value.corner?.id}
            onPick={(id) => set({ corner: id == null ? undefined : { id } })}
          />
          <Picker
            title="মাঝের / Center"
            options={centers.map((t) => ({ id: t.id, image: t.image }))}
            selected={value.center?.id}
            onPick={(id) => set({ center: id == null ? undefined : { id } })}
          />
          {detail.inside_designs.length > 0 && (
            <Picker
              title="ভেতরের পাতা / Inside"
              options={detail.inside_designs.map((d) => ({ id: d.id, image: d.preview_image }))}
              selected={value.inside?.id}
              onPick={(id) => set({ inside: id == null ? undefined : { id } })}
            />
          )}
        </>
      )}

      {(detail.kind === "gallery" || detail.kind === "simple") && (
        <Picker
          title="ডিজাইন / Design"
          options={detail.static_designs.map((d) => ({ id: d.id, image: d.image }))}
          selected={value.static?.id}
          onPick={(id) => set({ static: id == null ? undefined : { id } })}
        />
      )}

      {detail.kind === "dupatta" && (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">ওড়না / Dupatta option</p>
          <div className="flex flex-wrap gap-2">
            <Chip active={value.dupatta == null} onClick={() => set({ dupatta: undefined })}>
              None
            </Chip>
            {detail.dupatta_options.map((o) => (
              <Chip
                key={o.id}
                active={value.dupatta?.id === o.id}
                onClick={() =>
                  set({
                    dupatta:
                      value.dupatta?.id === o.id
                        ? undefined
                        : { id: o.id, lace_type: o.lace_type, text_lines: o.text_lines },
                  })
                }
              >
                {o.lace_type === "single" ? "সিঙ্গেল" : "চার"} · {o.text_lines} লাইন
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Live preview of the picked design — same rules the customer's configurator uses:
 *  a real config photo when the exact combination has one, else stacked overlays. */
function Preview({
  detail,
  value,
  corners,
  centers,
}: {
  detail: ProductDetail;
  value: PresetEntry;
  corners: ProductDetail["toppings"];
  centers: ProductDetail["toppings"];
}) {
  const colorId = value.color?.id ?? null;
  const cornerId = value.corner?.id ?? null;
  const centerId = value.center?.id ?? null;

  let stack: string[] = [];
  let single: string | null = null;

  if (detail.kind === "layered") {
    const match = detail.config_images.find(
      (c) => c.color === colorId && c.corner === cornerId && c.center === centerId,
    );
    if (match) {
      single = match.image;
    } else {
      const base = detail.colors.find((c) => c.id === colorId)?.base_image;
      const cr = corners.find((t) => t.id === cornerId)?.image;
      const ce = centers.find((t) => t.id === centerId)?.image;
      stack = [base, cr, ce].filter(Boolean) as string[];
    }
  } else if (detail.kind === "dupatta") {
    single = detail.dupatta_options.find((o) => o.id === value.dupatta?.id)?.preview_image ?? null;
  } else {
    single = detail.static_designs.find((d) => d.id === value.static?.id)?.image ?? null;
  }

  const empty = !single && stack.length === 0;

  return (
    <div className="flex items-start gap-3">
      <div
        className="relative w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
        style={{ aspectRatio: detail.preview_ratio || "1 / 1" }}
      >
        {single && (
          <Image src={mediaUrl(single)} alt="" fill sizes="112px" className="object-cover" />
        )}
        {stack.map((src, i) => (
          <Image key={i} src={mediaUrl(src)} alt="" fill sizes="112px" className="object-cover" />
        ))}
        {empty && (
          <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-slate-400">
            Pick options to preview
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        This is what the customer sees for this item — and what the wizard opens pre-filled with.
      </p>
    </div>
  );
}

function Picker({
  title,
  options,
  selected,
  onPick,
}: {
  title: string;
  options: { id: number; image?: string | null; label?: string }[];
  selected?: number;
  onPick: (id: number | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">{title}</p>
      <div className="flex flex-wrap gap-2">
        <Chip active={selected == null} onClick={() => onPick(null)}>None</Chip>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.label}
            onClick={() => onPick(selected === o.id ? null : o.id)}
            className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 ${
              selected === o.id ? "border-plum" : "border-slate-200"
            }`}
          >
            {o.image ? (
              <Image src={mediaUrl(o.image)} alt="" fill sizes="56px" className="object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-[10px] text-slate-400">
                #{o.id}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-xs ${
        active ? "border-plum bg-plum/10 text-plum" : "border-slate-200 text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
