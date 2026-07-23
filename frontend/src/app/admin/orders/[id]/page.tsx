"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  adminGet, adminPost, ORDER_STATUSES,
  listColorOptions, listToppingOptions, listInsideOptions, listStaticOptions, listDupattaOptions,
  type AdminOrder, type AdminOrderItem, type ItemConfigField, type ItemConfigComboItem,
  type AdminProduct, type AdminColorOption, type AdminToppingOption,
  type AdminInsideOption, type AdminStaticOption, type AdminDupattaOption,
} from "@/lib/adminApi";
import { BD_LOCATIONS } from "@/lib/bdLocations";
import { PageHeader, Card, AdminButton, Field, TextInput, TextArea, Select, StatusPill, Loading } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [advance, setAdvance] = useState("0");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    customer_name: "", phone: "", whatsapp: "", email: "",
    division: "", district: "", thana: "", address: "",
    delivery_charge: "", advance_received: "", cost_price: "",
  });
  const [thanaOther, setThanaOther] = useState("");
  const [editItems, setEditItems] = useState<{ title: string; price: string }[]>([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extra, setExtra] = useState({
    recipient_name: "", recipient_phone: "", recipient_address: "",
    cod_amount: "", item_description: "",
  });

  const isManual = !!order && order.items.length > 0 &&
    order.items.every((it) => (it.config as { manual?: boolean })?.manual);

  function startEdit() {
    if (!order) return;
    // A thana typed through "Others" (or one dropped from the location data)
    // isn't in the dropdown, so a plain value= would silently reset the field to
    // "Select…" and wipe the address on save. Reopen it as Others + free text.
    const known = BD_LOCATIONS[order.division || ""]?.[order.district || ""] ?? [];
    const stored = order.thana || "";
    const isListed = !stored || known.includes(stored);
    setThanaOther(isListed ? "" : stored);
    setForm({
      customer_name: order.customer_name || "", phone: order.phone || "",
      whatsapp: order.whatsapp || "", email: order.email || "",
      division: order.division || "", district: order.district || "",
      thana: isListed ? stored : "Others", address: order.address || "",
      delivery_charge: order.delivery_charge || "", advance_received: order.advance_received || "",
      cost_price: order.cost_price || "",
    });
    setEditItems(
      order.items
        .filter((it) => (it.config as { manual?: boolean })?.manual)
        .map((it) => ({
          title: String((it.config as { title?: string })?.title ?? it.product_name),
          price: it.price_snapshot,
        })),
    );
    setMsg(""); setError(""); setEditing(true);
  }

  async function saveEdit() {
    if (!order) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const payload: Record<string, unknown> = { ...form };
      if (form.thana === "Others") {
        if (!thanaOther.trim()) {
          setError("Type the thana name."); setBusy(false); return;
        }
        payload.thana = thanaOther.trim();
      }
      if (isManual) payload.items = editItems.filter((i) => i.title.trim());
      const updated = await adminPost<AdminOrder>(`orders/${order.id}/edit/`, payload);
      setOrder(updated); setEditing(false); setMsg("Order updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  // ---- edit a single item's customer-submitted TEXT (field answers, note, combo lines) ----
  const [configEditItemId, setConfigEditItemId] = useState<number | null>(null);
  const [configForm, setConfigForm] = useState<{
    fields: ItemConfigField[];
    note: string;
    combo_items: ItemConfigComboItem[];
  }>({ fields: [], note: "", combo_items: [] });

  function itemHasEditableText(it: AdminOrderItem) {
    const cfg = it.config || {};
    const hasFields = (cfg.fields?.length ?? 0) > 0;
    const hasNote = !!cfg.note;
    const hasComboLines = (cfg.combo_items ?? []).some((ci) => (ci.lines?.length ?? 0) > 0);
    return hasFields || hasNote || hasComboLines;
  }

  function startConfigEdit(it: AdminOrderItem) {
    const cfg = it.config || {};
    setConfigForm({
      fields: (cfg.fields ?? []).map((f) => ({ ...f })),
      note: cfg.note ?? "",
      combo_items: (cfg.combo_items ?? []).map((ci) => ({
        product: ci.product,
        lines: (ci.lines ?? []).map((l) => ({ ...l })),
      })),
    });
    setMsg(""); setError(""); setConfigEditItemId(it.id);
  }

  async function saveConfigEdit() {
    if (!order || configEditItemId == null) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const updated = await adminPost<AdminOrder>(`orders/${order.id}/edit_config/`, {
        item_id: configEditItemId,
        fields: configForm.fields,
        note: configForm.note,
        combo_items: configForm.combo_items,
      });
      setOrder(updated);
      setConfigEditItemId(null);
      setMsg("Answers updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function load() {
    adminGet<AdminOrder>(`orders/${id}/`).then((o) => {
      setOrder(o);
      setAdvance(o.advance_received || o.advance_amount || "0");
    }).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  // ---- change a placed item's color/design options (reprices from the pricing engine) ----
  const [productKinds, setProductKinds] = useState<Record<number, AdminProduct>>({});
  const [optionEditItemId, setOptionEditItemId] = useState<number | null>(null);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionLists, setOptionLists] = useState<{
    colors: AdminColorOption[];
    toppings: AdminToppingOption[];
    inside: AdminInsideOption[];
    statics: AdminStaticOption[];
    dupatta: AdminDupattaOption[];
  }>({ colors: [], toppings: [], inside: [], statics: [], dupatta: [] });
  const [optionSelection, setOptionSelection] = useState<Record<string, number | undefined>>({});

  // Product ids referenced by this order's items — fetched once (per distinct
  // set) to know each item's `kind` so we only offer the relevant dimensions.
  const productIds = useMemo(
    () => Array.from(new Set((order?.items ?? [])
      .map((it) => it.product)
      .filter((p): p is number => !!p))),
    [order],
  );
  useEffect(() => {
    if (productIds.length === 0) return;
    let cancelled = false;
    Promise.all(productIds.map((pid) => adminGet<AdminProduct>(`products/${pid}/`)))
      .then((prods) => {
        if (cancelled) return;
        setProductKinds((m) => {
          const next = { ...m };
          prods.forEach((p) => { next[p.id] = p; });
          return next;
        });
      })
      .catch(() => { /* option editor button just won't appear */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join(",")]);

  function itemIsCustomizable(it: AdminOrderItem) {
    if (!it.product) return false;
    const p = productKinds[it.product];
    return !!p && p.kind !== "simple";
  }

  async function openOptionEditor(it: AdminOrderItem) {
    if (!it.product) return;
    const kind = productKinds[it.product]?.kind;
    const cfg = it.config || {};
    const idOf = (key: string) => (cfg[key] as { id?: number } | undefined)?.id;
    setOptionSelection({
      color: idOf("color"), corner: idOf("corner"), center: idOf("center"),
      inside: idOf("inside"), static: idOf("static"), dupatta: idOf("dupatta"),
    });
    setError(""); setMsg("");
    setOptionEditItemId(it.id);
    setOptionLoading(true);
    try {
      const [colors, toppings, inside, statics, dupatta] = await Promise.all([
        kind === "layered" ? listColorOptions(it.product) : Promise.resolve([]),
        kind === "layered" ? listToppingOptions(it.product) : Promise.resolve([]),
        kind === "layered" ? listInsideOptions(it.product) : Promise.resolve([]),
        kind === "gallery" ? listStaticOptions(it.product) : Promise.resolve([]),
        kind === "dupatta" ? listDupattaOptions(it.product) : Promise.resolve([]),
      ]);
      setOptionLists({ colors, toppings, inside, statics, dupatta });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load options");
    } finally {
      setOptionLoading(false);
    }
  }

  async function saveOptions() {
    if (!order || optionEditItemId == null) return;
    const selection: Record<string, number> = {};
    for (const [k, v] of Object.entries(optionSelection)) {
      if (v != null) selection[k] = v;
    }
    setBusy(true); setError(""); setMsg("");
    try {
      const updated = await adminPost<AdminOrder>(`orders/${order.id}/edit_item_options/`, {
        item_id: optionEditItemId, selection,
      });
      setOrder(updated);
      setOptionEditItemId(null);
      setMsg("Design updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<AdminOrder>, ok: string) {
    setError(""); setMsg(""); setBusy(true);
    try {
      const updated = await fn();
      setOrder(updated);
      setMsg(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function startExtra() {
    if (!order) return;
    setExtra({
      recipient_name: order.customer_name || "",
      recipient_phone: order.phone || "",
      recipient_address: order.full_address || order.address || "",
      cod_amount: order.cod_amount || "",
      item_description: order.items.map((it) => it.product_name).filter(Boolean).join(", "),
    });
    setError(""); setMsg(""); setExtraOpen(true);
  }

  async function bookExtra() {
    if (!order) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await adminPost(`orders/${order.id}/book_extra/`, extra);
      setExtraOpen(false); setMsg("Extra consignment booked");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !order) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!order) return <Loading />;

  return (
    <div>
      <PageHeader
        title={`Order ${order.uid}`}
        action={
          <div className="flex items-center gap-3">
            {order.is_repeat_customer && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold">
                <Icon name="star" size={14} fill /> Repeat customer
              </span>
            )}
            {!editing && (
              <AdminButton variant="secondary" icon="edit" onClick={startEdit}>Edit</AdminButton>
            )}
          </div>
        }
      />

      {msg && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="space-y-4">
        {editing ? (
          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Edit order</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name"><TextInput value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} /></Field>
              <Field label="Phone"><TextInput value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
              <Field label="WhatsApp"><TextInput value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} /></Field>
              <Field label="Email"><TextInput type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Division">
                <Select value={form.division} onChange={(e) => setForm((f) => ({ ...f, division: e.target.value, district: "", thana: "" }))}>
                  <option value="">Select…</option>
                  {Object.keys(BD_LOCATIONS).map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="District">
                <Select value={form.district} disabled={!form.division} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value, thana: "" }))}>
                  <option value="">Select…</option>
                  {(form.division ? Object.keys(BD_LOCATIONS[form.division] ?? {}) : []).map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Thana / Upazila">
                <Select value={form.thana} disabled={!form.district}
                  onChange={(e) => { setForm((f) => ({ ...f, thana: e.target.value })); setThanaOther(""); }}>
                  <option value="">Select…</option>
                  {((form.division && form.district) ? BD_LOCATIONS[form.division]?.[form.district] ?? [] : []).map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                {/* Unlisted area: the courier takes the address as free text anyway. */}
                {form.thana === "Others" && (
                  <div className="mt-2">
                    <TextInput value={thanaOther} placeholder="Type the thana name"
                      onChange={(e) => setThanaOther(e.target.value)} />
                  </div>
                )}
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Street address"><TextArea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Delivery charge (৳)"><TextInput type="number" step="0.01" value={form.delivery_charge} onChange={(e) => setForm((f) => ({ ...f, delivery_charge: e.target.value }))} /></Field>
              <Field label="Advance received (৳)"><TextInput type="number" step="0.01" value={form.advance_received} onChange={(e) => setForm((f) => ({ ...f, advance_received: e.target.value }))} /></Field>
              <Field label="Cost price (৳) — your total cost">
                <TextInput type="number" step="0.01" min="0" placeholder="Not costed yet" value={form.cost_price} onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))} />
              </Field>
            </div>

            {isManual && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Items</span>
                  <AdminButton type="button" variant="secondary" icon="plus" onClick={() => setEditItems((a) => [...a, { title: "", price: "" }])}>Add item</AdminButton>
                </div>
                <div className="space-y-2">
                  {editItems.map((it, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex-1"><TextInput placeholder="Item name" value={it.title} onChange={(e) => setEditItems((a) => a.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} /></div>
                      <div className="w-32"><TextInput placeholder="Price ৳" type="number" step="0.01" value={it.price} onChange={(e) => setEditItems((a) => a.map((x, idx) => idx === i ? { ...x, price: e.target.value } : x))} /></div>
                      <button type="button" onClick={() => setEditItems((a) => a.filter((_, idx) => idx !== i))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Icon name="trash" size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <AdminButton onClick={saveEdit} disabled={busy} icon="check">{busy ? "Saving…" : "Save changes"}</AdminButton>
              <AdminButton variant="secondary" onClick={() => setEditing(false)}>Cancel</AdminButton>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Customer">
              <Row k="Name" v={order.customer_name} />
              <Row k="Phone" v={order.phone} />
              <Row k="WhatsApp" v={order.whatsapp || "—"} />
              <Row k="Email" v={order.email || "—"} />
              <Row k="Address" v={order.full_address || order.address} />
            </Panel>

            <Panel title="Money">
              <Row k="Subtotal" v={`৳ ${order.subtotal}`} />
              <Row k="Delivery" v={`৳ ${order.delivery_charge}`} />
              <Row k="Total" v={`৳ ${order.total}`} />
              <Row k="Advance required" v={order.advance_required ? "Yes" : "No"} />
              <Row k="Advance received" v={`৳ ${order.advance_received}`} />
              <Row k="COD amount" v={`৳ ${order.cod_amount}`} />
              {order.cost_price != null ? (
                <Row k="Profit (subtotal − cost)" v={`৳ ${order.profit}`} />
              ) : (
                <p className="mt-1 text-sm text-slate-400">Not costed yet</p>
              )}
            </Panel>
          </div>
        )}

        <Panel title="Items">
          <div className="space-y-3">
            {order.items.map((it) => (
              <div key={it.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {it.preview_image && <Image src={it.preview_image} alt="" fill sizes="64px" className="object-cover" />}
                </div>
                <div className="flex-1 text-sm">
                  <div className="font-medium text-slate-900">{it.product_name}</div>
                  {(it.config_display?.length ?? 0) > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {it.config_display.map((c, i) => (
                        <div key={i} className="rounded-lg border border-slate-200 p-1 text-center">
                          {c.image ? (
                            <a href={c.image} target="_blank" rel="noreferrer" className="relative block aspect-square w-full overflow-hidden rounded">
                              <Image src={c.image} alt={c.label} fill sizes="120px" className="object-cover" />
                            </a>
                          ) : (
                            <div className="flex aspect-square items-center justify-center rounded bg-slate-100 text-xs text-slate-400">{c.value}</div>
                          )}
                          <div className="mt-1 text-xs font-medium text-slate-700">{c.label}</div>
                        </div>
                      ))}
                    </div>
                  ) : it.category === "combo" ? (
                    <div className="text-slate-400">Prebuilt combo</div>
                  ) : null}

                  {itemHasEditableText(it) && (
                    configEditItemId === it.id ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        {configForm.fields.map((f, i) => (
                          <Field key={`f-${i}`} label={f.label}>
                            <TextInput
                              value={f.value}
                              onChange={(e) => setConfigForm((s) => ({
                                ...s,
                                fields: s.fields.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x),
                              }))}
                            />
                          </Field>
                        ))}
                        {configForm.combo_items.map((ci, ciIdx) => (
                          ci.lines.map((ln, lnIdx) => (
                            <Field key={`c-${ciIdx}-${lnIdx}`} label={`${ci.product} — ${ln.label}`}>
                              <TextInput
                                value={ln.value}
                                onChange={(e) => setConfigForm((s) => ({
                                  ...s,
                                  combo_items: s.combo_items.map((x, idx2) => idx2 === ciIdx
                                    ? { ...x, lines: x.lines.map((l, lidx) => lidx === lnIdx ? { ...l, value: e.target.value } : l) }
                                    : x),
                                }))}
                              />
                            </Field>
                          ))
                        ))}
                        <Field label="বিশেষ নির্দেশনা / Special instruction">
                          <TextArea
                            rows={2}
                            value={configForm.note}
                            onChange={(e) => setConfigForm((s) => ({ ...s, note: e.target.value }))}
                          />
                        </Field>
                        <div className="flex gap-3">
                          <AdminButton icon="check" disabled={busy} onClick={saveConfigEdit} className="min-h-8 px-3 text-xs">
                            {busy ? "Saving…" : "Save"}
                          </AdminButton>
                          <AdminButton variant="secondary" disabled={busy} onClick={() => setConfigEditItemId(null)} className="min-h-8 px-3 text-xs">
                            Cancel
                          </AdminButton>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <AdminButton variant="secondary" icon="edit" disabled={busy} onClick={() => startConfigEdit(it)} className="min-h-8 px-3 text-xs">
                          Edit answers
                        </AdminButton>
                      </div>
                    )
                  )}

                  {itemIsCustomizable(it) && (
                    optionEditItemId === it.id ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        {optionLoading ? (
                          <p className="text-xs text-slate-400">Loading options…</p>
                        ) : (
                          <>
                            {productKinds[it.product!]?.kind === "layered" && (
                              <>
                                <OptionThumbRow
                                  label="Color (required)" options={optionLists.colors}
                                  imageField="base_image" priceField="price_modifier"
                                  selectedId={optionSelection.color}
                                  onSelect={(id) => setOptionSelection((s) => ({ ...s, color: id }))}
                                />
                                <OptionThumbRow
                                  label="Corner design" allowNone
                                  options={optionLists.toppings.filter((t) => t.placement === "corner")}
                                  imageField="image" priceField="price_modifier"
                                  selectedId={optionSelection.corner}
                                  onSelect={(id) => setOptionSelection((s) => ({ ...s, corner: id }))}
                                />
                                <OptionThumbRow
                                  label="Center design" allowNone
                                  options={optionLists.toppings.filter((t) => t.placement === "center")}
                                  imageField="image" priceField="price_modifier"
                                  selectedId={optionSelection.center}
                                  onSelect={(id) => setOptionSelection((s) => ({ ...s, center: id }))}
                                />
                                <OptionThumbRow
                                  label="Inside design" allowNone options={optionLists.inside}
                                  imageField="preview_image" priceField="price_modifier"
                                  selectedId={optionSelection.inside}
                                  onSelect={(id) => setOptionSelection((s) => ({ ...s, inside: id }))}
                                />
                              </>
                            )}
                            {productKinds[it.product!]?.kind === "gallery" && (
                              <OptionThumbRow
                                label="Design" options={optionLists.statics}
                                imageField="image" priceField="price_modifier"
                                selectedId={optionSelection.static}
                                onSelect={(id) => setOptionSelection((s) => ({ ...s, static: id }))}
                              />
                            )}
                            {productKinds[it.product!]?.kind === "dupatta" && (
                              <OptionThumbRow
                                label="Dupatta option" options={optionLists.dupatta}
                                imageField="preview_image" priceField="price"
                                selectedId={optionSelection.dupatta}
                                onSelect={(id) => setOptionSelection((s) => ({ ...s, dupatta: id }))}
                              />
                            )}
                            <div className="flex gap-3">
                              <AdminButton icon="check" disabled={busy} onClick={saveOptions} className="min-h-8 px-3 text-xs">
                                {busy ? "Saving…" : "Save"}
                              </AdminButton>
                              <AdminButton variant="secondary" disabled={busy} onClick={() => setOptionEditItemId(null)} className="min-h-8 px-3 text-xs">
                                Cancel
                              </AdminButton>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2">
                        <AdminButton variant="secondary" icon="edit" disabled={busy} onClick={() => openOptionEditor(it)} className="min-h-8 px-3 text-xs">
                          Change design / color
                        </AdminButton>
                      </div>
                    )
                  )}
                </div>
                <div className="text-sm font-medium text-slate-900">{it.is_custom_request ? "custom" : `৳ ${it.price_snapshot}`}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Payment">
          <Row k="Method" v={order.payment_method || "—"} />
          <Row k="Transaction ID" v={order.transaction_id || "—"} />
          <Row k="Verified" v={order.payment_verified ? "Yes" : "No"} />
          {order.payment_screenshot && (
            <a href={order.payment_screenshot} target="_blank" className="mt-2 inline-block text-sm font-semibold text-plum hover:underline">
              View screenshot
            </a>
          )}
          {!order.payment_verified && (
            <div className="mt-3">
              <AdminButton
                disabled={busy}
                icon="check"
                onClick={() => act(() => adminPost(`orders/${order.id}/verify_payment/`), "Payment verified")}
              >
                Mark payment verified
              </AdminButton>
            </div>
          )}
        </Panel>

        <Panel title="Courier delivery history">
          <FraudSummary data={order.fraud_check_result} />
        </Panel>

        <Panel title="Steadfast consignment">
          {order.courier_submitted ? (
            <>
              <Row k="Consignment" v={order.steadfast_consignment_id} />
              <Row k="Tracking" v={order.steadfast_tracking_code || "—"} />
              <Row k="Status" v={order.steadfast_status || "—"} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {order.steadfast_tracking_code && (
                  <AdminButton
                    variant="secondary"
                    icon="copy"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(order.steadfast_tracking_code);
                        setMsg("Tracking code copied — paste it in Steadfast → Tracking Parcel");
                      } catch { /* clipboard unavailable */ }
                    }}
                  >
                    Copy tracking code
                  </AdminButton>
                )}
                <Link
                  href={`/admin/orders/${order.id}/challan`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Icon name="upload" size={16} /> Print challan
                </Link>
                <AdminButton
                  variant="secondary"
                  icon="truck"
                  disabled={busy}
                  onClick={() => act(() => adminPost(`orders/${order.id}/steadfast_status/`), "Steadfast status refreshed")}
                >
                  Refresh status
                </AdminButton>
                {(() => {
                  const st = (order.steadfast_status || "").toLowerCase();
                  const valid = st !== "" && st !== "unknown";
                  return (
                    <AdminButton
                      variant="danger"
                      icon="truck"
                      disabled={busy || valid}
                      title={valid ? "Consignment is valid — re-submit only if it failed" : undefined}
                      onClick={() => {
                        if (confirm("Re-submit creates a NEW Steadfast consignment (new parcel ID). Use only if the previous booking failed or shows an error. Continue?")) {
                          act(() => adminPost(`orders/${order.id}/resubmit_steadfast/`), "Re-submitted to Steadfast");
                        }
                      }}
                    >
                      Re-submit
                    </AdminButton>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="max-w-xs">
                <Field label="Advance received" hint="COD = total − this">
                  <TextInput value={advance} onChange={(e) => setAdvance(e.target.value)} />
                </Field>
              </div>
              <AdminButton
                disabled={busy}
                icon="truck"
                onClick={() => act(() => adminPost(`orders/${order.id}/confirm/`, { advance_received: advance }), "Confirmed + booked to Steadfast")}
              >
                Confirm order + book Steadfast
              </AdminButton>
            </div>
          )}
        </Panel>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Additional consignments</h2>
            {!extraOpen && (
              <AdminButton variant="secondary" icon="truck" disabled={busy} onClick={startExtra}>
                Book another entry
              </AdminButton>
            )}
          </div>

          {order.extra_consignments.length === 0 && (
            <p className="text-sm text-slate-400">No additional consignments.</p>
          )}
          {order.extra_consignments.map((ec) => (
            <div key={ec.id} className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 py-2 text-sm">
              <span>Invoice: {ec.invoice}</span>
              <span>CID: {ec.consignment_id || "—"}</span>
              <span>Track: {ec.tracking_code || "—"}</span>
              <span>Status: {ec.status || "—"}</span>
              <span>COD: ৳{ec.cod_amount}</span>
            </div>
          ))}

          {extraOpen && (
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3">
              <Field label="Recipient name">
                <TextInput value={extra.recipient_name}
                  onChange={(e) => setExtra((f) => ({ ...f, recipient_name: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <TextInput value={extra.recipient_phone}
                  onChange={(e) => setExtra((f) => ({ ...f, recipient_phone: e.target.value }))} />
              </Field>
              <Field label="Address">
                <TextArea value={extra.recipient_address}
                  onChange={(e) => setExtra((f) => ({ ...f, recipient_address: e.target.value }))} />
              </Field>
              <Field label="COD amount (৳)">
                <TextInput type="number" step="0.01" min="0" value={extra.cod_amount}
                  onChange={(e) => setExtra((f) => ({ ...f, cod_amount: e.target.value }))} />
              </Field>
              <Field label="Item description">
                <TextInput value={extra.item_description}
                  onChange={(e) => setExtra((f) => ({ ...f, item_description: e.target.value }))} />
              </Field>
              <div className="flex gap-3">
                <AdminButton icon="truck" disabled={busy} onClick={bookExtra}>
                  {busy ? "Booking…" : "Book on Steadfast"}
                </AdminButton>
                <AdminButton variant="secondary" disabled={busy} onClick={() => setExtraOpen(false)}>
                  Cancel
                </AdminButton>
              </div>
            </div>
          )}
        </Card>

        <Panel title="Status">
          <div className="mb-3 text-sm text-slate-500">
            Current: <StatusPill status={order.status} label={order.status_display} />
          </div>
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map((s) => (
              <AdminButton
                key={s}
                variant={s === order.status ? "primary" : "secondary"}
                disabled={busy || s === order.status}
                onClick={() => act(() => adminPost(`orders/${order.id}/set_status/`, { status: s }), `Status set to ${s}`)}
                className="min-h-8 px-3 text-xs"
              >
                {s}
              </AdminButton>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-right text-slate-800">{v}</span>
    </div>
  );
}

// Readable courier delivery-history summary (instead of raw JSON).
interface CourierStat { success?: number; cancel?: number; total?: number; success_ratio?: number; error?: string }
function FraudSummary({ data }: { data: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0)
    return <p className="text-sm text-slate-400">No data.</p>;

  const agg = (data.aggregate ?? {}) as {
    total_success?: number; total_cancel?: number; success_ratio?: number;
  };
  const couriers: [string, CourierStat][] = [
    ["Steadfast", (data.steadfast ?? {}) as CourierStat],
    ["Pathao", (data.pathao ?? {}) as CourierStat],
  ];
  const advance = Boolean((data as { advance_required?: boolean }).advance_required);

  return (
    <div className="space-y-3 text-sm">
      <div className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${advance ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
        {advance ? "Advance recommended (risky / no history)" : "Safe — good delivery record"}
      </div>
      <table className="w-full">
        <thead className="text-left text-slate-500">
          <tr><th className="py-1 font-medium">Courier</th><th className="font-medium">Delivered</th><th className="font-medium">Cancelled</th><th className="font-medium">Success</th></tr>
        </thead>
        <tbody>
          {couriers.map(([name, s]) => (
            <tr key={name} className="border-t border-slate-100">
              <td className="py-1 font-medium text-slate-800">{name}</td>
              {s.error ? (
                <td colSpan={3} className="text-slate-400">{s.error}</td>
              ) : (
                <>
                  <td>{s.success ?? 0}</td>
                  <td>{s.cancel ?? 0}</td>
                  <td>{s.success_ratio ?? 0}%</td>
                </>
              )}
            </tr>
          ))}
          <tr className="border-t border-slate-200 font-semibold text-slate-900">
            <td className="py-1">Total</td>
            <td>{agg.total_success ?? 0}</td>
            <td>{agg.total_cancel ?? 0}</td>
            <td>{agg.success_ratio ?? 0}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// One dimension of a customizable item's option editor (colors / corner /
// center / inside / designs / dupatta options) — selectable thumbnails with
// the current pick highlighted. `allowNone` clears the (optional) dimension.
interface ThumbOption { id: number; active?: boolean }
function OptionThumbRow<T extends ThumbOption>({
  label, options, imageField, priceField, selectedId, onSelect, allowNone = false,
}: {
  label: string;
  options: T[];
  imageField: string;
  priceField: string;
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
  allowNone?: boolean;
}) {
  const visible = options.filter((o) => o.active !== false);
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      <div className="flex flex-wrap gap-2">
        {allowNone && (
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[10px] font-medium ${
              selectedId == null ? "border-plum bg-plum/10 text-plum" : "border-slate-200 text-slate-400 hover:border-slate-300"
            }`}
          >
            None
          </button>
        )}
        {visible.map((o) => {
          const row = o as unknown as Record<string, unknown>;
          const img = (row[imageField] as string) || "";
          const priceMod = row[priceField];
          const selected = selectedId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              title={priceMod != null ? `৳ ${priceMod}` : undefined}
              className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-100 ${
                selected ? "border-plum" : "border-transparent hover:border-slate-300"
              }`}
            >
              {img ? (
                <Image src={img} alt="" fill sizes="56px" className="object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-[10px] text-slate-400">—</span>
              )}
            </button>
          );
        })}
        {visible.length === 0 && <p className="text-xs text-slate-400">No options configured</p>}
      </div>
    </div>
  );
}
