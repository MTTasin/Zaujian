"use client";

import { useEffect, useRef, useState } from "react";
import {
  adminGallery,
  type AdminGalleryPhoto,
  type AdminGalleryTag,
} from "@/lib/adminApi";
import {
  PageHeader,
  Card,
  AdminButton,
  Field,
  TextInput,
  TextArea,
  Loading,
  AdminEmpty,
} from "@/components/admin/ui";
import { cn } from "@/lib/cn";

export default function AdminGalleryPage() {
  const [photos, setPhotos] = useState<AdminGalleryPhoto[] | null>(null);
  const [tags, setTags] = useState<AdminGalleryTag[] | null>(null);
  const [error, setError] = useState("");

  function load() {
    adminGallery.photos().then(setPhotos).catch((e) => setError(e.message));
    adminGallery.tags().then(setTags).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  return (
    <div>
      <PageHeader title="Gallery" subtitle="Photo library & tags" />
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}
      <div className="space-y-5">
        <PhotoLibrary
          photos={photos}
          onChanged={() => {
            adminGallery.photos().then(setPhotos);
            adminGallery.tags().then(setTags);
          }}
        />
        <Tags
          tags={tags}
          photos={photos ?? []}
          onChanged={() => {
            adminGallery.tags().then(setTags);
            adminGallery.photos().then(setPhotos);
          }}
        />
      </div>
    </div>
  );
}

function PhotoLibrary({
  photos,
  onChanged,
}: {
  photos: AdminGalleryPhoto[] | null;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState("");

  async function upload(files: File[]) {
    const valid = files.filter(
      (f) => f.type.startsWith("image/") && f.size <= 15 * 1024 * 1024,
    );
    if (valid.length === 0) {
      setMsg("No valid images (max 15MB each).");
      return;
    }
    setBusy(true);
    setMsg("");
    setTotal(valid.length);
    setProgress(0);
    const BATCH = 5;
    let errs = 0;
    for (let i = 0; i < valid.length; i += BATCH) {
      try {
        const res = await adminGallery.upload(valid.slice(i, i + BATCH));
        errs += res.errors.length;
      } catch {
        errs += Math.min(BATCH, valid.length - i);
      }
      setProgress(Math.min(i + BATCH, valid.length));
    }
    setBusy(false);
    setMsg(errs ? `Uploaded with ${errs} error(s).` : "Uploaded.");
    onChanged();
  }

  async function remove(id: number) {
    if (!confirm("Delete this photo?")) return;
    await adminGallery.deletePhoto(id);
    onChanged();
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Photo Library</h2>
        <div className="flex items-center gap-3">
          {busy && (
            <span className="text-sm text-slate-500">
              Uploading {progress}/{total}…
            </span>
          )}
          {msg && !busy && <span className="text-sm text-slate-500">{msg}</span>}
          <AdminButton onClick={() => inputRef.current?.click()} disabled={busy}>
            Upload photos
          </AdminButton>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) upload(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {photos === null ? (
        <Loading />
      ) : photos.length === 0 ? (
        <AdminEmpty title="No photos yet." hint="Upload some above." />
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-400">{photos.length} photo(s) — scroll inside to browse.</p>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-100 p-1">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {photos.map((p) => (
                <div key={p.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                  <div className="aspect-square bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbnail || p.display} alt={p.alt} className="h-full w-full object-cover" />
                  </div>
                  {p.tag_count > 0 && (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">
                      {p.tag_count}
                    </span>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    className="absolute right-1 top-1 hidden rounded bg-red-600 px-1.5 text-xs text-white group-hover:block"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

const BLANK_TAG: Partial<AdminGalleryTag> = {
  title: "",
  description: "",
  active: true,
  is_bot_default: false,
  order: 0,
};

function Tags({
  tags,
  photos,
  onChanged,
}: {
  tags: AdminGalleryTag[] | null;
  photos: AdminGalleryPhoto[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState<Partial<AdminGalleryTag> | null>(null);
  const [managing, setManaging] = useState<AdminGalleryTag | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTagId = useRef<number | null>(null);
  const [uploadingTag, setUploadingTag] = useState<number | null>(null);
  const [dragTag, setDragTag] = useState<number | null>(null);

  async function save() {
    if (!form?.title?.trim()) return;
    if (form.id) await adminGallery.updateTag(form.id, form);
    else await adminGallery.createTag(form);
    setForm(null);
    onChanged();
  }
  async function remove(id: number) {
    if (!confirm("Delete this tag? (photos are kept)")) return;
    await adminGallery.deleteTag(id);
    onChanged();
  }

  // Upload photos straight into a tag (no separate multi-select step).
  // Shared by the "Upload here" button (file picker) and drag-and-drop.
  async function uploadToTag(files: File[], tagId: number) {
    const valid = files.filter((f) => f.type.startsWith("image/") && f.size <= 15 * 1024 * 1024);
    if (!valid.length || uploadingTag != null) return;
    setUploadingTag(tagId);
    const BATCH = 5;
    for (let i = 0; i < valid.length; i += BATCH) {
      await adminGallery.upload(valid.slice(i, i + BATCH), tagId);
    }
    setUploadingTag(null);
    onChanged();
  }
  function pickForTag(tagId: number) {
    uploadTagId.current = tagId;
    uploadInput.current?.click();
  }
  async function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const tagId = uploadTagId.current;
    if (tagId != null) await uploadToTag(files, tagId);
  }
  function onDrop(e: React.DragEvent, tagId: number) {
    e.preventDefault();
    setDragTag(null);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) uploadToTag(files, tagId);
  }

  return (
    <Card className="p-5">
      <input
        ref={uploadInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onFilesPicked}
      />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Tags</h2>
        <AdminButton onClick={() => setForm({ ...BLANK_TAG })}>New tag</AdminButton>
      </div>

      {tags === null ? (
        <Loading />
      ) : tags.length === 0 ? (
        <AdminEmpty title="No tags yet." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {tags.map((t) => (
            <li
              key={t.id}
              onDragOver={(e) => { e.preventDefault(); setDragTag(t.id); }}
              onDragLeave={() => setDragTag((d) => (d === t.id ? null : d))}
              onDrop={(e) => onDrop(e, t.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 transition",
                dragTag === t.id
                  ? "bg-plum/10 outline-2 outline-dashed outline-plum"
                  : "",
              )}
              title="Drop images here to add them to this tag"
            >
              <span className="font-medium text-slate-800">{t.title}</span>
              <span className="text-xs text-slate-400">/{t.slug}</span>
              <span className="text-xs text-slate-500">{t.count} photos</span>
              {!t.active && <span className="text-xs text-amber-600">hidden</span>}
              {t.is_bot_default && <span className="text-xs text-plum">bot-default</span>}
              <div className="ml-auto flex gap-2">
                <button
                  className="text-sm font-semibold text-plum underline disabled:opacity-50"
                  onClick={() => pickForTag(t.id)}
                  disabled={uploadingTag != null}
                >
                  {uploadingTag === t.id ? "Uploading…" : "Upload here"}
                </button>
                <button className="text-sm text-plum underline" onClick={() => setManaging(t)}>
                  Manage photos
                </button>
                <button className="text-sm text-slate-600 underline" onClick={() => setForm(t)}>
                  Edit
                </button>
                <button className="text-sm text-red-600 underline" onClick={() => remove(t.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <Field label="Title (Bengali)">
            <TextInput
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="URL slug (English — used in the link & by the bot; blank = auto)">
            <TextInput
              placeholder="e.g. combo-book-box-pen"
              value={form.slug ?? ""}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </Field>
          <Field label="Description (optional)">
            <TextArea
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active ?? true}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_bot_default ?? false}
                onChange={(e) => setForm({ ...form, is_bot_default: e.target.checked })}
              />
              Bot default
            </label>
            <Field label="Order">
              <TextInput
                type="number"
                value={String(form.order ?? 0)}
                onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <AdminButton onClick={save}>Save</AdminButton>
            <button className="text-sm text-slate-500" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {managing && (
        <ManagePhotos
          tag={managing}
          photos={photos}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function ManagePhotos({
  tag,
  photos,
  onClose,
  onSaved,
}: {
  tag: AdminGalleryTag;
  photos: AdminGalleryPhoto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(tag.photo_ids));
  const [busy, setBusy] = useState(false);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    await adminGallery.setPhotos(tag.id, [...selected]);
    setBusy(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">
            Photos in “{tag.title}” ({selected.size})
          </h3>
          <button className="text-slate-400" onClick={onClose}>
            ✕
          </button>
        </div>
        {photos.length === 0 ? (
          <AdminEmpty title="Upload photos first." />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {photos.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`relative overflow-hidden rounded-lg border-2 ${
                      on ? "border-plum" : "border-transparent"
                    }`}
                  >
                    <div className="aspect-square bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumbnail || p.display} alt={p.alt} className="h-full w-full object-cover" />
                    </div>
                    {on && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-plum text-xs text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="text-sm text-slate-500" onClick={onClose}>
            Cancel
          </button>
          <AdminButton onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
