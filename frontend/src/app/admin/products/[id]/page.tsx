"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CategoryInput from "@/components/admin/CategoryInput";
import ConfigImageManager from "@/components/admin/ConfigImageManager";
import DropZone from "@/components/admin/DropZone";
import OptionManager, { type FieldDef } from "@/components/admin/OptionManager";
import {
  adminDelete, adminGet, adminPatch, adminPost, adminProductFields,
  deleteProductImage, listProductImages, uploadProductImage,
  PRODUCT_KINDS, PREVIEW_RATIOS,
  type AdminProduct, type AdminProductField, type AdminProductImage,
} from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, TextArea, Select, Loading } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

const PLACEMENT: FieldDef = {
  name: "placement", label: "Placement", type: "select", defaultValue: "corner",
  options: [{ value: "corner", label: "Corner" }, { value: "center", label: "Center" }],
};

export default function AdminProductEdit() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function deleteProduct() {
    if (!confirm("Delete this product and all its options? This cannot be undone.")) return;
    setError("");
    try {
      await adminDelete(`products/${pid}/`);
      router.push("/admin/products");
    } catch {
      setError("Could not delete — it may be referenced by existing orders. Disable it instead.");
    }
  }

  function load() {
    adminGet<AdminProduct>(`products/${pid}/`).then(setProduct).catch((e) => setError(e.message));
  }
  useEffect(load, [pid]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setMsg(""); setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const updated = await adminPatch<AdminProduct>(`products/${pid}/`, {
        name: fd.get("name"),
        kind: fd.get("kind"),
        category: fd.get("category"),
        base_price: fd.get("base_price"),
        preview_ratio: fd.get("preview_ratio"),
        exclusive_group: fd.get("exclusive_group"),
        customize_order: Number(fd.get("customize_order")) || 0,
        active: fd.get("active") === "on",
        allows_individual_purchase: fd.get("allows_individual_purchase") === "on",
        description: fd.get("description"),
        compare_at_price: fd.get("compare_at_price") || null,
        stock: fd.get("stock") || 0,
        track_stock: fd.get("track_stock") === "on",
        low_stock_threshold: fd.get("low_stock_threshold") || 0,
        is_featured: fd.get("is_featured") === "on",
        is_popular: fd.get("is_popular") === "on",
        home_order: fd.get("home_order") || 0,
      });
      setProduct(updated);
      setMsg("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  if (error && !product) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!product) return <Loading />;

  const kind = product.kind;

  return (
    <div>
      <PageHeader
        title={product.name}
        subtitle={`Kind: ${kind}`}
        action={
          <div className="flex items-center gap-4">
            <Link
              href={kind === "simple" ? "/admin/products" : "/admin/customization"}
              className="text-sm font-medium text-plum hover:underline"
            >
              ← {kind === "simple" ? "Products" : "Customization"}
            </Link>
            <button onClick={deleteProduct} className="text-sm font-medium text-red-600 hover:underline">Delete product</button>
          </div>
        }
      />

      {msg && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="space-y-5">
        <Card className="p-5">
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <TextInput name="name" defaultValue={product.name} />
            </Field>
            <Field label="Kind (how it's customized)">
              <Select name="kind" defaultValue={product.kind}>
                {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
            </Field>
            <Field label="Category label (shown to customers)" hint="Internal grouping for the customizer. Storefront listings get their own category on the Combos page.">
              <CategoryInput name="category" defaultValue={product.category} placeholder="e.g. বই, আতর" />
            </Field>
            <Field
              label="Exclusive group"
              hint="Products sharing this group can't be picked together (e.g. type nikahnama on book, frame, thumb). Blank = no restriction."
            >
              <TextInput
                name="exclusive_group"
                defaultValue={product.exclusive_group}
                placeholder="e.g. nikahnama"
              />
            </Field>
            <Field label="Customize order" hint="Position in the customize picker. Lower shows first.">
              <TextInput
                name="customize_order"
                type="number"
                defaultValue={product.customize_order}
              />
            </Field>
            <Field
              label="Base price"
              hint={
                product.kind === "dupatta"
                  ? "IGNORED for dupatta — the price comes from the Dupatta options (lace + lines), which are absolute prices, not modifiers. Set the price there."
                  : "Starting price. Option price modifiers are added on top."
              }
            >
              <TextInput name="base_price" type="number" step="0.01" defaultValue={product.base_price} />
            </Field>
            <Field label="Preview ratio (configurator/gallery aspect)">
              <Select name="preview_ratio" defaultValue={product.preview_ratio}>
                {PREVIEW_RATIOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </Field>
            <div />
            <CheckboxField name="active" defaultChecked={product.active} label="Active" />
            <CheckboxField name="allows_individual_purchase" defaultChecked={product.allows_individual_purchase} label="Allow individual purchase" />

            <div className="border-t border-slate-100 pt-4 md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-800">E-commerce details</span>
            </div>
            <div className="md:col-span-2">
              <Field label="Description">
                <TextArea name="description" rows={3} defaultValue={product.description} />
              </Field>
            </div>
            <Field label="Compare-at price" hint="Optional, shows as strikethrough">
              <TextInput name="compare_at_price" type="number" step="0.01" defaultValue={product.compare_at_price ?? ""} />
            </Field>
            <Field label="Stock">
              <TextInput name="stock" type="number" defaultValue={product.stock} />
            </Field>
            <CheckboxField name="track_stock" defaultChecked={product.track_stock} label="Track stock" />
            <Field label="Low stock threshold">
              <TextInput name="low_stock_threshold" type="number" defaultValue={product.low_stock_threshold} />
            </Field>
            <CheckboxField name="is_featured" defaultChecked={product.is_featured} label="Show in Featured" />
            <CheckboxField name="is_popular" defaultChecked={product.is_popular} label="Show in Popular" />
            <Field label="Home order" hint="Lower shows first">
              <TextInput name="home_order" type="number" defaultValue={product.home_order} />
            </Field>

            <div className="md:col-span-2">
              <AdminButton type="submit" disabled={busy}>Save</AdminButton>
            </div>
          </form>
        </Card>

        <ProductGallery productId={pid} />

        <ProductSpecs productId={pid} />

        {/* Only the configurator renders these, so don't offer them for plain items. */}
        {product.kind !== "simple" && <CustomerInputFields productId={pid} />}

        {kind === "layered" && (
          <>
            <OptionManager title="Colors" endpoint="colors" productId={pid} imageField="base_image"
              fields={[
                { name: "name", label: "Name" },
                { name: "base_image", label: "Base image" },
                { name: "price_modifier", label: "Price +", type: "number", defaultValue: "0" },
              ]} />
            <OptionManager title="Toppings (corner / center)" endpoint="toppings" productId={pid} imageField="image"
              fields={[
                PLACEMENT,
                { name: "image", label: "PNG overlay" },
                { name: "price_modifier", label: "Price +", type: "number", defaultValue: "0" },
                { name: "pos_x", label: "X", type: "number", defaultValue: "0" },
                { name: "pos_y", label: "Y", type: "number", defaultValue: "0" },
                { name: "scale", label: "Scale", type: "number", defaultValue: "1" },
              ]} />
            <OptionManager title="Inside designs (optional)" endpoint="inside" productId={pid} imageField="preview_image"
              fields={[
                { name: "preview_image", label: "Preview" },
                { name: "price_modifier", label: "Price +", type: "number", defaultValue: "0" },
              ]} />
            <ConfigImageManager productId={pid} ratio={product.preview_ratio} />
          </>
        )}

        {kind === "gallery" && (
          <OptionManager title="Designs (leave empty for buy-as-is)" endpoint="static" productId={pid} imageField="image"
            fields={[
              { name: "image", label: "Design image" },
              { name: "price_modifier", label: "Price +", type: "number", defaultValue: "0" },
            ]} />
        )}

        {kind === "dupatta" && (
          <OptionManager title="Dupatta options" endpoint="dupatta" productId={pid} imageField="preview_image"
            singleImage
            fields={[
              { name: "lace_type", label: "Lace", type: "select", defaultValue: "single",
                options: [{ value: "single", label: "Single lace" }, { value: "four", label: "Four lace" }] },
              { name: "text_lines", label: "Lines", type: "number", defaultValue: "1" },
              { name: "preview_image", label: "Preview" },
              { name: "price", label: "Price", type: "number", defaultValue: "0" },
            ]} />
        )}
      </div>
    </div>
  );
}

function CheckboxField({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300 text-plum focus:ring-plum/30" />
      {label}
    </label>
  );
}

// Catalog photo gallery — the real product photos shown on the storefront.
// Separate from the customization/configurator option images above.
function ProductGallery({ productId }: { productId: number }) {
  const [images, setImages] = useState<AdminProductImage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  function load() {
    listProductImages(productId).then(setImages).catch((e) => setError(e.message));
  }
  useEffect(load, [productId]);

  async function addImages(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const formEl = e.currentTarget;
    const fileInput = formEl.elements.namedItem("image") as HTMLInputElement | null;
    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    try {
      for (const file of files) {
        await uploadProductImage(productId, file);
      }
      formEl.reset(); setResetTick((t) => t + 1); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function del(imgId: number) {
    if (!confirm("Delete this photo?")) return;
    await deleteProductImage(imgId);
    load();
  }

  async function makePrimary(img: AdminProductImage) {
    try {
      // Unset any other primary photo first so only one stays primary.
      const others = images.filter((i) => i.id !== img.id && i.is_primary);
      for (const o of others) {
        await adminPatch(`product-images/${o.id}/`, { is_primary: false });
      }
      await adminPatch(`product-images/${img.id}/`, { is_primary: true });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-900">Catalog photo gallery</h2>
      <p className="mb-3 text-xs text-slate-400">The real product photos shown on the storefront (separate from the customizer&apos;s option images).</p>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {images.map((img) => (
          <div key={img.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center text-xs">
            <div className="relative mx-auto mb-1 h-24 w-24 overflow-hidden rounded">
              <Image src={img.image} alt={img.alt} fill sizes="96px" className="object-cover" />
            </div>
            {img.is_primary && (
              <div className="mb-1 flex items-center justify-center gap-1 font-medium text-gold">
                <Icon name="star" size={12} fill /> Primary
              </div>
            )}
            <div className="flex items-center justify-center gap-2">
              {!img.is_primary && (
                <button onClick={() => makePrimary(img)} className="font-semibold text-plum hover:underline">Set primary</button>
              )}
              <button onClick={() => del(img.id)} className="text-red-600 hover:underline">Delete</button>
            </div>
          </div>
        ))}
        {images.length === 0 && <p className="col-span-full text-sm text-slate-400">No photos yet</p>}
      </div>

      <form onSubmit={addImages} className="flex items-end gap-3">
        <div className="min-w-56 flex-1">
          <DropZone name="image" label="Add photo(s) — drag & drop or click" multiple resetSignal={resetTick} />
        </div>
        <AdminButton type="submit" disabled={busy} icon="upload">Upload</AdminButton>
      </form>
    </Card>
  );
}

interface Spec { id: number; label: string; value: string; order: number }

// Product detail specifications (label/value rows shown on the storefront page).
function CustomerInputFields({ productId }: { productId: number }) {
  const [rows, setRows] = useState<AdminProductField[]>([]);
  const [label, setLabel] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [required, setRequired] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminProductFields.list(productId).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(load, [productId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true); setError("");
    try {
      await adminProductFields.create({
        product: productId, label, placeholder, required, order: rows.length,
      });
      setLabel(""); setPlaceholder(""); setRequired(true); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await adminProductFields.remove(id);
    load();
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-900">Customer input fields</h2>
      <p className="mb-3 text-xs text-slate-400">
        Questions the customer answers while customizing this product (e.g. বরের নাম,
        কনের নাম, এখানে কি বসবে?). Required fields block the confirm button.
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {rows.length > 0 && (
        <div className="mb-3 divide-y divide-slate-100">
          {rows.map((f) => (
            <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
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

      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
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
        <AdminButton type="submit" disabled={busy} icon="plus">Add</AdminButton>
      </form>
    </Card>
  );
}

function ProductSpecs({ productId }: { productId: number }) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminGet<Spec[]>(`product-specs/?product=${productId}`).then(setSpecs).catch((e) => setError(e.message));
  }
  useEffect(load, [productId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !value.trim()) return;
    setBusy(true); setError("");
    try {
      await adminPost("product-specs/", { product: productId, label, value, order: specs.length });
      setLabel(""); setValue(""); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await adminDelete(`product-specs/${id}/`);
    load();
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-900">Details / Specifications</h2>
      <p className="mb-3 text-xs text-slate-400">
        Label/value rows shown on the product page (e.g. উপকরণ → প্রিমিয়াম, সাইজ → A5, যা যা থাকছে → বই + বক্স + কলম).
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {specs.length > 0 && (
        <div className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {specs.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-slate-700">{s.label}</span>
              <span className="flex-1 text-slate-500">{s.value}</span>
              <button onClick={() => del(s.id)} className="text-red-600 hover:underline" aria-label="Delete">
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field label="Label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. উপকরণ" /></Field>
        </div>
        <div className="min-w-40 flex-[2]">
          <Field label="Value"><TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. প্রিমিয়াম লেদার" /></Field>
        </div>
        <AdminButton type="submit" disabled={busy} icon="plus">Add</AdminButton>
      </form>
    </Card>
  );
}
