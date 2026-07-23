"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { markProgress } from "@/lib/progress";

// Only browse pages get the CTA — it has no business on cart/checkout/track etc.
const ALLOWED = ["/", "/products", "/gallery"];

// Floating "customize" CTA that slides in once the user scrolls down.
export default function StickyCustomize() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Home, shop, and gallery (incl. /gallery/<tag>) only.
  const allowed =
    ALLOWED.includes(pathname) || pathname.startsWith("/gallery/");
  if (!allowed) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center transition-opacity duration-300 sm:bottom-6 ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      <Link
        href="/customize"
        aria-label="নিজের মতো সাজান"
        onClick={() => markProgress()}
        className={`pointer-events-auto inline-flex min-h-13 items-center gap-2 rounded-full bg-linear-to-r from-wine via-plum to-gold px-7 text-base font-bold text-white ring-2 ring-gold-soft/70 hover:brightness-110 ${
          show ? "cta-attention" : ""
        }`}
      >
        <Icon name="sparkles" size={20} className="animate-pulse text-gold-soft" />
        নিজের মতো সাজান
      </Link>
    </div>
  );
}
