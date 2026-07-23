"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminGet, adminPost, PRODUCT_KINDS, type AdminProduct } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, Select, Table, Th, Td, AdminEmpty } from "@/components/admin/ui";
import CategoryInput from "@/components/admin/CategoryInput";
import { Icon } from "@/components/ui/Icon";

// Only the customizable kinds (exclude plain "simple" e-commerce products).
const CUSTOM_KINDS = PRODUCT_KINDS.filter((k) => k.value !== "simple");

export default function AdminCustomization() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminGet<AdminProduct[]>("products/?group=custom").then(setProducts).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await adminPost("products/", {
        name: fd.get("name"),
        kind: fd.get("kind"),
        category: fd.get("category"),
        base_price: fd.get("base_price"),
        active: true,
      });
      (e.target as HTMLFormElement).reset();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Customization"
        subtitle="Customizable products (book, box, pen, mirror, dupatta) with their design options."
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <Card className="mb-6 p-4">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
          <Field label="Name (Bengali)">
            <TextInput name="name" required placeholder="e.g. কাস্টম বই" />
          </Field>
          <Field label="Type">
            <Select name="kind" title="How it's customized">
              {CUSTOM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <CategoryInput name="category" placeholder="e.g. বই" />
          </Field>
          <Field label="Base price (৳)">
            <TextInput name="base_price" type="number" step="0.01" required />
          </Field>
          <div className="flex items-end">
            <AdminButton type="submit" disabled={busy} icon="plus" className="w-full">Add</AdminButton>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          After adding, open it to upload photos and set up the customization options (colors, designs, dupatta options, etc.).
        </p>
      </Card>

      {products.length === 0 ? (
        <AdminEmpty icon="sliders" title="No customizable products yet" hint="Add your first customizable item above." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th><Th>Type</Th><Th>Category</Th>
              <Th>Base price</Th><Th>Images</Th><Th>Tags</Th>
              <Th>Active</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{p.name}</Td>
                <Td className="text-slate-500">{p.kind}</Td>
                <Td>{p.category}</Td>
                <Td className="tabular-nums">৳ {p.base_price}</Td>
                <Td>{p.image_count}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.is_featured && <span className="rounded-full bg-plum/10 px-2 py-0.5 text-xs font-medium text-plum">Featured</span>}
                    {p.is_popular && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">Popular</span>}
                  </div>
                </Td>
                <Td>
                  {p.active
                    ? <span className="text-emerald-600"><Icon name="check" size={16} /></span>
                    : <span className="text-slate-300">—</span>}
                </Td>
                <Td><Link href={`/admin/products/${p.id}`} className="font-semibold text-plum hover:underline">Manage</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
