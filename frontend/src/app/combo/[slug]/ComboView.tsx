"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { PriceTag } from "@/components/ui/PriceTag";
import { useCustomerInputs } from "@/components/configurator/CustomerInputs";
import { addComboToCart, editComboCartItem, getCart, mediaUrl, type ComboDetail } from "@/lib/api";

type Answers = { fields?: { label: string; value: string }[]; note?: string };

/** When editing a cart line we must load its saved answers BEFORE mounting the
 *  form, because the inputs hook seeds its state once on first render. */
export default function ComboView({
  combo,
  slug,
  editId,
}: {
  combo: ComboDetail;
  slug: string;
  editId?: number;
}) {
  const [initial, setInitial] = useState<Answers | null>(editId ? null : {});

  useEffect(() => {
    if (!editId) return;
    getCart()
      .then((cart) => {
        const line = cart.items.find((i) => i.id === editId);
        const cfg = (line?.config ?? {}) as Answers;
        setInitial({ fields: cfg.fields ?? [], note: cfg.note ?? "" });
      })
      .catch(() => setInitial({}));
  }, [editId]);

  if (!initial) {
    return (
      <div className="flex flex-1 flex-col">
        <Container className="py-6 lg:py-10">
          <p className="py-10 text-center text-muted">লোড হচ্ছে...</p>
        </Container>
      </div>
    );
  }
  return <ComboBody combo={combo} slug={slug} editId={editId} initialInputs={initial} />;
}

function ComboBody({
  combo,
  slug,
  editId,
  initialInputs,
}: {
  combo: ComboDetail;
  slug: string;
  editId?: number;
  initialInputs?: Answers;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useCustomerInputs(combo, initialInputs);

  async function addToCart() {
    if (!inputs.validate()) return;   // required answers block the button
    setBusy(true);
    try {
      if (editId) await editComboCartItem(editId, inputs.payload());
      else await addComboToCart(slug, inputs.payload());
      router.push("/cart");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সমস্যা হয়েছে");
      setBusy(false);
    }
  }

  const images = combo.images;

  return (
    <div className="flex flex-1 flex-col">
      <Container className="py-6 lg:py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="relative mb-3 aspect-square overflow-hidden rounded-3xl bg-surface-2 shadow-sm ring-1 ring-border">
            {images[active] ? (
              <Image src={mediaUrl(images[active].image)} alt={combo.name} fill sizes="480px" className="object-cover" priority />
            ) : (
              <span className="flex h-full items-center justify-center text-plum/25">
                <Icon name="gift" size={64} />
              </span>
            )}
          </div>
          {images.length > 1 && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  aria-label={`ছবি ${i + 1}`}
                  onClick={() => setActive(i)}
                  className={`relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-2 transition ${
                    i === active ? "ring-gold" : "ring-border hover:ring-plum/40"
                  }`}
                >
                  <Image src={mediaUrl(img.image)} alt="" fill sizes="64px" className="object-cover" />
                </button>
              ))}
            </div>
          )}

          <Eyebrow>রেডিমেড কম্বো</Eyebrow>
          <h1 className="mt-2 font-display text-2xl font-semibold text-plum">{combo.name}</h1>
          <div className="mt-2">
            <PriceTag price={combo.price} size="lg" />
          </div>
          {combo.description && (
            <p className="mt-3 text-base leading-relaxed text-muted">{combo.description}</p>
          )}

          {/* Admin-defined questions for this combo (+ the optional note). */}
          <div className="mt-6">{inputs.node}</div>

          {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={addToCart}
              disabled={busy}
              className="inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-plum text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98] disabled:opacity-50"
            >
              <Icon name="cart" size={18} /> {editId ? "আপডেট করুন ✓" : "কার্টে যোগ করুন"}
            </button>
            {!editId && combo.product_slugs.length > 0 && (
              <button
                type="button"
                onClick={() => router.push(`/customize?combo=${slug}`)}
                className="inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full border border-plum/25 text-base font-semibold text-plum transition hover:border-plum active:scale-[0.98]"
              >
                <Icon name="sliders" size={18} /> কিছু পরিবর্তন করুন
              </button>
            )}
          </div>

          <ComboFaq hasCustomizable={combo.product_slugs.length > 0} />
        </div>
      </Container>
    </div>
  );
}

/** Answers the questions customers ask on chat before ordering, so they don't
 *  have to ask. Plain <details> — no JS, cheap on a 2G connection. */
function ComboFaq({ hasCustomizable }: { hasCustomizable: boolean }) {
  const faqs: { q: string; a: string }[] = [
    ...(hasCustomizable
      ? [{
          q: "“কিছু পরিবর্তন করুন” মানে কী?",
          a: "উপরের ছবিতে যে ডিজাইন দেখছেন, সেটাই ডিফল্ট। রং, কোণার বা মাঝের ডিজাইন বদলাতে চাইলে এই বাটনে চাপ দিন — ধাপে ধাপে নিজের মতো সাজাতে পারবেন। কিছু না বদলালে ছবির ডিজাইনই পাবেন।",
        }]
      : []),
    {
      q: "কাস্টম অর্ডার কী? কখন লাগবে?",
      a: "আমাদের তালিকায় নেই — এমন কিছু বানাতে চাইলে কাস্টম অর্ডার। যেমন নিজের আঁকা ডিজাইন, ভিন্ন মাপ, বা অন্য কোথাও দেখা কোনো নকশা। আপনি ছবি ও বর্ণনা পাঠাবেন, আমরা দেখে দাম জানাব — তারপর আপনি রাজি হলে বানানো শুরু হবে। আগে থেকে টাকা লাগে না।",
    },
    {
      q: "নাম ও তারিখ কীভাবে লেখা হবে?",
      a: "উপরের ঘরগুলোতে যেভাবে লিখে দেবেন, ঠিক সেভাবেই লেখা হবে। বানান ভালো করে দেখে নিন — অর্ডার নিশ্চিত হওয়ার আগে আমরা ফোনে একবার মিলিয়ে নেব।",
    },
    {
      q: "ডেলিভারিতে কত দিন লাগে?",
      a: "কাস্টমাইজ করা পণ্য হাতে তৈরি হয়, তাই সাধারণত ৩–৭ কর্মদিবস লাগে। কুরিয়ারে পাঠানোর পর ট্র্যাকিং কোড দিয়ে অর্ডার কোথায় আছে দেখতে পারবেন।",
    },
    {
      q: "টাকা কখন দিতে হবে?",
      a: "বেশিরভাগ অর্ডারে ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দেবেন। কিছু ক্ষেত্রে অল্প অগ্রিম লাগতে পারে, তখন অর্ডারের পরেই বিকাশ/নগদ নম্বর জানিয়ে দেওয়া হবে।",
    },
    {
      q: "ভুল হলে বা পছন্দ না হলে?",
      a: "নাম-তারিখ দেওয়া পণ্য একজনের জন্যই বানানো হয়, তাই ফেরত নেওয়া যায় না। সেজন্যই বানানোর আগে আমরা ফোনে সব মিলিয়ে নিই। পণ্য ভাঙা বা আমাদের ভুল হলে অবশ্যই ঠিক করে দেব।",
    },
  ];

  return (
    <section className="mt-10 border-t border-border pt-8">
      <h2 className="mb-4 font-display text-lg font-semibold text-plum">সাধারণ জিজ্ঞাসা</h2>
      <ul className="flex flex-col gap-3">
        {faqs.map((f) => (
          <li key={f.q}>
            <details className="group rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-base font-semibold text-foreground">
                {f.q}
                <span className="shrink-0 text-gold transition group-open:rotate-90">
                  <Icon name="chevronRight" size={18} />
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          </li>
        ))}
      </ul>
      <Link
        href="/custom-request"
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-plum/25 text-sm font-semibold text-plum transition hover:border-plum"
      >
        <Icon name="sparkles" size={16} /> নিজের ডিজাইনে বানাতে চান? কাস্টম অর্ডার করুন
      </Link>
    </section>
  );
}
