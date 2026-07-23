import Link from "next/link";
import Image from "next/image";
import ComboCard from "@/components/ComboCard";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  getCombos,
  getHome,
  getShopInfo,
  mediaUrl,
  type ComboListItem,
  type HomeData,
  type ShopInfo,
} from "@/lib/api";
import { faqJsonLd } from "@/lib/seo";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

const EMPTY_HOME: HomeData = {
  site: { hero_image: null, hero_title: "", hero_subtitle: "", band_image: null },
  categories: [],
  featured: [],
  popular: [],
};

const TRUST: { icon: IconName; label: string }[] = [
  { icon: "truck", label: "সারা বাংলাদেশে ডেলিভারি" },
  { icon: "wallet", label: "ক্যাশ অন ডেলিভারি" },
  { icon: "phone", label: "কল করে অর্ডার কনফার্ম" },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "sparkles", title: "পছন্দ করুন বা সাজান", body: "রেডিমেড পণ্য বেছে নিন, অথবা নিজের মতো ডিজাইন করুন।" },
  { icon: "cart", title: "অর্ডার দিন", body: "কার্টে যোগ করে নাম, ফোন ও ঠিকানা দিন।" },
  { icon: "truck", title: "ঘরে ডেলিভারি", body: "আমরা কল করে কনফার্ম করি, তারপর পৌঁছে দিই।" },
];

const WHY: { icon: IconName; title: string; body: string }[] = [
  { icon: "gift", title: "প্রিমিয়াম মান", body: "যত্ন করে বাছাই করা উপকরণ ও সুন্দর ফিনিশিং।" },
  { icon: "sparkles", title: "সম্পূর্ণ কাস্টমাইজ", body: "রঙ, ডিজাইন ও লেখা — সব আপনার পছন্দমতো।" },
  { icon: "truck", title: "দ্রুত ডেলিভারি", body: "সারা দেশে ৩–৭ কর্মদিবসে পৌঁছে যায়।" },
  { icon: "wallet", title: "নিরাপদ পেমেন্ট", body: "হাতে পণ্য পেয়ে টাকা দিন।" },
];

function SectionHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-2 font-display text-2xl font-semibold text-plum sm:text-3xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

export default async function HomePage() {
  const [home, shopInfo, allCombos] = await Promise.all([
    safe<HomeData>(getHome(), EMPTY_HOME),
    safe<ShopInfo | null>(getShopInfo(), null),
    safe<ComboListItem[]>(getCombos(), []),
  ]);

  const { site, featured, popular } = home;

  // Show combos ticked "Featured"; if none are, fall back to the first few so the
  // section never sits empty.
  const featuredCombos = allCombos.filter((c) => c.featured);
  const homeCombos = (featuredCombos.length > 0 ? featuredCombos : allCombos).slice(0, 4);

  const heroImg =
    site.hero_image ||
    featured.find((p) => p.thumbnail)?.thumbnail ||
    popular.find((p) => p.thumbnail)?.thumbnail ||
    null;
  const bandImg =
    site.band_image ||
    popular.find((p) => p.thumbnail && p.thumbnail !== heroImg)?.thumbnail ||
    heroImg;

  // Category strip comes ONLY from admin-managed tiles (/admin/homepage).
  const cats = home.categories.map((c) => ({
    key: String(c.id),
    title: c.title,
    image: c.image,
    link: c.link || `/products?category=${encodeURIComponent(c.title)}`,
  }));

  const faqs = [
    { q: "কীভাবে অর্ডার করব?", a: "পণ্য বেছে নিন বা নিজের মতো সাজান, কার্টে যোগ করে নাম-ফোন-ঠিকানা দিন। আমরা কল করে কনফার্ম করব।" },
    { q: "ডেলিভারি কত দিনে হয়?", a: "সাধারণত ৩ থেকে ৭ কর্মদিবসের মধ্যে সারা বাংলাদেশে ডেলিভারি হয়।" },
    { q: "পেমেন্ট কীভাবে?", a: "ক্যাশ অন ডেলিভারি - হাতে পণ্য পেয়ে টাকা দিন।" },
    { q: "নিজের ডিজাইন দেওয়া যাবে?", a: "হ্যাঁ। কাস্টম অর্ডারে নিজের ছবি বা ডিজাইন পাঠান, আমরা দাম জানিয়ে দেবো।" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(faqs)) }}
      />
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-soft/25 blur-3xl" aria-hidden />
        <Container className="relative grid items-center gap-10 py-14 lg:grid-cols-2 lg:gap-14 lg:py-24">
          <div className="text-center lg:text-left">
            <div className="flex justify-center lg:justify-start">
              <Eyebrow>প্রিমিয়াম কাস্টমাইজড নিকাহনামা</Eyebrow>
            </div>
            {site.hero_title ? (
              <h1 className="text-balance mt-5 font-display text-4xl font-semibold leading-[1.08] text-plum sm:text-5xl lg:text-6xl">
                {site.hero_title}
              </h1>
            ) : (
              <h1 className="text-balance mt-5 font-display text-4xl font-semibold leading-[1.08] text-plum sm:text-5xl lg:text-6xl">
                আপনার বিশেষ দিন <span className="text-gold">স্মরণীয়</span> করে রাখুন
              </h1>
            )}
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
              {site.hero_subtitle ||
                "হাতে তৈরি প্রিমিয়াম নিকাহনামা কম্বো — নিজের পছন্দমতো ডিজাইন করুন, অথবা রেডিমেড থেকে বেছে নিন।"}
            </p>
            <div className="mx-auto mt-8 flex max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:justify-center lg:justify-start">
              <Link
                href="/customize"
                className="inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-plum px-9 text-base font-semibold text-white shadow-sm transition hover:bg-wine active:scale-[0.98]"
              >
                <Icon name="sparkles" size={18} /> নিজের মতো সাজান
              </Link>
              <Link
                href="/products"
                className="inline-flex min-h-14 cursor-pointer items-center justify-center rounded-full border border-plum/25 px-9 text-base font-semibold text-plum transition hover:border-plum active:scale-[0.98]"
              >
                সব পণ্য দেখুন
              </Link>
            </div>
            <ul className="mx-auto mt-7 flex max-w-md flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted lg:mx-0 lg:justify-start">
              {TRUST.map((t) => (
                <li key={t.label} className="inline-flex items-center gap-2">
                  <span className="text-gold"><Icon name="check" size={16} /></span>
                  {t.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <div className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-gold-soft/20 blur-2xl" aria-hidden />
            <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-surface-2 shadow-xl ring-1 ring-gold/30">
              {heroImg ? (
                <Image
                  src={mediaUrl(heroImg)}
                  alt="নিকাহনামা কম্বো"
                  fill
                  priority
                  sizes="(max-width:1024px) 90vw, 520px"
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-plum/30">
                  <Icon name="gift" size={72} />
                </span>
              )}
            </div>
            <div className="absolute -bottom-4 left-6 flex items-center gap-2 rounded-full bg-surface px-4 py-2 shadow-lg ring-1 ring-border">
              <span className="text-gold"><Icon name="sparkles" size={16} /></span>
              <span className="text-sm font-semibold text-plum">হাতে তৈরি</span>
            </div>
          </div>
        </Container>
      </section>

      <Container>
        {/* Categories */}
        {cats.length > 0 && (
          <section className="py-10">
            <SectionHead
              eyebrow="বিভাগ"
              title="বিভাগ থেকে দেখুন"
              action={
                <Link href="/products" className="hidden shrink-0 text-sm font-semibold text-plum hover:text-gold sm:inline">
                  সব দেখুন →
                </Link>
              }
            />
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 sm:gap-4">
              {cats.map((c) => (
                <li key={c.key}>
                  <Link
                    href={c.link}
                    className="group relative flex aspect-square items-end overflow-hidden rounded-2xl bg-plum shadow-sm ring-1 ring-black/5"
                  >
                    {c.image && (
                      <Image
                        src={mediaUrl(c.image)}
                        alt={c.title}
                        fill
                        sizes="(max-width:640px) 33vw, 180px"
                        className="object-cover opacity-90 transition duration-500 group-hover:scale-105"
                      />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-wine/85 via-wine/20 to-transparent" aria-hidden />
                    <span className="relative w-full p-2.5 text-center font-display text-sm font-semibold text-white">
                      {c.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Featured/popular plain-product strips were removed with /shop: every
            storefront listing is a PrebuiltCombo now, so the combo strip below
            is the single curated shelf. */}

        {/* Ready-made combos — featured first, else the newest few. */}
        {homeCombos.length > 0 && (
          <section className="py-10">
            <SectionHead
              eyebrow="রেডিমেড"
              title="জনপ্রিয় কম্বো"
              action={
                <Link href="/products" className="shrink-0 text-sm font-semibold text-plum hover:text-gold">
                  সব কম্বো →
                </Link>
              }
            />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6">
              {homeCombos.map((c) => (
                <li key={c.id}>
                  <ComboCard combo={c} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>

      {/* ---------- Atelier band ---------- */}
      <section className="relative overflow-hidden bg-wine text-white">
        <div className="pointer-events-none absolute -left-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-gold/15 blur-3xl" aria-hidden />
        <Container className="relative grid items-center gap-10 py-14 lg:grid-cols-2 lg:py-20">
          <div className="relative order-2 mx-auto w-full max-w-sm lg:order-1 lg:max-w-none">
            <div className="relative aspect-[5/4] overflow-hidden rounded-[1.5rem] ring-1 ring-gold/30">
              {bandImg ? (
                <Image
                  src={mediaUrl(bandImg)}
                  alt="কাস্টম ডিজাইন"
                  fill
                  sizes="(max-width:1024px) 90vw, 520px"
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center bg-plum text-white/30">
                  <Icon name="sparkles" size={64} />
                </span>
              )}
            </div>
          </div>
          <div className="order-1 text-center lg:order-2 lg:text-left">
            <div className="flex justify-center lg:justify-start">
              <Eyebrow onDark>নিজের মতো ডিজাইন</Eyebrow>
            </div>
            <h2 className="text-balance mt-4 font-display text-3xl font-semibold leading-tight sm:text-4xl">
              যেমন চান, ঠিক তেমন বানিয়ে নিন
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-white/80 lg:mx-0">
              রঙ, কর্নার, সেন্টার ডিজাইন ও লেখা — প্রতিটি ধাপে নিজের পছন্দ দিন, আর সাথে সাথে দাম দেখুন।
            </p>
            <Link
              href="/customize"
              className="mt-8 inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-gold px-9 text-base font-semibold text-wine shadow-sm transition hover:bg-gold-soft active:scale-[0.98]"
            >
              <Icon name="sparkles" size={18} /> সাজানো শুরু করুন
            </Link>
          </div>
        </Container>
      </section>

      <Container>
        <div className="gold-rule my-4" />

        {/* How it works */}
        <section className="py-10">
          <div className="text-center">
            <div className="flex justify-center">
              <Eyebrow>সহজ প্রক্রিয়া</Eyebrow>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold text-plum sm:text-3xl">
              কীভাবে অর্ডার করবেন
            </h2>
          </div>
          <ol className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-plum text-white ring-4 ring-gold/20">
                  <Icon name={s.icon} size={24} />
                </span>
                <span className="mt-3 block font-display text-sm font-semibold text-gold">
                  ধাপ {i + 1}
                </span>
                <p className="mt-1 font-display text-lg font-semibold text-foreground">
                  {s.title}
                </p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Why us */}
        <section className="py-10">
          <SectionHead eyebrow="কেন আমরা" title="যে কারণে গ্রাহকেরা আমাদের বেছে নেন" />
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {WHY.map((w) => (
              <li key={w.title} className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-border">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/12 text-gold">
                  <Icon name={w.icon} size={22} />
                </span>
                <p className="mt-4 font-display text-lg font-semibold text-foreground">
                  {w.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{w.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Delivery & payment */}
        <section className="py-10">
          <SectionHead eyebrow="ভরসা" title="ডেলিভারি ও পেমেন্ট" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-6">
            {[
              { icon: "wallet" as IconName, tint: "bg-success/12 text-success", title: "ক্যাশ অন ডেলিভারি", body: "হাতে পণ্য পেয়ে টাকা পরিশোধ করুন।" },
              { icon: "truck" as IconName, tint: "bg-plum/10 text-plum", title: "ডেলিভারি চার্জ", body: shopInfo ? `৳${shopInfo.delivery_charge} — সারা বাংলাদেশে।` : "সারা বাংলাদেশে ডেলিভারি।" },
              { icon: "phone" as IconName, tint: "bg-gold/12 text-gold", title: "অগ্রিম (যদি লাগে)", body: shopInfo && (shopInfo.bkash_number || shopInfo.nagad_number) ? `বিকাশ/নগদ: ${shopInfo.bkash_number || shopInfo.nagad_number}` : "প্রয়োজনে বিকাশ/নগদে অল্প অগ্রিম।" },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-border">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${c.tint}`}>
                  <Icon name={c.icon} size={22} />
                </span>
                <p className="mt-4 font-display text-lg font-semibold text-foreground">{c.title}</p>
                <p className="mt-1 text-sm text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="py-10">
          <SectionHead eyebrow="প্রশ্ন-উত্তর" title="সাধারণ জিজ্ঞাসা" />
          <ul className="flex flex-col gap-3">
            {faqs.map((f) => (
              <li key={f.q}>
                <details className="group rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-semibold text-foreground">
                    {f.q}
                    <span className="text-gold transition group-open:rotate-90">
                      <Icon name="chevronRight" size={18} />
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      {/* ---------- Closing CTA ---------- */}
      <section className="bg-surface-2">
        <Container className="py-14 text-center">
          <div className="flex justify-center">
            <Eyebrow>শুরু করুন</Eyebrow>
          </div>
          <h2 className="text-balance mx-auto mt-3 max-w-2xl font-display text-3xl font-semibold text-plum sm:text-4xl">
            আপনার নিকাহনামা হোক সবচেয়ে সুন্দর
          </h2>
          <div className="mx-auto mt-8 flex max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:justify-center">
            <Link
              href="/customize"
              className="inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-plum px-9 text-base font-semibold text-white shadow-sm transition hover:bg-wine active:scale-[0.98]"
            >
              <Icon name="sparkles" size={18} /> নিজের মতো সাজান
            </Link>
            <Link
              href="/custom-request"
              className="inline-flex min-h-14 cursor-pointer items-center justify-center rounded-full border border-plum/25 px-9 text-base font-semibold text-plum transition hover:border-plum active:scale-[0.98]"
            >
              কাস্টম অর্ডার করুন
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted">
            সাহায্য দরকার? নিচের চ্যাট বাটনে চাপ দিন, অথবা{" "}
            <Link href="/track" className="font-semibold text-plum underline">
              অর্ডার ট্র্যাক করুন
            </Link>
            ।
          </p>
        </Container>
      </section>
    </div>
  );
}
