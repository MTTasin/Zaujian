import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";

const PHONES = [
  { label: "01959976683", href: "tel:+8801959976683" },
  { label: "01974283081", href: "tel:+8801974283081" },
];

const SOCIALS = [
  { icon: "facebook" as const, href: "https://www.facebook.com/ZaujainNikahPoint", label: "Facebook" },
  { icon: "instagram" as const, href: "https://www.instagram.com/zaujainnikahpoint/", label: "Instagram" },
];

const SHOP_LINKS = [
  { href: "/products", label: "সব পণ্য" },
  { href: "/customize", label: "কাস্টমাইজ করুন" },
  { href: "/gallery", label: "গ্যালারি" },
  { href: "/products", label: "রেডিমেড কম্বো" },
];
const HELP_LINKS = [
  { href: "/track", label: "অর্ডার ট্র্যাক করুন" },
  { href: "/custom-request", label: "কাস্টম অর্ডার" },
  { href: "/cart", label: "কার্ট" },
];

function ColHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-gold">
      <span className="h-px w-5 bg-gold/60" aria-hidden />
      {children}
    </h3>
  );
}

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-border bg-surface-2">
      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.jpg"
                alt="Zaujain Nikah Point"
                width={44}
                height={44}
                className="h-11 w-11 rounded-full object-cover ring-1 ring-gold/40"
              />
              <p className="font-display text-lg font-bold text-plum">
                Zaujain Nikah Point
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              প্রিমিয়াম কাস্টমাইজড নিকাহনামা কম্বো — আপনার বিশেষ দিনকে স্মরণীয় করে রাখুন।
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-plum ring-1 ring-border">
              <span className="text-gold"><Icon name="wallet" size={14} /></span>
              ক্যাশ অন ডেলিভারি
            </p>
            <div className="mt-4 flex gap-2.5">
              {SOCIALS.map((s) => (
                <a
                  key={s.href}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-plum shadow-sm ring-1 ring-border transition hover:bg-plum hover:text-white"
                >
                  <Icon name={s.icon} size={18} />
                </a>
              ))}
            </div>
          </div>

          {/* Shop */}
          <div>
            <ColHeading>শপ</ColHeading>
            <ul className="flex flex-col gap-2.5 text-sm">
              {SHOP_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-foreground transition hover:text-gold">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Help */}
          <div>
            <ColHeading>সহায়তা</ColHeading>
            <ul className="flex flex-col gap-2.5 text-sm">
              {HELP_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-foreground transition hover:text-gold">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <ColHeading>যোগাযোগ</ColHeading>
            <div className="flex items-start gap-2.5 text-sm text-muted">
              <span className="mt-0.5 shrink-0 text-gold"><Icon name="pin" size={16} /></span>
              <span className="leading-relaxed">
                জি.এ. ভবন (ইউনিট-১), আন্দরকিল্লা শাহি জামে মসজিদের সামনে, আন্দরকিল্লা, থানাঃ কোতোয়ালী, জেলাঃ চট্টগ্রাম।
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {PHONES.map((p) => (
                <a key={p.href} href={p.href} className="inline-flex items-center gap-2.5 text-sm font-semibold text-plum transition hover:text-gold">
                  <span className="text-gold"><Icon name="phone" size={16} /></span>
                  {p.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="gold-rule mt-10" />
        <div className="mt-6 flex flex-col items-center justify-between gap-3 text-xs text-muted sm:flex-row">
          <span>© {year} Zaujain Nikah Point — সর্বস্বত্ব সংরক্ষিত।</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="transition hover:text-gold">গোপনীয়তা নীতি</Link>
            <Link href="/terms" className="transition hover:text-gold">শর্তাবলী</Link>
            <span className="inline-flex items-center gap-2">
              <span className="text-gold"><Icon name="truck" size={14} /></span>
              সারা বাংলাদেশে ডেলিভারি
            </span>
          </div>
        </div>
      </Container>
    </footer>
  );
}
