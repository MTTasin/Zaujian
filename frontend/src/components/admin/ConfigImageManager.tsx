"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { adminDelete, adminForm, adminGet, adminPatch } from "@/lib/adminApi";
import { Card, AdminButton } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";
import DropZone from "./DropZone";

interface Opt { id: number; name?: string; placement?: string; base_image?: string; image?: string }
interface CfgImg { id: number; color: number | null; corner: number | null; center: number | null; image: string }

// Upload a real photo for a specific color+corner+center combination, chosen
// visually in a popup. Shown to the customer instead of stacked overlays.
export default function ConfigImageManager({ productId, ratio = "1 / 1" }: { productId: number; ratio?: string }) {
  const [colors, setColors] = useState<Opt[]>([]);
  const [toppings, setToppings] = useState<Opt[]>([]);
  const [rows, setRows] = useState<CfgImg[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CfgImg | null>(null);

  function loadRows() {
    adminGet<CfgImg[]>(`config-images/?product=${productId}`).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => {
    adminGet<Opt[]>(`colors/?product=${productId}`).then(setColors).catch(() => {});
    adminGet<Opt[]>(`toppings/?product=${productId}`).then(setToppings).catch(() => {});
    loadRows();
  }, [productId]);

  const corners = toppings.filter((t) => t.placement === "corner");
  const centers = toppings.filter((t) => t.placement === "center");

  const thumb = (id: number | null, list: Opt[]) => {
    const o = list.find((x) => x.id === id);
    return o?.base_image || o?.image || null;
  };
  const label = (id: number | null, list: Opt[], fb: string) =>
    id == null ? "Any" : (list.find((x) => x.id === id)?.name ?? `${fb} #${id}`);

  async function remove(id: number) {
    if (!confirm("Delete?")) return;
    await adminDelete(`config-images/${id}/`); loadRows();
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Configuration photos</h2>
        <AdminButton icon="plus" onClick={() => { setEditing(null); setOpen(true); }}>Add configuration photo</AdminButton>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        A real photo for a chosen color + corner + center. Shown to the customer instead of stacked
        overlays when their pick matches. Leave a field &quot;Any&quot; to match anything.
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center text-xs">
            <div className="relative mx-auto mb-1 h-24 w-24 overflow-hidden rounded">
              <Image src={r.image} alt="" fill sizes="96px" className="object-cover" />
            </div>
            <div className="text-slate-500">Color: {label(r.color, colors, "color")}</div>
            <div className="text-slate-500">Corner: {label(r.corner, corners, "corner")}</div>
            <div className="text-slate-500">Center: {label(r.center, centers, "center")}</div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <button onClick={() => { setEditing(r); setOpen(true); }} className="text-plum hover:underline">Edit</button>
              <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">Delete</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="col-span-full text-sm text-slate-400">None yet</p>}
      </div>

      {open && (
        <ConfigModal
          productId={productId} colors={colors} corners={corners} centers={centers} ratio={ratio}
          existing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={() => { setOpen(false); setEditing(null); loadRows(); }}
        />
      )}
    </Card>
  );
}

function ConfigModal({
  productId, colors, corners, centers, ratio, existing, onClose, onSaved,
}: {
  productId: number; colors: Opt[]; corners: Opt[]; centers: Opt[]; ratio: string;
  existing: CfgImg | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [color, setColor] = useState<number | null>(existing?.color ?? null);
  const [corner, setCorner] = useState<number | null>(existing?.corner ?? null);
  const [center, setCenter] = useState<number | null>(existing?.center ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setBusy(true);
    const fd = new FormData(e.currentTarget);   // grabs DropZone's hidden file input
    const file = fd.get("image");
    try {
      if (existing) {
        // Fields via JSON so "Any" (null) clears cleanly; empty string breaks FK on multipart.
        await adminPatch(`config-images/${existing.id}/`, { color, corner, center });
        if (file) {
          const imgForm = new FormData();
          imgForm.append("image", file);
          await adminForm(`config-images/${existing.id}/`, imgForm, "PATCH");
        }
      } else {
        if (!file) { setError("Please choose a photo"); setBusy(false); return; }
        fd.append("product", String(productId));
        fd.append("active", "true");
        if (color != null) fd.append("color", String(color));
        if (corner != null) fd.append("corner", String(corner));
        if (center != null) fd.append("center", String(center));
        await adminForm("config-images/", fd);
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{existing ? "Edit configuration photo" : "New configuration photo"}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* Live preview of the chosen combination (stacked overlays) */}
        <div className="mb-4 flex justify-center">
          <div className="relative w-40 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
            style={{ aspectRatio: ratio || "1 / 1" }}>
            {(() => {
              const c = colors.find((o) => o.id === color)?.base_image;
              const cr = corners.find((o) => o.id === corner)?.image;
              const ce = centers.find((o) => o.id === center)?.image;
              return (
                <>
                  {c && <Image src={c} alt="" fill sizes="176px" className="object-cover" />}
                  {cr && <Image src={cr} alt="" fill sizes="176px" className="object-cover" />}
                  {ce && <Image src={ce} alt="" fill sizes="176px" className="object-cover" />}
                  {!c && !cr && !ce && (
                    <span className="flex h-full items-center justify-center text-xs text-slate-400">Preview</span>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <Picker title="Color" opts={colors} value={color} onPick={setColor} field="base_image" />
        <Picker title="Corner design" opts={corners} value={corner} onPick={setCorner} field="image" />
        <Picker title="Center design" opts={centers} value={center} onPick={setCenter} field="image" />

        <div className="mt-4">
          <p className="mb-1 text-sm font-medium text-slate-700">
            {existing ? "Replace photo (optional)" : "Photo for this combination"}
          </p>
          {existing && (
            <div className="mb-2 flex items-center gap-2">
              <div className="relative h-16 w-16 overflow-hidden rounded border border-slate-200">
                <Image src={existing.image} alt="" fill sizes="64px" className="object-cover" />
              </div>
              <span className="text-xs text-slate-400">Current photo — leave empty to keep it.</span>
            </div>
          )}
          <DropZone name="image" multiple={false} />
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <AdminButton type="button" variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</AdminButton>
        </div>
      </form>
    </div>
  );
}

function Picker({
  title, opts, value, onPick, field,
}: {
  title: string; opts: Opt[]; value: number | null; onPick: (v: number | null) => void; field: "base_image" | "image";
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium text-slate-700">{title}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onPick(null)}
          className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 text-xs ${value == null ? "border-plum bg-plum/5 text-plum" : "border-slate-200 text-slate-500"}`}>
          Any
        </button>
        {opts.map((o) => {
          const src = o[field];
          return (
            <button type="button" key={o.id} onClick={() => onPick(o.id)}
              className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 ${value === o.id ? "border-plum" : "border-slate-200"}`}>
              {src ? <Image src={src} alt="" fill sizes="64px" className="object-cover" /> : <span className="text-xs">#{o.id}</span>}
            </button>
          );
        })}
        {opts.length === 0 && <span className="text-xs text-slate-400">none uploaded</span>}
      </div>
    </div>
  );
}
