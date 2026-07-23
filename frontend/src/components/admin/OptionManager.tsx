"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { adminDelete, adminForm, adminGet, adminPatch } from "@/lib/adminApi";
import { Card, AdminButton, Field, TextInput, Select } from "@/components/admin/ui";
import DropZone from "./DropZone";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

interface Row {
  id: number;
  [k: string]: unknown;
}

// Generic CRUD block for a product's option set (colors, toppings, etc.).
// endpoint is the admin API resource, imageField is the file field name.
export default function OptionManager({
  title,
  endpoint,
  productId,
  imageField,
  fields,
  singleImage = false,
}: {
  title: string;
  endpoint: string;
  productId: number;
  imageField: string;
  fields: FieldDef[];
  singleImage?: boolean;  // one image per row (e.g. dupatta: unique lace+lines combo)
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const [editId, setEditId] = useState<number | null>(null);
  const editableFields = fields.filter((f) => f.name !== imageField);

  function load() {
    adminGet<Row[]>(`${endpoint}/?product=${productId}`).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(load, [endpoint, productId]);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setBusy(true);
    const formEl = e.currentTarget;
    const base = new FormData(formEl);
    // Pull the (possibly multiple) selected files out; other fields are shared.
    const fileInput = formEl.elements.namedItem(imageField) as HTMLInputElement | null;
    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    base.delete(imageField);

    try {
      if (singleImage || files.length <= 1) {
        if (files[0]) base.append(imageField, files[0]);
        base.append("product", String(productId));
        base.append("active", "true");
        await adminForm(`${endpoint}/`, base);
      } else {
        // Bulk: one row per file, sharing all the other field values.
        for (const file of files) {
          const fd = new FormData();
          for (const [k, v] of base.entries()) fd.append(k, v);
          fd.append(imageField, file);
          fd.append("product", String(productId));
          fd.append("active", "true");
          await adminForm(`${endpoint}/`, fd);
        }
      }
      formEl.reset();
      setResetTick((t) => t + 1);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!confirm("Delete this item?")) return;
    try {
      await adminDelete(`${endpoint}/${id}/`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function toggleActive(r: Row) {
    try {
      await adminPatch(`${endpoint}/${r.id}/`, { active: !r.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveEdit(e: React.FormEvent<HTMLFormElement>, id: number) {
    e.preventDefault();
    setError(""); setBusy(true);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    // Include a replacement image only if one was picked.
    const fileInput = formEl.elements.namedItem(imageField) as HTMLInputElement | null;
    if (!fileInput?.files?.length) fd.delete(imageField);
    try {
      await adminForm(`${endpoint}/${id}/`, fd, "PATCH");
      setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold text-slate-900">{title}</h2>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((r) => {
          const img = (r[imageField] as string) || "";
          const isEditing = editId === r.id;
          return (
            <div key={r.id} className={`rounded-lg border p-2 text-center text-xs ${r.active === false ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"}`}>
              {img && (
                <div className="relative mx-auto mb-1 h-16 w-16 overflow-hidden rounded">
                  <Image src={img} alt="" fill sizes="64px" className="object-cover" />
                </div>
              )}

              {isEditing ? (
                <form onSubmit={(e) => saveEdit(e, r.id)} className="space-y-1 text-left">
                  {editableFields.map((f) => (
                    <label key={f.name} className="block">
                      <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">{f.label}</span>
                      {f.type === "select" ? (
                        <select name={f.name} defaultValue={String(r[f.name] ?? f.defaultValue ?? "")}
                          className="w-full rounded border border-slate-300 bg-white p-1 text-slate-900">
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input name={f.name} type={f.type ?? "text"}
                          step={f.type === "number" ? "0.01" : undefined}
                          defaultValue={String(r[f.name] ?? "")} placeholder={f.label}
                          className="w-full rounded border border-slate-300 bg-white p-1 text-slate-900" />
                      )}
                    </label>
                  ))}
                  <DropZone name={imageField} label="Replace image" multiple={false} resetSignal={resetTick} />
                  <div className="flex justify-between pt-1">
                    <button type="submit" disabled={busy} className="font-semibold text-plum hover:underline disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-600">Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  {editableFields.map((f) => (
                    <div key={f.name} className="text-slate-500">
                      <span className="opacity-70">{f.label}:</span> {String(r[f.name] ?? "")}
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <button onClick={() => toggleActive(r)} className={r.active === false ? "text-emerald-600 hover:underline" : "text-slate-400 hover:underline"}>
                      {r.active === false ? "Enable" : "Disable"}
                    </button>
                    <button onClick={() => setEditId(r.id)} className="font-semibold text-plum hover:underline">Edit</button>
                    <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="col-span-full text-sm text-slate-400">None yet</p>}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
        {fields.map((f) =>
          f.name === imageField ? (
            <div key={f.name} className="min-w-52">
              <DropZone name={f.name} label={f.label} multiple={!singleImage} resetSignal={resetTick} />
            </div>
          ) : f.type === "select" ? (
            <div key={f.name} className="w-40">
              <Field label={f.label}>
                <Select name={f.name} defaultValue={f.defaultValue}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
            </div>
          ) : (
            <div key={f.name} className="w-28">
              <Field label={f.label}>
                <TextInput name={f.name} type={f.type ?? "text"} step={f.type === "number" ? "0.01" : undefined}
                  defaultValue={f.defaultValue} />
              </Field>
            </div>
          ),
        )}
        <AdminButton type="submit" disabled={busy} icon="plus">Add</AdminButton>
      </form>
    </Card>
  );
}
