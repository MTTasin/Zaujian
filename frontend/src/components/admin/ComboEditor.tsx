"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminGet, listCombos, createCombo, updateCombo,
  uploadComboImage, deleteComboImage, adminComboFields,
  type AdminCombo, type AdminProduct, type AdminComboField,
} from "@/lib/adminApi";
import {
  Card, AdminButton, Field, TextInput, TextArea, Loading,
} from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";
import ComboPresetEditor, { type PresetEntry } from "@/components/admin/ComboPresetEditor";
import CategoryInput from "@/components/admin/CategoryInput";

export const BLANK = {
  name: "", slug: "", category: "", price: "", description: "",
  products: [] as number[],
  // Pictured design per product id — seeds the wizard + snapshots onto orders.
  preset_config: {} as Record<string, PresetEntry>,
  featured: false, active: true,
};

export type ComboFormState = typeof BLANK & { id?: number };

/**
 * The whole combo editor, on its own page. It carries image upload, product
 * linking, per-product preset design and customer input fields — far too much
 * to live inline on the list page.
 *
 * Omit `comboId` to create.
 */
export default function ComboEditor({ comboId }: { comboId?: number }) {
  const router = useRouter();
  const [form, setForm] = useState<ComboFormState | null>(comboId ? null : { ...BLANK });
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Images picked while CREATING a combo — uploaded right after it gets an id.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => {
    adminGet<AdminProduct[]>("products/").then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!comboId) return;
    listCombos()
      .then((list) => {
        const c = list.find((x) => x.id === comboId);
        if (!c) { setError("Combo not found."); return; }
        setForm({
          id: c.id, name: c.name, slug: c.slug, category: c.category ?? "",
          price: c.price, description: c.description, products: c.products,
          preset_config: (c.preset_config ?? {}) as Record<string, PresetEntry>,
          featured: c.featured, active: c.active,
        });
      })
      .catch((e) => setError(e.message));
  }, [comboId]);

  function toggleProduct(id: number) {
    if (!form) return;
    setForm({
      ...form,
      products: form.products.includes(id)
        ? form.products.filter((p) => p !== id)
        : [...form.products, id],
    });
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.price) {
      setError("Name and price are required.");
      return;
    }
    setBusy(true); setError("");
    // Drop presets for products that are no longer ticked.
    const preset = Object.fromEntries(
      Object.entries(form.preset_config).filter(([pid]) => form.products.includes(Number(pid))),
    );
    const body = {
      name: form.name, slug: form.slug || undefined, category: form.category,
      price: form.price, description: form.description, products: form.products,
      preset_config: preset,
      featured: form.featured, active: form.active,
    };
    try {
      if (form.id) {
        await updateCombo(form.id, body);
      } else {
        const created = await createCombo(body);
        // Upload the images picked during creation now that we have an id.
        for (let i = 0; i < pendingFiles.length; i++) {
          await uploadComboImage(created.id, pendingFiles[i], i);
        }
      }
      setPendingFiles([]);
      router.push("/admin/combos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed (a combo can't mix one exclusive group).");
      setBusy(false);
    }
  }

  if (error && !form) {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>;
  }
  if (!form) return <Loading />;

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      <ComboForm
        form={form}
        setForm={setForm}
        products={products}
        toggleProduct={toggleProduct}
        onSave={save}
        onCancel={() => router.push("/admin/combos")}
        onImagesChanged={() => {}}
        busy={busy}
        pendingFiles={pendingFiles}
        setPendingFiles={setPendingFiles}
      />
    </>
  );
}

function ComboForm({
  form, setForm, products, toggleProduct, onSave, onCancel, onImagesChanged, busy,
  pendingFiles, setPendingFiles,
}: {
  form: ComboFormState;
  setForm: (f: ComboFormState) => void;
  products: AdminProduct[];
  toggleProduct: (id: number) => void;
  onSave: () => void;
  onCancel: () => void;
  onImagesChanged: () => void;
  busy: boolean;
  pendingFiles: File[];
  setPendingFiles: (f: File[]) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold text-slate-900">{form.id ? "Edit listing" : "New listing"}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name (Bengali)">
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. রয়্যাল কম্বো" />
        </Field>
        <Field label="URL slug (blank = auto)">
          <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="e.g. royal-combo" />
        </Field>
        <Field
          label="Category (shown on the card)"
          hint="Drives the badge and the /products filter. Pick an existing one so listings group together — a one-item listing should say দুপাট্টা, not কম্বো."
        >
          <CategoryInput
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="e.g. দুপাট্টা"
          />
        </Field>
        <Field label="Price (৳)">
          <TextInput type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </Field>
        <div className="flex items-end gap-5 pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
        </div>
        <div className="md:col-span-2">
          <Field label="Description — the authoritative 'যা যা থাকছে' contents list" >
            <TextArea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. বই + বক্স + কলম + স্ট্যাম্প প্যাড" />
          </Field>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-slate-800">Linked customizable items</p>
        <p className="mb-2 text-xs text-slate-400">
          Tick the products that open in the wizard when a customer taps “কিছু পরিবর্তন করুন”, then
          set the <strong>pictured design</strong> below each — the wizard opens pre-filled with it,
          and it’s recorded on as-is orders. (A combo can’t mix one exclusive group.)
        </p>
        <div className="space-y-3">
          {products.map((p) => {
            const on = form.products.includes(p.id);
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input type="checkbox" checked={on} onChange={() => toggleProduct(p.id)} />
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs font-normal text-slate-400">{p.kind}</span>
                </label>
                {on && (
                  <ComboPresetEditor
                    product={p}
                    value={form.preset_config[String(p.id)] ?? {}}
                    onChange={(v) =>
                      setForm({
                        ...form,
                        preset_config: { ...form.preset_config, [String(p.id)]: v },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
          {products.length === 0 && (
            <span className="text-xs text-slate-400">No products yet.</span>
          )}
        </div>
      </div>

      {form.id != null && <ComboFields comboId={form.id} />}

      {form.id != null ? (
        <ComboImages comboId={form.id} onChanged={onImagesChanged} />
      ) : (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-1 text-sm font-semibold text-slate-800">Images</p>
          <p className="mb-2 text-xs text-slate-400">
            Uploaded automatically when you save. A combo with no image shows a placeholder on /products.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-plum">
            <Icon name="upload" size={16} />
            {pendingFiles.length ? `${pendingFiles.length} image(s) selected` : "Choose images"}
            <input
              type="file" accept="image/*" multiple hidden
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                setPendingFiles(files.filter((f) => f.type.startsWith("image/") && f.size <= 15 * 1024 * 1024));
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <AdminButton onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</AdminButton>
        <button onClick={onCancel} className="text-sm text-slate-500 hover:underline">Cancel</button>
      </div>
    </Card>
  );
}

// Questions the customer answers on the combo page before adding to cart.
// Mirrors the per-product "Customer input fields" manager.
function ComboFields({ comboId }: { comboId: number }) {
  const [rows, setRows] = useState<AdminComboField[]>([]);
  const [label, setLabel] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [required, setRequired] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminComboFields.list(comboId).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(load, [comboId]);

  async function add() {
    if (!label.trim()) return;
    setBusy(true); setError("");
    try {
      await adminComboFields.create({
        combo: comboId, label, placeholder, required, order: rows.length,
      });
      setLabel(""); setPlaceholder(""); setRequired(true); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await adminComboFields.remove(id).catch(() => {});
    load();
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="mb-1 text-sm font-semibold text-slate-800">Customer input fields</p>
      <p className="mb-2 text-xs text-slate-400">
        Questions asked on this combo&apos;s page before “কার্টে যোগ করুন” (e.g. বরের নাম,
        কনের নাম, বিয়ের তারিখ). Required ones block the button. Add as many as you need.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{error}</p>}

      {rows.length > 0 && (
        <div className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{f.label}</span>
              {f.placeholder && <span className="text-slate-400">{f.placeholder}</span>}
              <span className={`text-xs ${f.required ? "text-plum" : "text-slate-400"}`}>
                {f.required ? "required" : "optional"}
              </span>
              <button onClick={() => del(f.id)} className="ml-auto text-red-600" aria-label="Delete field">
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field label="Label">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. বরের নাম" />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field label="Placeholder (optional)">
            <TextInput value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} placeholder="e.g. পুরো নাম" />
          </Field>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        <AdminButton type="button" onClick={add} disabled={busy} icon="plus">Add field</AdminButton>
      </div>
    </div>
  );
}

function ComboImages({ comboId, onChanged }: { comboId: number; onChanged: () => void }) {
  const [combo, setCombo] = useState<AdminCombo | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgError, setImgError] = useState("");

  function reload() {
    listCombos().then((list) => setCombo(list.find((c) => c.id === comboId) ?? null)).catch(() => {});
  }
  useEffect(reload, [comboId]);

  async function add(files: File[]) {
    const valid = files.filter((f) => f.type.startsWith("image/") && f.size <= 15 * 1024 * 1024);
    if (!valid.length) return;
    setBusy(true);
    for (let i = 0; i < valid.length; i++) await uploadComboImage(comboId, valid[i], i);
    setBusy(false);
    reload();
    onChanged();
  }
  async function del(id: number) {
    setImgError("");
    try {
      await deleteComboImage(id);
    } catch (e) {
      // A 404 means it's already gone (stale list) — treat as success and refresh.
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("404")) {
        setImgError(msg || "Could not delete the image.");
      }
    }
    reload();      // always resync with the server so stale thumbnails disappear
    onChanged();
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="mb-2 text-sm font-semibold text-slate-800">Images</p>
      {imgError && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{imgError}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {combo?.images.map((img) => (
          <div key={img.id} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
            <Image src={img.image} alt="" fill sizes="80px" className="object-cover" />
            <button
              onClick={() => del(img.id)}
              className="absolute right-0.5 top-0.5 hidden rounded bg-red-600 px-1 text-xs text-white group-hover:block"
            >✕</button>
          </div>
        ))}
        {combo && combo.images.length === 0 && <span className="text-xs text-slate-400">No images yet.</span>}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-plum">
        <Icon name="upload" size={16} />
        {busy ? "Uploading…" : "Add images"}
        <input
          type="file" accept="image/*" multiple hidden
          onChange={(e) => { if (e.target.files) add(Array.from(e.target.files)); e.target.value = ""; }}
        />
      </label>
    </div>
  );
}
