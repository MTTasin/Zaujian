"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminGet, adminPost, adminPatch, type AdminProduct } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, Table, Th, Td, AdminEmpty } from "@/components/admin/ui";
import CategoryInput from "@/components/admin/CategoryInput";
import { Icon } from "@/components/ui/Icon";

export default function AdminProducts() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    adminGet<AdminProduct[]>("products/?group=simple").then(setProducts).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await adminPost("products/", {
        name: fd.get("name"),
        kind: "simple", // plain e-commerce product
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

  async function toggle(p: AdminProduct, field: "is_featured" | "is_popular") {
    try {
      const updated = await adminPatch<AdminProduct>(`products/${p.id}/`, { [field]: !p[field] });
      setProducts((list) => list.map((x) => (x.id === p.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  const chip = (on: boolean, tone: "plum" | "gold") =>
    on
      ? `${tone === "plum" ? "bg-plum" : "bg-gold"} text-white`
      : "border border-slate-200 text-slate-400 hover:border-slate-300";

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Plain e-commerce products. Customizable items live under Customization."
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <Card className="mb-6 p-4">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
          <Field label="Name (Bengali)">
            <TextInput name="name" required placeholder="e.g. প্রিমিয়াম কলম" />
          </Field>
          <Field label="Category">
            <CategoryInput name="category" placeholder="e.g. কলম" />
          </Field>
          <Field label="Price (৳)">
            <TextInput name="base_price" type="number" step="0.01" required />
          </Field>
          <div className="flex items-end">
            <AdminButton type="submit" disabled={busy} icon="plus" className="w-full">Add product</AdminButton>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          After adding, open the product to upload photos, write a description, set stock, discounts, and toggle Featured / Popular.
        </p>
      </Card>

      {products.length === 0 ? (
        <AdminEmpty icon="box" title="No products yet" hint="Add your first product above." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th><Th>Category</Th>
              <Th>Price</Th><Th>Images</Th><Th>Tags</Th>
              <Th>Active</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{p.name}</Td>
                <Td>{p.category}</Td>
                <Td className="tabular-nums">৳ {p.base_price}</Td>
                <Td>{p.image_count}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => toggle(p, "is_featured")}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${chip(p.is_featured, "plum")}`}>
                      Featured
                    </button>
                    <button type="button" onClick={() => toggle(p, "is_popular")}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${chip(p.is_popular, "gold")}`}>
                      Popular
                    </button>
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
