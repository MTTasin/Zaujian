import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCombo, mediaUrl, type ComboDetail } from "@/lib/api";
import { SITE_URL, SITE_NAME, SITE_DESC, OG_IMAGE, breadcrumbJsonLd } from "@/lib/seo";
import ComboView from "./ComboView";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  try {
    const c = await getCombo(slug);
    const title = `${c.name} — কম্বো`;
    const description = (c.description || SITE_DESC).slice(0, 160);
    const image = c.images[0] ? mediaUrl(c.images[0].image) : OG_IMAGE;
    return {
      title,
      description,
      alternates: { canonical: `/combo/${c.slug}` },
      openGraph: {
        type: "website",
        title,
        description,
        url: `${SITE_URL}/combo/${c.slug}`,
        siteName: SITE_NAME,
        images: [{ url: image }],
      },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return { title: "কম্বো" };
  }
}

export default async function ComboPage(
  { params, searchParams }: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ edit?: string }>;
  },
) {
  const { slug } = await params;
  // ?edit=<cartItemId> -> update that cart line's answers instead of adding a new one.
  const { edit } = await searchParams;
  const editId = edit ? Number(edit) : undefined;
  let combo: ComboDetail;
  try {
    combo = await getCombo(slug);
  } catch {
    notFound();
  }

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: combo.name,
    image: combo.images.length ? combo.images.map((i) => mediaUrl(i.image)) : undefined,
    description: combo.description || undefined,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: combo.price,
      priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
      itemCondition: "https://schema.org/NewCondition",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/combo/${combo.slug}`,
      seller: { "@type": "Store", name: SITE_NAME, url: SITE_URL },
    },
  };
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "হোম", path: "/" },
    { name: "কম্বো", path: "/products" },
    { name: combo.name, path: `/combo/${combo.slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <ComboView combo={combo} slug={slug} editId={editId} />
    </>
  );
}
