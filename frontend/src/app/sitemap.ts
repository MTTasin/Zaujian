import type { MetadataRoute } from "next";
import { getCombos } from "@/lib/api";
import { fetchGalleryIndex } from "@/lib/gallery";
import { SITE_URL } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    "", "/products", "/customize", "/gallery", "/custom-request",
    "/privacy", "/terms",
  ].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : p === "/privacy" || p === "/terms" ? 0.3 : 0.7,
  }));

  // No /product/<slug> entries: plain Products are customizer building blocks
  // now, not storefront pages, and that route 308s to /products.
  let combos: MetadataRoute.Sitemap = [];
  try {
    const list = await getCombos();
    combos = list.map((c) => ({
      url: `${SITE_URL}/combo/${c.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  } catch {
    /* API unreachable at build */
  }

  let galleryTags: MetadataRoute.Sitemap = [];
  try {
    const tags = await fetchGalleryIndex();
    galleryTags = tags.map((t) => ({
      url: `${SITE_URL}/gallery/${t.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch {
    /* API unreachable at build */
  }

  return [...staticPages, ...combos, ...galleryTags];
}
