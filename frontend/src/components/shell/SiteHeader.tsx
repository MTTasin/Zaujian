"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Drawer } from "@/components/ui/Drawer";
import { SearchBar } from "@/components/ui/SearchBar";
import { Icon } from "@/components/ui/Icon";

export default function SiteHeader() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (q: string) => router.push(`/products?q=${encodeURIComponent(q)}`);
  const headerRef = useRef<HTMLElement>(null);

  // Expose the real header height so sticky content (e.g. the configurator
  // preview) can park just below it instead of sliding underneath.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setVar = () =>
      document.documentElement.style.setProperty("--site-header-h", `${el.offsetHeight}px`);
    setVar();
    // Not available in jsdom (tests) — the one-shot measure above still applies.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iconLink =
    "flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-plum transition hover:bg-surface-2 active:scale-95";

  return (
    <header ref={headerRef} className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <Container className="flex items-center gap-2 py-3 sm:gap-3">
        <button
          type="button"
          aria-label="মেনু"
          className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-plum/20 bg-surface px-3.5 text-plum transition hover:border-plum/40 active:scale-95"
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" size={20} />
          <span className="hidden text-sm font-semibold sm:inline">মেনু</span>
        </button>
        <Link href="/" className="mr-auto flex min-w-0 items-center gap-2.5 leading-none">
          <Image
            src="/logo.jpg"
            alt="Zaujain Nikah Point"
            width={40}
            height={40}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-gold/40 sm:h-10 sm:w-10"
          />
          <span className="truncate font-display text-base font-bold tracking-tight text-plum sm:text-xl">
            Zaujain Nikah Point
          </span>
        </Link>
        <Link href="/track" aria-label="অর্ডার ট্র্যাক" className={`${iconLink} shrink-0`}>
          <Icon name="truck" size={22} />
        </Link>
        <Link href="/cart" aria-label="কার্ট" className={`${iconLink} shrink-0`}>
          <Icon name="cart" size={22} />
        </Link>
      </Container>
      <Container className="pb-3">
        <SearchBar onSubmit={go} />
      </Container>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="বিভাগসমূহ">
        <nav className="flex flex-col gap-1">
          <Link
            href="/products"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            সব পণ্য
          </Link>
          <Link
            href="/products"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            রেডিমেড কম্বো
          </Link>
          <Link
            href="/customize"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            কাস্টমাইজ করুন
          </Link>
          <Link
            href="/gallery"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            গ্যালারি
          </Link>
        </nav>
      </Drawer>
    </header>
  );
}
