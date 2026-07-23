import type { Metadata } from "next";
import Link from "next/link";
import ComboCard from "@/components/ComboCard";
import StickyCustomize from "@/components/StickyCustomize";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { getCombos, type ComboListItem } from "@/lib/api";
import { SITE_DESC } from "@/lib/seo";

export const metadata: Metadata = {
  title: "সব পণ্য — নিকাহনামা কম্বো, ফ্রেম ও বক্স",
  description: SITE_DESC,
  alternates: { canonical: "/products" },
};

/**
 * The catalogue. Every buyable listing is a PrebuiltCombo — a bundle when it
 * links several products, a single item when it links one. Plain Products are
 * building blocks for the customizer now, not a separate storefront surface,
 * which is why this page replaced /shop.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q = "", category = "" } = await searchParams;
  const query = q.trim().toLowerCase();

  let all: ComboListItem[] = [];
  try {
    all = await getCombos();
  } catch {
    all = [];
  }

  const categories = Array.from(new Set(all.map((c) => c.category).filter(Boolean)));

  const listings = all.filter((c) => {
    if (category && c.category !== category) return false;
    if (query && ![c.name, c.category].some((h) => (h ?? "").toLowerCase().includes(query))) {
      return false;
    }
    return true;
  });

  const heading = q ? `“${q}” এর ফলাফল` : category || "সব পণ্য";
  const chip = (active: boolean) =>
    `rounded-full border px-4 py-2 text-sm font-semibold transition ${
      active
        ? "border-plum bg-plum text-white"
        : "border-border bg-surface text-plum hover:border-plum/40"
    }`;

  return (
    <div className="flex flex-1 flex-col">
      <Container className="py-8 lg:py-12">
        <Eyebrow>সংগ্রহ</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-semibold text-plum sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-1 text-sm text-muted">{listings.length} টি পণ্য</p>

        {categories.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/products" className={chip(!category)}>সব</Link>
            {categories.map((c) => (
              <Link
                key={c}
                href={`/products?category=${encodeURIComponent(c)}`}
                className={chip(category === c)}
              >
                {c}
              </Link>
            ))}
          </div>
        )}

        {listings.length > 0 ? (
          <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {listings.map((c) => (
              <li key={c.id}><ComboCard combo={c} /></li>
            ))}
          </ul>
        ) : (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-6 py-16 text-center">
            <span className="text-plum/30"><Icon name="image" size={44} /></span>
            <p className="font-display text-lg font-bold text-plum">কিছু পাওয়া যায়নি</p>
            <p className="text-sm text-muted">অন্য বিভাগ বা শব্দ দিয়ে খুঁজুন।</p>
            <Link
              href="/products"
              className="mt-2 inline-flex min-h-12 items-center rounded-full bg-plum px-6 font-semibold text-white"
            >
              সব পণ্য দেখুন
            </Link>
          </div>
        )}
      </Container>
      <StickyCustomize />
    </div>
  );
}
