import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fetchGalleryTag } from "@/lib/gallery";
import { TagGallery } from "./TagGallery";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchGalleryTag(slug);
  if (!data) return { title: "গ্যালারি" };
  return {
    title: `${data.title} — গ্যালারি | জাউজাইন নিকাহ পয়েন্ট`,
    description: data.description || `${data.title} এর ছবি দেখুন।`,
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchGalleryTag(slug);
  if (!data) notFound();
  return (
    <Container className="py-8 lg:py-12">
      <Eyebrow>গ্যালারি</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-bold text-plum md:text-4xl">
        {data.title}
      </h1>
      {data.description && <p className="mt-2 text-muted">{data.description}</p>}
      <TagGallery photos={data.photos} />
    </Container>
  );
}
