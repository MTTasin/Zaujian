"use client";

import type { ProductDetail } from "@/lib/api";
import DupattaConfigurator from "./DupattaConfigurator";
import GalleryConfigurator from "./GalleryConfigurator";
import LayeredConfigurator from "./LayeredConfigurator";

export type { PresetConfig } from "./preset";
import type { PresetConfig } from "./preset";

// Picks the right configurator by category. onAdded/submitLabel drive wizard mode.
export default function ConfiguratorSwitch({
  product,
  onAdded,
  submitLabel,
  editId,
  initialConfig,
}: {
  product: ProductDetail;
  onAdded?: () => void;
  submitLabel?: string;
  /** Cart item id being edited — PATCH that line instead of adding a new one. */
  editId?: number;
  /** Preset design (from a combo) to start from instead of the defaults. */
  initialConfig?: PresetConfig;
}) {
  const k = product.kind;
  if (k === "layered")
    return <LayeredConfigurator product={product} onAdded={onAdded} submitLabel={submitLabel} editId={editId} initialConfig={initialConfig} />;
  if (k === "dupatta")
    return <DupattaConfigurator product={product} onAdded={onAdded} submitLabel={submitLabel} editId={editId} initialConfig={initialConfig} />;
  // gallery + simple both use the gallery flow (simple may have no designs = buy as-is)
  return <GalleryConfigurator product={product} onAdded={onAdded} submitLabel={submitLabel} editId={editId} initialConfig={initialConfig} />;
}
