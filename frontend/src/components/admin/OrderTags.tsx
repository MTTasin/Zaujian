"use client";

import { useEffect, useRef, useState } from "react";
import {
  createOrderTag, deleteOrderTag, listOrderTags, setOrderTags, updateOrderTag,
  TAG_CLASSES, TAG_COLOURS, type AdminOrder, type OrderTag, type TagColour,
} from "@/lib/adminApi";
import { AdminButton, TextInput, Select } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

/** A tag as it appears anywhere — one look, so a colour means the same thing
    on the list as on the order. */
export function TagChip({ tag, onRemove }: { tag: OrderTag; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TAG_CLASSES[tag.colour] ?? TAG_CLASSES.slate}`}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${tag.name}`}
                className="opacity-60 transition hover:opacity-100">
          <Icon name="x" size={11} />
        </button>
      )}
    </span>
  );
}

/**
 * Tags on one order: add an existing one, type a new one, remove any.
 *
 * A new name is created as it is typed. The alternative — go define the tag in
 * a settings screen, come back, apply it — is how tagging quietly stops being
 * used, and the vocabulary is the admin's own anyway.
 */
export function OrderTagEditor({ order, canWrite, onChange }: {
  order: AdminOrder;
  canWrite: boolean;
  onChange: (updated: AdminOrder) => void;
}) {
  const [all, setAll] = useState<OrderTag[] | null>(null);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || all) return;
    listOrderTags().then(setAll).catch(() => setAll([]));
  }, [open, all]);

  // Clicking anywhere else closes the picker — it sits over the page content.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const current = order.tags ?? [];

  async function apply(body: { tags?: number[]; names?: string[] }) {
    setBusy(true); setError("");
    try {
      onChange(await setOrderTags(order.id, body));
      setAll(null);            // a new tag may have been created just now
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the tags");
    } finally {
      setBusy(false);
    }
  }

  const add = (tag: OrderTag) => {
    setTyped(""); setOpen(false);
    if (current.some((t) => t.id === tag.id)) return;
    apply({ tags: [...current.map((t) => t.id), tag.id] });
  };

  const remove = (tag: OrderTag) =>
    apply({ tags: current.filter((t) => t.id !== tag.id).map((t) => t.id) });

  function addTyped() {
    const name = typed.trim();
    if (!name) return;
    setTyped(""); setOpen(false);
    // Matching by name lets the backend reuse the existing row rather than
    // refusing the create as a duplicate.
    apply({ tags: current.map((t) => t.id), names: [name] });
  }

  const needle = typed.trim().toLowerCase();
  const suggestions = (all ?? []).filter(
    (t) => !current.some((c) => c.id === t.id) && (!needle || t.name.toLowerCase().includes(needle)),
  );
  const exact = (all ?? []).some((t) => t.name.toLowerCase() === needle);

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {current.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={canWrite && !busy ? () => remove(t) : undefined} />
        ))}
        {current.length === 0 && !canWrite && (
          <span className="text-sm text-slate-400">No tags.</span>
        )}
        {canWrite && (
          <div className="relative" ref={box}>
            <button type="button" onClick={() => setOpen((v) => !v)} disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 transition hover:border-plum hover:text-plum">
              <Icon name="plus" size={12} /> Tag
            </button>
            {open && (
              <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                <TextInput autoFocus placeholder="Find or type a new tag…" value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
                />
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {!all && <p className="px-1 text-xs text-slate-400">Loading…</p>}
                  {suggestions.map((t) => (
                    <button key={t.id} type="button" onClick={() => add(t)}
                      className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-slate-50">
                      <TagChip tag={t} />
                      {!!t.order_count && <span className="text-xs text-slate-400">{t.order_count}</span>}
                    </button>
                  ))}
                  {needle && !exact && (
                    <button type="button" onClick={addTyped}
                      className="w-full rounded px-1 py-1 text-left text-sm font-medium text-plum hover:bg-slate-50">
                      + Create “{typed.trim()}”
                    </button>
                  )}
                  {all && suggestions.length === 0 && !needle && (
                    <p className="px-1 text-xs text-slate-400">No tags yet — type one above.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The vocabulary itself: rename, recolour, delete. Deleting unmarks every order
 * that carried the tag and touches nothing else about them.
 */
export function OrderTagManager({ onChanged }: { onChanged?: () => void }) {
  const [tags, setTags] = useState<OrderTag[] | null>(null);
  const [name, setName] = useState("");
  const [colour, setColour] = useState<TagColour>("slate");
  const [error, setError] = useState("");

  const load = () => listOrderTags().then(setTags).catch(() => setTags([]));
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div>
      {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-48">
          <TextInput placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-32">
          <Select value={colour} onChange={(e) => setColour(e.target.value as TagColour)}>
            {TAG_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <AdminButton icon="plus" disabled={!name.trim()}
          onClick={() => run(async () => { await createOrderTag({ name: name.trim(), colour }); setName(""); })}
          className="min-h-9 px-3 text-xs">
          Add tag
        </AdminButton>
      </div>

      {!tags && <p className="text-sm text-slate-400">Loading…</p>}
      {tags && tags.length === 0 && <p className="text-sm text-slate-400">No tags yet.</p>}
      <div className="space-y-2">
        {(tags ?? []).map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <TextInput defaultValue={t.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== t.name) run(() => updateOrderTag(t.id, { name: next }));
                }} />
            </div>
            <div className="w-32">
              <Select value={t.colour}
                onChange={(e) => run(() => updateOrderTag(t.id, { colour: e.target.value as TagColour }))}>
                {TAG_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <TagChip tag={t} />
            <span className="text-xs text-slate-400">
              {t.order_count ?? 0} order{t.order_count === 1 ? "" : "s"}
            </span>
            <button type="button" aria-label={`Delete ${t.name}`}
              onClick={() => {
                if (confirm(`Delete "${t.name}"? It is removed from every order carrying it.`)) {
                  run(() => deleteOrderTag(t.id));
                }
              }}
              className="text-slate-400 transition hover:text-red-600">
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
