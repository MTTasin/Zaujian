"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { checkout, getCart, getShopInfo, type CartState, type ShopInfo } from "@/lib/api";
import { metaTrack } from "@/lib/meta";
import { BD_LOCATIONS } from "@/lib/bdLocations";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";

export default function CheckoutPage() {
  const [cart, setCart] = useState<CartState | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [thana, setThana] = useState("");
  const [thanaOther, setThanaOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    Promise.all([getCart(), getShopInfo()])
      .then(([c, s]) => {
        setCart(c); setShop(s);
        metaTrack("InitiateCheckout", { currency: "BDT", value: Number(c.subtotal) });
      })
      .catch(() => setError("তথ্য লোড করা যায়নি"));
  }, []);

  const divisions = useMemo(() => Object.keys(BD_LOCATIONS), []);
  const districts = useMemo(
    () => (division ? Object.keys(BD_LOCATIONS[division] ?? {}) : []),
    [division],
  );
  const thanas = useMemo(
    () => (division && district ? BD_LOCATIONS[division]?.[district] ?? [] : []),
    [division, district],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!division || !district || !thana) {
      setError("বিভাগ, জেলা ও থানা নির্বাচন করুন");
      return;
    }
    const finalThana = thana === "Others" ? thanaOther.trim() : thana;
    if (!finalThana) {
      setError("আপনার থানার নাম লিখুন");
      return;
    }
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const order = await checkout({
        customer_name: String(fd.get("customer_name")),
        phone: String(fd.get("phone")),
        whatsapp: String(fd.get("whatsapp") ?? ""),
        email: String(fd.get("email") ?? ""),
        division, district, thana: finalThana,
        address: String(fd.get("address")),
      });
      metaTrack(
        "Purchase",
        { currency: "BDT", value: Number(order.total) },
        { eventID: `purchase.${order.uid}` },
      );
      router.push(`/track/${order.uid}?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "সমস্যা হয়েছে");
      setBusy(false);
    }
  }

  const subtotal = Number(cart?.subtotal ?? 0);
  // Reduced charge inside the home district; backend re-computes authoritatively.
  const insideDistrict = (shop?.inside_district ?? "").trim().toLowerCase();
  const delivery =
    insideDistrict && district.trim().toLowerCase() === insideDistrict
      ? Number(shop?.delivery_charge_inside ?? shop?.delivery_charge ?? 0)
      : Number(shop?.delivery_charge ?? 0);
  const selectCls =
    "w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-plum disabled:opacity-50";

  return (
    <div className="flex flex-1 flex-col">
      <Container className="max-w-2xl py-8 lg:py-12">
        <Eyebrow>শেষ ধাপ</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-semibold text-plum">
          অর্ডার তথ্য
        </h1>
        <p className="mt-1 text-sm text-muted">
          আমরা কল করে অর্ডার কনফার্ম করব — তাই সঠিক নম্বর দিন।
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
            <Field label="আপনার নাম" name="customer_name" required />
            <Field label="মোবাইল নম্বর" name="phone" type="tel" required />
            <Field label="হোয়াটসঅ্যাপ নম্বর" name="whatsapp" type="tel" required />
            <Field label="ইমেইল (অর্ডার আপডেটের জন্য)" name="email" type="email" />
          </div>

          <div className="space-y-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
            <p className="font-display text-lg font-semibold text-foreground">
              ডেলিভারি ঠিকানা
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">বিভাগ</label>
              <select className={selectCls} value={division}
                onChange={(e) => { setDivision(e.target.value); setDistrict(""); setThana(""); }}>
                <option value="">বিভাগ নির্বাচন করুন</option>
                {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">জেলা</label>
              <select className={selectCls} value={district} disabled={!division}
                onChange={(e) => { setDistrict(e.target.value); setThana(""); }}>
                <option value="">জেলা নির্বাচন করুন</option>
                {districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">থানা / উপজেলা</label>
              <select className={selectCls} value={thana} disabled={!district}
                onChange={(e) => { setThana(e.target.value); setThanaOther(""); }}>
                <option value="">থানা নির্বাচন করুন</option>
                {thanas.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* Courier gets the address as free text anyway, so an unlisted
                  area must never block checkout. */}
              {thana === "Others" && (
                <input
                  className={`${selectCls} mt-2`} value={thanaOther} name="thana_other"
                  placeholder="আপনার থানার নাম লিখুন"
                  onChange={(e) => setThanaOther(e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">
                বিস্তারিত ঠিকানা (বাসা, রোড, এলাকা)
              </label>
              <textarea name="address" rows={2} required placeholder="বাসা #১২, রোড #৪, এলাকা"
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-plum" />
            </div>
          </div>

          <div className="rounded-2xl bg-surface-2 p-5">
            <Row label="পণ্যের দাম" value={subtotal.toFixed(2)} />
            <Row label="ডেলিভারি চার্জ" value={delivery.toFixed(2)} />
            <div className="my-2.5 gold-rule" />
            <Row label="সর্বমোট" value={(subtotal + delivery).toFixed(2)} bold />
          </div>

          {error && (
            <p className="rounded-xl bg-error/10 px-4 py-3 text-center text-sm font-semibold text-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !cart?.count}
            className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-plum text-base font-semibold text-white shadow-sm transition hover:bg-wine active:scale-[0.98] disabled:opacity-50">
            {busy ? (
              "যাচাই করা হচ্ছে..."
            ) : (
              <>
                <Icon name="check" size={18} /> অর্ডার নিশ্চিত করুন
              </>
            )}
          </button>
          <p className="flex items-center justify-center gap-2 text-center text-sm text-muted">
            <span className="text-gold"><Icon name="wallet" size={16} /></span>
            ক্যাশ অন ডেলিভারি — হাতে পেয়ে টাকা দিন
          </p>
        </form>
      </Container>
    </div>
  );
}

function Field({ label, name, type = "text", required }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-foreground">{label}</label>
      <input name={name} type={type} required={required}
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-plum" />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-display text-lg font-bold text-plum" : "text-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">৳ {value}</span>
    </div>
  );
}
