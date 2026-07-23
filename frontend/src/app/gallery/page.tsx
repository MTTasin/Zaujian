import Link from "next/link";
import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fetchGalleryIndex } from "@/lib/gallery";

export const metadata: Metadata = {
  title: "গ্যালারি — জাউজাইন নিকাহ পয়েন্ট",
  description: "আমাদের কাস্টম নিকাহনামা, বক্স, ফ্রেম ও কম্বোর আসল ছবি দেখুন।",
};

export default async function GalleryIndexPage() {
  const tags = await fetchGalleryIndex();
  return (
    <Container className="py-8 lg:py-12">
      <Eyebrow>গ্যালারি</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-bold text-plum md:text-4xl">
        আমাদের কাজের ছবি
      </h1>

      {tags.length === 0 ? (
        <p className="mt-8 text-muted">কোনো ছবি এখনো যোগ করা হয়নি।</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {tags.map((t) => (
            <Link
              key={t.slug}
              href={`/gallery/${t.slug}`}
              className="group overflow-hidden rounded-2xl border border-border bg-surface transition hover:shadow-md"
            >
              <div className="aspect-square overflow-hidden bg-surface-2">
                {t.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt={t.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                )}
              </div>
              <div className="p-3">
                <p className="font-display font-bold text-plum">{t.title}</p>
                <p className="text-xs text-muted">{t.count} ছবি</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
