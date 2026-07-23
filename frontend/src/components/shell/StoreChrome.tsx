"use client";
import { usePathname } from "next/navigation";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import MobileTabBar from "./MobileTabBar";
import StickyCustomize from "@/components/StickyCustomize";
import MetaPixel from "@/components/MetaPixel";

export function StoreHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <SiteHeader />;
}

export function StoreBottom() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  // Don't show the customize CTA while the user is already customizing.
  const showCta = !pathname?.startsWith("/customize");
  return (
    <>
      <SiteFooter />
      <MobileTabBar />
      {showCta && <StickyCustomize />}
      <MetaPixel />
    </>
  );
}
