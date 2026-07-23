import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

const tabs: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "হোম", icon: "home" },
  { href: "/products", label: "শপ", icon: "bag" },
  { href: "/customize", label: "কাস্টম", icon: "sparkles" },
  { href: "/gallery", label: "গ্যালারি", icon: "image" },
  { href: "/cart", label: "কার্ট", icon: "cart" },
];

export default function MobileTabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur sm:hidden">
      <ul className="mx-auto flex max-w-6xl items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <li key={t.href} className="flex-1">
            <Link
              href={t.href}
              className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-medium text-plum active:bg-surface-2"
            >
              <Icon name={t.icon} size={22} />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
