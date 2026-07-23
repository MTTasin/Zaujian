"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listCombos, deleteCombo, type AdminCombo } from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Loading, AdminEmpty } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

/**
 * The catalogue. Every buyable listing on /products is one of these rows —
 * a bundle when it links several products, a single item when it links one.
 * Editing happens on its own page; the form is far too large to sit inline.
 */
export default function AdminCombos() {
  const router = useRouter();
  const [combos, setCombos] = useState<AdminCombo[] | null>(null);
  const [error, setError] = useState("");

  function load() {
    listCombos().then(setCombos).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function del(id: number) {
    if (!confirm("Delete this listing?")) return;
    try {
      await deleteCombo(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Listings"
        subtitle="Everything sold on /products — bundles and single items."
        action={
          <AdminButton icon="plus" onClick={() => router.push("/admin/combos/new")}>
            New listing
          </AdminButton>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {combos === null ? (
        <Loading />
      ) : combos.length === 0 ? (
        <AdminEmpty
          icon="gift"
          title="No listings yet"
          hint="Create one — it becomes an ad-ready landing product."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {combos.map((c) => (
            <Card key={c.id} className="flex flex-col p-4">
              <Link href={`/admin/combos/${c.id}`} className="block">
                <div className="relative mb-3 aspect-square overflow-hidden rounded-xl bg-slate-100">
                  {c.images[0] ? (
                    <Image src={c.images[0].image} alt={c.name} fill sizes="240px" className="object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-slate-300">
                      <Icon name="gift" size={40} />
                    </span>
                  )}
                  {!c.active && (
                    <span className="absolute left-2 top-2 rounded bg-slate-800/80 px-2 py-0.5 text-xs text-white">hidden</span>
                  )}
                  {c.featured && (
                    <span className="absolute right-2 top-2 rounded bg-gold px-2 py-0.5 text-xs font-semibold text-white">featured</span>
                  )}
                </div>
                <div className="font-semibold text-slate-900">{c.name}</div>
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-sm text-plum">৳ {c.price}</span>
                {c.category ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c.category}</span>
                ) : (
                  // Without one the storefront card falls back to "কম্বো", which
                  // reads wrong on a single item.
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">no category</span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {c.images.length} image(s) · {c.products.length} linked item(s)
              </div>
              <div className="mt-3 flex gap-3 text-sm">
                <Link href={`/admin/combos/${c.id}`} className="font-semibold text-plum hover:underline">Edit</Link>
                <button onClick={() => del(c.id)} className="text-red-600 hover:underline">Delete</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
