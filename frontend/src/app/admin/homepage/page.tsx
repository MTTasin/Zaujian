"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import DropZone from "@/components/admin/DropZone";
import {
  createHomeCategory, deleteHomeCategory, getSiteSettings, listHomeCategories,
  updateHomeCategory, updateSiteSettings,
  type HomeCategory, type SiteSettings,
} from "@/lib/adminApi";
import { PageHeader, Card, AdminButton, Field, TextInput, Loading } from "@/components/admin/ui";

export default function AdminHomepage() {
  return (
    <div>
      <PageHeader title="Homepage content" subtitle="Hero, feature band & category tiles" />
      <div className="space-y-5">
        <HeroAndBand />
        <CategoryTiles />
      </div>
    </div>
  );
}

function HeroAndBand() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  function load() {
    getSiteSettings().then(setSettings).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setMsg(""); setBusy(true);
    const fd = new FormData(e.currentTarget);
    // Drop empty file inputs so we don't overwrite existing images with nothing.
    for (const key of ["hero_image", "band_image"]) {
      const input = e.currentTarget.elements.namedItem(key) as HTMLInputElement | null;
      if (!input?.files?.length) fd.delete(key);
    }
    try {
      const updated = await updateSiteSettings(fd);
      setSettings(updated);
      setResetTick((t) => t + 1);
      setMsg("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  if (error && !settings) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!settings) return <Loading />;

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold text-slate-900">Hero &amp; band</h2>
      {msg && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Hero title">
            <TextInput name="hero_title" defaultValue={settings.hero_title} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Hero subtitle">
            <TextInput name="hero_subtitle" defaultValue={settings.hero_subtitle} />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Hero image</span>
          {settings.hero_image && (
            <div className="relative mb-2 h-24 w-40 overflow-hidden rounded-lg border border-slate-200">
              <Image src={settings.hero_image} alt="" fill sizes="160px" className="object-cover" />
            </div>
          )}
          <DropZone name="hero_image" multiple={false} resetSignal={resetTick} />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Feature band image</span>
          {settings.band_image && (
            <div className="relative mb-2 h-24 w-40 overflow-hidden rounded-lg border border-slate-200">
              <Image src={settings.band_image} alt="" fill sizes="160px" className="object-cover" />
            </div>
          )}
          <DropZone name="band_image" multiple={false} resetSignal={resetTick} />
        </div>

        <div className="md:col-span-2">
          <AdminButton type="submit" disabled={busy}>Save</AdminButton>
        </div>
      </form>
    </Card>
  );
}

function CategoryTiles() {
  const [cats, setCats] = useState<HomeCategory[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [editId, setEditId] = useState<number | null>(null);

  function load() {
    listHomeCategories().then(setCats).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setBusy(true);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    try {
      await createHomeCategory(fd);
      formEl.reset(); setResetTick((t) => t + 1); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function toggleActive(c: HomeCategory) {
    const fd = new FormData();
    fd.append("active", String(!c.active));
    try {
      await updateHomeCategory(c.id, fd);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveEdit(e: React.FormEvent<HTMLFormElement>, c: HomeCategory) {
    e.preventDefault(); setError(""); setBusy(true);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    // Drop empty file input so we don't wipe the existing image.
    const input = formEl.elements.namedItem("image") as HTMLInputElement | null;
    if (!input?.files?.length) fd.delete("image");
    try {
      await updateHomeCategory(c.id, fd);
      setEditId(null); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!confirm("Delete this category tile?")) return;
    await deleteHomeCategory(id);
    load();
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold text-slate-900">Category tiles</h2>
      <p className="mb-3 text-xs text-slate-400">The homepage &quot;shop by category&quot; strip.</p>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {cats.map((c) => (
          <div key={c.id} className={`rounded-lg border p-2 text-center text-xs ${c.active ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white opacity-60"}`}>
            {editId === c.id ? (
              <form onSubmit={(e) => saveEdit(e, c)} className="space-y-2 text-left">
                {c.image && (
                  <div className="relative mx-auto mb-1 h-20 w-20 overflow-hidden rounded">
                    <Image src={c.image} alt="" fill sizes="80px" className="object-cover" />
                  </div>
                )}
                <Field label="Title">
                  <TextInput name="title" defaultValue={c.title} required />
                </Field>
                <Field label="Link">
                  <TextInput name="link" defaultValue={c.link} />
                </Field>
                <Field label="Order">
                  <TextInput name="order" type="number" defaultValue={String(c.order)} />
                </Field>
                <DropZone name="image" label="Replace image" multiple={false} resetSignal={resetTick} />
                <div className="flex items-center justify-center gap-2 pt-1">
                  <AdminButton type="submit" disabled={busy}>Save</AdminButton>
                  <button type="button" onClick={() => setEditId(null)} className="text-slate-400 hover:underline">Cancel</button>
                </div>
              </form>
            ) : (
              <>
                {c.image && (
                  <div className="relative mx-auto mb-1 h-20 w-20 overflow-hidden rounded">
                    <Image src={c.image} alt="" fill sizes="80px" className="object-cover" />
                  </div>
                )}
                <div className="font-medium text-slate-800">{c.title}</div>
                <div className="truncate text-slate-400">{c.link}</div>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <button onClick={() => { setEditId(c.id); setResetTick((t) => t + 1); }} className="text-plum hover:underline">Edit</button>
                  <button onClick={() => toggleActive(c)} className={c.active ? "text-slate-400 hover:underline" : "text-emerald-600 hover:underline"}>
                    {c.active ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => del(c.id)} className="text-red-600 hover:underline">Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
        {cats.length === 0 && <p className="col-span-full text-sm text-slate-400">None yet</p>}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
        <div className="w-32">
          <Field label="Title">
            <TextInput name="title" placeholder="e.g. বই" required />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Link">
            <TextInput name="link" placeholder="/products?category=বই" />
          </Field>
        </div>
        <div className="w-20">
          <Field label="Order">
            <TextInput name="order" type="number" defaultValue="0" />
          </Field>
        </div>
        <div className="min-w-40">
          <DropZone name="image" label="Image" multiple={false} resetSignal={resetTick} />
        </div>
        <AdminButton type="submit" disabled={busy} icon="plus">Add</AdminButton>
      </form>
    </Card>
  );
}
