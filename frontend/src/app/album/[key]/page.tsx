"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { getAlbum, type Album } from "@/lib/api";

// Lazy image gallery for a media key. Handles 50+ images on slow networks —
// next/image loads them lazily as the user scrolls.
export default function AlbumPage() {
  const { key } = useParams<{ key: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAlbum(key).then(setAlbum).catch(() => setError("গ্যালারি পাওয়া যায়নি"));
  }, [key]);

  return (
    <div className="flex flex-1 flex-col">
      <Container className="max-w-3xl flex-1 py-8 lg:py-12">
        {error && <p className="text-center text-error">{error}</p>}
        {album && (
          <>
            <div className="text-center">
              <div className="flex justify-center">
                <Eyebrow>ডিজাইন গ্যালারি</Eyebrow>
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold text-plum sm:text-3xl">
                {album.caption || "ডিজাইন গ্যালারি"}
              </h1>
              <p className="mt-1 text-sm text-muted">{album.images.length} টি ডিজাইন</p>
              {album.album_url && (
                <a
                  href={album.album_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-plum underline hover:text-gold"
                >
                  বাইরের অ্যালবামে দেখুন <Icon name="arrowRight" size={14} />
                </a>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {album.images.map((src, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-2xl bg-surface-2 shadow-sm ring-1 ring-border">
                  <Image src={src} alt="" fill loading="lazy" sizes="(max-width:640px) 50vw, 220px" className="object-cover" />
                </div>
              ))}
            </div>

            {album.images.length === 0 && !album.album_url && (
              <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-6 py-16 text-center">
                <span className="text-plum/30">
                  <Icon name="image" size={44} />
                </span>
                <p className="text-sm text-muted">কোনো ছবি নেই।</p>
              </div>
            )}
          </>
        )}
      </Container>
    </div>
  );
}
