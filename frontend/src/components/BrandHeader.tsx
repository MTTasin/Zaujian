import Link from "next/link";

// Logo-styled header: dark bar, gradient wordmark, tagline. Cart on the right.
export default function BrandHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3">
        <Link href="/" className="leading-tight">
          <span className="brand-gradient-text text-xl font-bold">
            Zaujain Nikah Point
          </span>
          <span className="block text-[11px] italic text-muted">
            Make Your Marriage Memorable
          </span>
        </Link>
        <Link
          href="/cart"
          aria-label="কার্ট"
          className="brand-gradient rounded-full px-4 py-2 text-sm font-semibold text-white active:scale-95"
        >
          🛒 কার্ট
        </Link>
      </div>
    </header>
  );
}
